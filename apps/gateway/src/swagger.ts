/**
 * Aggregated Swagger spec builder for the API Gateway.
 *
 * Fetches OpenAPI JSON from each downstream service, rewrites paths to include
 * the /api/v1 gateway prefix, prefixes component schema names with the service
 * name to prevent collisions, then merges everything into one spec.
 *
 * The merged spec is cached for CACHE_TTL_MS and refreshed on the next request
 * after expiry, or immediately when forced.
 */

import type { GatewayConfig } from '@longeny/config';

// ── Types ────────────────────────────────────────────────────────────────────

interface OpenApiSpec {
  openapi?: string;
  info?: Record<string, unknown>;
  paths?: Record<string, unknown>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
    [key: string]: unknown;
  };
  tags?: Array<{ name: string; description?: string }>;
  [key: string]: unknown;
}

interface ServiceDescriptor {
  /** Logical name used for tag/component prefixing */
  name: string;
  /** Base URL of the downstream service */
  url: string;
  /**
   * Gateway path prefix that routes to this service.
   * Downstream paths are rewritten as: /api/v1/<pathPrefix>/<rest>
   * e.g. pathPrefix "auth" turns /auth/login → /api/v1/auth/login
   */
  pathPrefix: string;
}

interface CachedSpec {
  spec: OpenApiSpec;
  fetchedAt: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** How long (ms) to keep the merged spec before re-fetching */
const CACHE_TTL_MS = 60_000; // 1 minute

/** Per-service fetch timeout (ms) */
const FETCH_TIMEOUT_MS = 5_000;

const EXCLUDED_PATH_PATTERNS = [
  /\/providers\/me\/verification/,
  /\/providers\/me\/availability/,
  /\/providers\/me\/programs/,
  /\/providers\/me\/products/,
  /\/providers\/me\/stats/,
  /\/providers\/[^/]+\/slots/,
  /\/providers\/[^/]+\/programs/,
  /\/providers\/[^/]+\/products/,
  /\/providers\/[^/]+\/availability/,
  /\/marketplace/,
  /\/progress/,
  /\/bookings/,
  /\/notifications/,
  /\/ai\//,
  /\/documents\//,
  /\/payments/,
];

// ── Module-level cache ───────────────────────────────────────────────────────

let _cache: CachedSpec | null = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildServiceDescriptors(config: GatewayConfig): ServiceDescriptor[] {
  return [
    { name: 'auth', url: config.AUTH_SERVICE_URL, pathPrefix: 'auth' },
    { name: 'user-provider', url: config.USER_PROVIDER_SERVICE_URL, pathPrefix: '' },
  ];
}

function isExcludedPath(path: string): boolean {
  return EXCLUDED_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

async function fetchSpec(service: ServiceDescriptor): Promise<OpenApiSpec | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${service.url}/docs/json`, { signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as OpenApiSpec;
  } catch {
    // Service unreachable or timed out — skip gracefully
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Rewrite a component $ref to use the service-prefixed name.
 * e.g. '#/components/schemas/LoginDto' → '#/components/schemas/Auth_LoginDto'
 */
function rewriteRefs(obj: unknown, servicePrefix: string): unknown {
  if (typeof obj === 'string') {
    if (obj.startsWith('#/components/schemas/')) {
      const schemaName = obj.slice('#/components/schemas/'.length);
      return `#/components/schemas/${servicePrefix}_${schemaName}`;
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => rewriteRefs(item, servicePrefix));
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = rewriteRefs(value, servicePrefix);
    }
    return result;
  }
  return obj;
}

/**
 * Rewrite all paths in a spec:
 *  - Remove any existing /api/v1 prefix to normalise (some services may omit it)
 *  - Strip a service-internal prefix (e.g. /auth) that the downstream uses
 *  - Add the canonical gateway prefix /api/v1/<pathPrefix>
 *
 * The rule is intentionally liberal so specs that already include /api/v1 work
 * the same as specs that don't.
 */
function rewritePaths(
  paths: Record<string, unknown>,
  pathPrefix: string,
  servicePrefix: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const gatewayPrefix = pathPrefix ? `/api/v1/${pathPrefix}` : '/api/v1';

  for (const [rawPath, pathItem] of Object.entries(paths)) {
    // Normalise: strip any leading /api/v1 that the service already emits
    let normalised = rawPath.replace(/^\/api\/v1/, '');

    // Strip the service's own internal prefix if it duplicates pathPrefix
    // e.g. auth service emits /auth/login and pathPrefix is "auth" → strip /auth
    if (pathPrefix && normalised.startsWith(`/${pathPrefix}`)) {
      normalised = normalised.slice(`/${pathPrefix}`.length);
    }

    // Ensure single leading slash
    const cleanPath = normalised.startsWith('/') ? normalised : `/${normalised}`;

    // Final gateway path
    const gatewayPath = cleanPath === '/' ? gatewayPrefix : `${gatewayPrefix}${cleanPath}`;

    // Deep-clone and rewrite $refs in the path item
    result[gatewayPath] = rewriteRefs(pathItem, servicePrefix);
  }

  return result;
}

/**
 * Prefix each component schema name with the service name to prevent collisions
 * across services.
 */
function prefixComponentSchemas(
  schemas: Record<string, unknown>,
  servicePrefix: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(schemas)) {
    result[`${servicePrefix}_${name}`] = rewriteRefs(schema, servicePrefix);
  }
  return result;
}

// ── Merger ───────────────────────────────────────────────────────────────────

async function buildMergedSpec(config: GatewayConfig): Promise<OpenApiSpec> {
  const services = buildServiceDescriptors(config);

  const fetchResults = await Promise.allSettled(services.map((svc) => fetchSpec(svc)));

  const mergedPaths: Record<string, unknown> = {};
  const mergedSchemas: Record<string, unknown> = {};
  const mergedSecuritySchemes: Record<string, unknown> = {
    BearerAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'JWT access token issued by the Auth service',
    },
  };
  const mergedTags: Array<{ name: string; description?: string }> = [];
  const seenTags = new Set<string>();

  for (let i = 0; i < services.length; i++) {
    const svc = services[i];
    const result = fetchResults[i];

    if (result.status === 'rejected' || result.value === null) {
      // Service is down — skip, but add a placeholder tag so the UI shows it
      const tagName = svc.name;
      if (!seenTags.has(tagName)) {
        seenTags.add(tagName);
        mergedTags.push({ name: tagName, description: `(service unreachable at ${svc.url})` });
      }
      continue;
    }

    const spec = result.value;
    const servicePrefix = svc.name
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');

    // Merge paths (filter out non-current-scope endpoints)
    if (spec.paths && typeof spec.paths === 'object') {
      const rewritten = rewritePaths(
        spec.paths as Record<string, unknown>,
        svc.pathPrefix,
        servicePrefix,
      );
      for (const [path, pathItem] of Object.entries(rewritten)) {
        if (!isExcludedPath(path)) {
          mergedPaths[path] = pathItem;
        }
      }
    }

    // Merge component schemas
    if (spec.components?.schemas && typeof spec.components.schemas === 'object') {
      const prefixed = prefixComponentSchemas(
        spec.components.schemas as Record<string, unknown>,
        servicePrefix,
      );
      Object.assign(mergedSchemas, prefixed);
    }

    // Merge security schemes (non-prefixed, usually shared)
    if (spec.components?.securitySchemes && typeof spec.components.securitySchemes === 'object') {
      for (const [schemeName, schemeValue] of Object.entries(
        spec.components.securitySchemes as Record<string, unknown>,
      )) {
        if (!mergedSecuritySchemes[schemeName]) {
          mergedSecuritySchemes[schemeName] = schemeValue;
        }
      }
    }

    // Merge tags (deduplicated, prefix with service name)
    const specTags = Array.isArray(spec.tags) ? spec.tags : [];
    for (const tag of specTags) {
      const tagKey = `${svc.name}:${tag.name}`;
      if (!seenTags.has(tagKey)) {
        seenTags.add(tagKey);
        mergedTags.push({
          name: tag.name,
          description: tag.description,
        });
      }
    }

    // If no tags in spec, add a default tag for the service
    if (specTags.length === 0 && !seenTags.has(svc.name)) {
      seenTags.add(svc.name);
      mergedTags.push({ name: svc.name, description: `${svc.name} service endpoints` });
    }
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'LONGENY API Gateway',
      version: '1.0.0',
      description:
        'Aggregated API documentation for all LONGENY microservices. ' +
        'All requests pass through the gateway at port 4001. ' +
        'Authenticate using the Authorize button with a Bearer JWT token.',
    },
    servers: [
      ...(config.GATEWAY_PUBLIC_URL
        ? [{ url: config.GATEWAY_PUBLIC_URL, description: 'API Gateway' }]
        : []),
      { url: 'http://localhost:4001', description: 'Local development gateway' },
    ],
    security: [{ BearerAuth: [] }],
    tags: mergedTags,
    paths: mergedPaths,
    components: {
      schemas: mergedSchemas,
      securitySchemes: mergedSecuritySchemes,
    },
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the merged OpenAPI spec, using the in-memory cache when fresh.
 * Pass `force = true` to bypass the cache and re-fetch immediately.
 */
export async function getMergedSpec(
  config: GatewayConfig,
  force = false,
): Promise<OpenApiSpec> {
  const now = Date.now();
  if (!force && _cache && now - _cache.fetchedAt < CACHE_TTL_MS) {
    return _cache.spec;
  }

  const spec = await buildMergedSpec(config);
  _cache = { spec, fetchedAt: now };
  return spec;
}

/**
 * Returns the Swagger UI HTML page that loads the aggregated spec from
 * the gateway's own /docs/json endpoint.
 */
export function getSwaggerUiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>LONGENY API Gateway — Docs</title>
  </head>
  <body>
    <script id="api-reference" data-url="/docs/json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;
}
