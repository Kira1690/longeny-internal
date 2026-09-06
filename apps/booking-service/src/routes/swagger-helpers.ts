/**
 * The OpenAPI helpers live in `@longeny/openapi`. This file re-exports them so
 * the routes in this service keep their existing import path, and so the
 * `documented()` serialisation trick has one definition rather than five.
 */
export { bodyDoc, documented, errorDoc, jsonSchema, okDoc } from '@longeny/openapi';
export type { OpenApiFragment } from '@longeny/openapi';
