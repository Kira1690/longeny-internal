/**
 * The OpenAPI helpers live in `@longeny/openapi`. This file re-exports them so
 * the routes in this service import them the same way every other service does.
 */
export { bodyDoc, documented, errorDoc, jsonSchema, okDoc } from '@longeny/openapi';
export type { OpenApiFragment } from '@longeny/openapi';
