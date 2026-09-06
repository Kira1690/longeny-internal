import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * OpenAPI document fragments are structurally typed by `openapi-types` with
 * narrow literal unions (e.g. `type: 'object' | 'array' | …`). Object literals
 * written here widen `type` to `string`, so the fragments are typed loosely and
 * handed to the swagger plugin as-is — these values are documentation data, not
 * runtime behaviour.
 */
// biome-ignore lint/suspicious/noExplicitAny: OpenAPI fragments are free-form doc data
export type OpenApiFragment = any;

/**
 * Swagger/OpenAPI documentation helpers — one copy, for every service.
 *
 * This file lived in five services as five identical copies. Each service's
 * `routes/swagger-helpers.ts` now re-exports from here, so a fix to the
 * serialisation trick below reaches every spec at once instead of four of five.
 *
 * Elysia's swagger plugin understands TypeBox, not Zod — passing a Zod schema as a
 * route `body` validates correctly at runtime but serialises into the OpenAPI
 * document as raw Zod internals (`_def`, `ZodNever`), which renders as noise in
 * Swagger UI. These helpers convert Zod schemas to real OpenAPI 3 JSON Schema for
 * the `detail` block so the docs show readable field tables.
 */

/** Convert a Zod schema to an inline OpenAPI 3 JSON Schema (no $refs). */
export function jsonSchema(schema: ZodTypeAny): OpenApiFragment {
  return zodToJsonSchema(schema, {
    target: 'openApi3',
    $refStrategy: 'none',
  }) as OpenApiFragment;
}

/** OpenAPI `requestBody` block for a Zod-validated JSON body. */
export function bodyDoc(schema: ZodTypeAny, description?: string): OpenApiFragment {
  return {
    required: true,
    ...(description ? { description } : {}),
    content: { 'application/json': { schema: jsonSchema(schema) } },
  };
}

/**
 * Make a Zod schema serialise as OpenAPI JSON Schema when used as a route `body`.
 *
 * The swagger plugin embeds the route's validator object straight into
 * `requestBody.content[…].schema`, and that spread comes *after* `detail`, so it
 * overrides any `detail.requestBody` we set. A raw Zod schema therefore leaks its
 * internals (`_def`, `ZodNever`, `_cached`) into the spec and renders as noise in
 * Swagger UI.
 *
 * Fix, applied in place on the schema instance:
 *   1. hide Zod's own keys from serialisation (non-enumerable — still readable,
 *      so Zod itself is unaffected), then
 *   2. expose the converted JSON Schema keys as enumerable.
 *
 * The result serialises as a real OpenAPI schema while `parse`, `safeParse` and
 * the `~standard` interface Elysia validates through all keep working.
 *
 * Use for every Zod-validated `body` so Swagger UI shows a real field table:
 *   .post('/intake', handler, { body: documented(submitIntakeSchema), … })
 */
/**
 * Publish a Zod schema as a real OpenAPI body.
 *
 * `example` is worth passing on every write route. Without one, Swagger builds
 * its "Try it out" body from the property types and fills every string with
 * `""` — which then fails the schema's own `.min(1)`, `.email()` and `.url()`
 * checks. The first thing a new engineer does is press Execute on that body,
 * and it returned 400 on all four profile write routes.
 */
export function documented<T extends ZodTypeAny>(schema: T, example?: unknown): T {
  const target = schema as unknown as Record<string, unknown>;
  if (target.__openapiDocumented) return schema;

  const converted = jsonSchema(schema);
  if (example !== undefined) {
    (converted as Record<string, unknown>).example = example;
  }

  for (const key of Object.keys(target)) {
    Object.defineProperty(target, key, { enumerable: false, configurable: true });
  }
  for (const [key, value] of Object.entries(converted)) {
    Object.defineProperty(target, key, { value, enumerable: true, configurable: true });
  }
  Object.defineProperty(target, '__openapiDocumented', {
    value: true,
    enumerable: false,
    configurable: true,
  });

  return schema;
}

/**
 * Wrap a payload schema in the service's standard success envelope:
 * `{ success: true, data: <payload> }`.
 */
function envelope(data: OpenApiFragment): OpenApiFragment {
  return {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      data,
    },
  };
}

/** OpenAPI response entry for a successful call returning `data`. */
export function okDoc(
  description: string,
  data: OpenApiFragment,
  example?: unknown,
): OpenApiFragment {
  return {
    description,
    content: {
      'application/json': {
        schema: envelope(data),
        ...(example === undefined ? {} : { example: { success: true, data: example } }),
      },
    },
  };
}

/** Standard error-envelope response entry, e.g. errorDoc('Not your profile', 'NOT_FOUND'). */
export function errorDoc(description: string, code: string): OpenApiFragment {
  return {
    description,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: code },
                message: { type: 'string' },
              },
            },
          },
        },
      },
    },
  };
}
