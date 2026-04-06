import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';
import { eq, and, gte, lte, ilike, inArray } from 'drizzle-orm';
import {
  search_index,
  featured_listings,
  categories,
  saved_items,
  providers,
  programs,
  products,
  users,
  user_profiles,
} from '../db/schema.js';
import { NotFoundError, ConflictError } from '@longeny/errors';
import { createLogger, buildPaginationMeta } from '@longeny/utils';
import postgres from 'postgres';

const logger = createLogger('marketplace-service');

interface SearchFilters {
  q?: string;
  category?: string;
  subcategory?: string;
  entityType?: 'provider' | 'program' | 'product';
  minPrice?: number;
  maxPrice?: number;
  offersVirtual?: boolean;
  offersInPerson?: boolean;
  city?: string;
  state?: string;
  minRating?: number;
  sortBy?: string;
  page?: number;
  limit?: number;
}

// Get raw postgres client for raw queries
const rawClient = (db as any).session?.client ?? (db as any)._client;

async function rawQuery<T>(query: string, params: unknown[]): Promise<T[]> {
  // Use drizzle's underlying postgres client via sql template for raw queries
  const result = await db.execute(sql.raw(query));
  return result as unknown as T[];
}

// Build parameterized raw query via drizzle sql tagged template
async function execRaw<T = Record<string, unknown>>(
  queryStr: string,
  params: unknown[],
): Promise<T[]> {
  // We use the underlying postgres driver directly through drizzle's execute
  // by constructing a Placeholder-based sql object
  const chunks: unknown[] = [queryStr];
  const result = await (db as any).execute({ queryChunks: chunks, params } as any).catch(() => {
    // fallback: use drizzle sql tagged
    return db.execute(sql.raw(queryStr));
  });
  return (result as any).rows ?? result as T[];
}

export class MarketplaceService {
  constructor(_prismaUnused: unknown) {}

  // ── Unified search with tsvector ──

  async search(filters: SearchFilters) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    const conditions: string[] = [`si."status" = 'active'`];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.entityType) {
      conditions.push(`si."entity_type"::text = $${paramIndex}`);
      params.push(filters.entityType);
      paramIndex++;
    }

    if (filters.category) {
      conditions.push(`si."category" = $${paramIndex}`);
      params.push(filters.category);
      paramIndex++;
    }

    if (filters.subcategory) {
      conditions.push(`si."subcategory" = $${paramIndex}`);
      params.push(filters.subcategory);
      paramIndex++;
    }

    if (filters.minPrice !== undefined) {
      conditions.push(`si."price_min" >= $${paramIndex}`);
      params.push(filters.minPrice);
      paramIndex++;
    }

    if (filters.maxPrice !== undefined) {
      conditions.push(`si."price_max" <= $${paramIndex}`);
      params.push(filters.maxPrice);
      paramIndex++;
    }

    if (filters.offersVirtual !== undefined) {
      conditions.push(`si."offers_virtual" = $${paramIndex}`);
      params.push(filters.offersVirtual);
      paramIndex++;
    }

    if (filters.offersInPerson !== undefined) {
      conditions.push(`si."offers_in_person" = $${paramIndex}`);
      params.push(filters.offersInPerson);
      paramIndex++;
    }

    if (filters.city) {
      conditions.push(`si."location_city" ILIKE $${paramIndex}`);
      params.push(`%${filters.city}%`);
      paramIndex++;
    }

    if (filters.state) {
      conditions.push(`si."location_state" = $${paramIndex}`);
      params.push(filters.state);
      paramIndex++;
    }

    if (filters.minRating !== undefined) {
      conditions.push(`si."rating_avg" >= $${paramIndex}`);
      params.push(filters.minRating);
      paramIndex++;
    }

    let tsRankSelect = '';
    let tsCondition = '';
    if (filters.q) {
      const tsQuery = filters.q.trim().split(/\s+/).join(' & ');
      tsCondition = `AND to_tsvector('english', coalesce(si."title", '') || ' ' || coalesce(si."description", '')) @@ to_tsquery('english', $${paramIndex})`;
      tsRankSelect = `, ts_rank(to_tsvector('english', coalesce(si."title", '') || ' ' || coalesce(si."description", '')), to_tsquery('english', $${paramIndex})) AS relevance`;
      params.push(tsQuery);
      paramIndex++;
    }

    let orderClause: string;
    switch (filters.sortBy) {
      case 'rating':
        orderClause = 'ORDER BY si."rating_avg" DESC';
        break;
      case 'price_asc':
        orderClause = 'ORDER BY si."price_min" ASC NULLS LAST';
        break;
      case 'price_desc':
        orderClause = 'ORDER BY si."price_min" DESC NULLS LAST';
        break;
      case 'newest':
        orderClause = 'ORDER BY si."created_at" DESC';
        break;
      case 'popularity':
        orderClause = 'ORDER BY si."popularity_score" DESC';
        break;
      case 'relevance':
      default:
        orderClause = filters.q
          ? 'ORDER BY relevance DESC, si."popularity_score" DESC'
          : 'ORDER BY si."popularity_score" DESC, si."created_at" DESC';
        break;
    }

    const whereClause = conditions.join(' AND ');

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM search_index si
      WHERE ${whereClause} ${tsCondition}
    `;
    const countResult = await db.execute(buildParameterizedSql(countQuery, params)) as any;
    const total = (countResult?.[0] as any)?.total || 0;

    params.push(limit);
    const limitParam = paramIndex;
    paramIndex++;
    params.push(offset);
    const offsetParam = paramIndex;

    const dataQuery = `
      SELECT si.*${tsRankSelect}
      FROM search_index si
      WHERE ${whereClause} ${tsCondition}
      ${orderClause}
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;

    const results = await db.execute(buildParameterizedSql(dataQuery, params)) as any;

    return {
      data: Array.isArray(results) ? results : [],
      pagination: buildPaginationMeta(total, page, limit),
    };
  }

  // ── Provider search ──

  async searchProviders(filters: SearchFilters) {
    return this.search({ ...filters, entityType: 'provider' });
  }

  async getProviderBySlug(slug: string) {
    const [provider] = await db
      .select()
      .from(providers)
      .where(
        and(
          sql`(${providers.display_name} = ${slug} OR ${providers.business_name} = ${slug})`,
          sql`${providers.status}::text != 'deactivated'`,
        ),
      )
      .limit(1);

    if (!provider) {
      throw new NotFoundError('Provider');
    }

    const [user] = await db
      .select({ first_name: users.first_name, last_name: users.last_name, avatar_url: users.avatar_url })
      .from(users)
      .where(eq(users.id, provider.user_id))
      .limit(1);

    const providerPrograms = await db
      .select()
      .from(programs)
      .where(and(eq(programs.provider_id, provider.id), eq(programs.status, 'active')))
      .orderBy(sql`${programs.created_at} DESC`);

    const providerProducts = await db
      .select()
      .from(products)
      .where(and(eq(products.provider_id, provider.id), eq(products.status, 'active')))
      .orderBy(sql`${products.created_at} DESC`);

    return { ...provider, user, programs: providerPrograms, products: providerProducts };
  }

  // ── Program search ──

  async searchPrograms(filters: SearchFilters) {
    return this.search({ ...filters, entityType: 'program' });
  }

  async getProgramDetail(programId: string) {
    const [program] = await db
      .select()
      .from(programs)
      .where(eq(programs.id, programId))
      .limit(1);

    if (!program || program.status === 'archived') {
      throw new NotFoundError('Program', programId);
    }

    const [provider] = await db
      .select()
      .from(providers)
      .where(eq(providers.id, program.provider_id))
      .limit(1);

    let user = null;
    if (provider) {
      const [u] = await db
        .select({ first_name: users.first_name, last_name: users.last_name, avatar_url: users.avatar_url })
        .from(users)
        .where(eq(users.id, provider.user_id))
        .limit(1);
      user = u;
    }

    return { ...program, provider: provider ? { ...provider, user } : null };
  }

  // ── Product search ──

  async searchProducts(filters: SearchFilters) {
    return this.search({ ...filters, entityType: 'product' });
  }

  async getProductDetail(productId: string) {
    const [product] = await db
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);

    if (!product || product.status === 'archived') {
      throw new NotFoundError('Product', productId);
    }

    const [provider] = await db
      .select()
      .from(providers)
      .where(eq(providers.id, product.provider_id))
      .limit(1);

    let user = null;
    if (provider) {
      const [u] = await db
        .select({ first_name: users.first_name, last_name: users.last_name, avatar_url: users.avatar_url })
        .from(users)
        .where(eq(users.id, provider.user_id))
        .limit(1);
      user = u;
    }

    return { ...product, provider: provider ? { ...provider, user } : null };
  }

  // ── Categories ──

  async listCategories() {
    const allCategories = await db
      .select()
      .from(categories)
      .where(eq(categories.is_active, true))
      .orderBy(categories.sort_order);

    const topLevel = allCategories.filter((c) => !c.parent_id);
    return topLevel.map((parent) => ({
      ...parent,
      children: allCategories
        .filter((c) => c.parent_id === parent.id)
        .sort((a, b) => a.sort_order - b.sort_order),
    }));
  }

  // ── Facets ──

  async getFacets(filters?: { entityType?: string; category?: string }) {
    const conditions: string[] = [`"status" = 'active'`];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters?.entityType) {
      conditions.push(`"entity_type"::text = $${paramIndex}`);
      params.push(filters.entityType);
      paramIndex++;
    }

    if (filters?.category) {
      conditions.push(`"category" = $${paramIndex}`);
      params.push(filters.category);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const [categoryCounts, typeCounts, priceRange, ratingDist] = await Promise.all([
      db.execute(buildParameterizedSql(
        `SELECT "category", COUNT(*)::int AS count FROM search_index WHERE ${whereClause} AND "category" IS NOT NULL GROUP BY "category" ORDER BY count DESC`,
        params,
      )),
      db.execute(buildParameterizedSql(
        `SELECT "entity_type"::text, COUNT(*)::int AS count FROM search_index WHERE ${whereClause} GROUP BY "entity_type" ORDER BY count DESC`,
        params,
      )),
      db.execute(buildParameterizedSql(
        `SELECT MIN("price_min")::float AS min_price, MAX("price_max")::float AS max_price FROM search_index WHERE ${whereClause}`,
        params,
      )),
      db.execute(buildParameterizedSql(
        `SELECT FLOOR("rating_avg")::int AS rating_bucket, COUNT(*)::int AS count FROM search_index WHERE ${whereClause} AND "rating_avg" > 0 GROUP BY rating_bucket ORDER BY rating_bucket DESC`,
        params,
      )),
    ]);

    return {
      categories: Array.isArray(categoryCounts) ? categoryCounts : [],
      entityTypes: Array.isArray(typeCounts) ? typeCounts : [],
      priceRange: (Array.isArray(priceRange) ? priceRange[0] : null) || { min_price: 0, max_price: 0 },
      ratingDistribution: Array.isArray(ratingDist) ? ratingDist : [],
    };
  }

  // ── Category detail ──

  async getCategoryBySlug(slug: string) {
    const [category] = await db
      .select()
      .from(categories)
      .where(eq(categories.slug, slug))
      .limit(1);

    if (!category) {
      throw new NotFoundError('Category');
    }

    const children = await db
      .select()
      .from(categories)
      .where(and(eq(categories.parent_id, category.id), eq(categories.is_active, true)))
      .orderBy(categories.sort_order);

    const catProviders = await db.execute(
      sql`SELECT * FROM search_index WHERE "category" = ${category.name} AND "status" = 'active' ORDER BY "popularity_score" DESC LIMIT 20`,
    );

    return { category: { ...category, children }, providers: Array.isArray(catProviders) ? catProviders : [] };
  }

  // ── Featured listings ──

  async getFeaturedListings() {
    const now = new Date().toISOString().split('T')[0]; // date string for comparison

    const featured = await db
      .select()
      .from(featured_listings)
      .where(
        and(
          eq(featured_listings.status, 'active'),
          sql`${featured_listings.start_date}::date <= ${now}::date`,
          sql`${featured_listings.end_date}::date >= ${now}::date`,
        ),
      )
      .orderBy(featured_listings.position)
      .limit(20);

    if (featured.length === 0) return [];

    const entityIds = featured.map((f) => f.entity_id);
    const entities = await db.execute(
      sql`SELECT * FROM search_index WHERE "entity_id" = ANY(${entityIds}::uuid[]) AND "status" = 'active'`,
    );
    const entitiesArr = Array.isArray(entities) ? entities : [];

    return featured.map((f) => {
      const entity = entitiesArr.find((e: any) => e.entity_id === f.entity_id);
      return { ...f, entity: entity || null };
    });
  }

  // ── Trending ──

  async getTrending(limit = 20) {
    const results = await db.execute(
      sql`SELECT * FROM search_index WHERE "status" = 'active' ORDER BY "popularity_score" DESC, "rating_avg" DESC LIMIT ${limit}`,
    );

    return Array.isArray(results) ? results : [];
  }

  // ── AI-powered recommendations ──

  async getRecommendations(userId: string) {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.auth_id, userId))
      .limit(1);

    let profile = null;
    if (user) {
      const profiles = await db
        .select()
        .from(user_profiles)
        .where(eq(user_profiles.user_id, user.id))
        .limit(1);
      profile = profiles[0] ?? null;
    }

    const results = await db.execute(
      sql`SELECT * FROM search_index WHERE "status" = 'active' ORDER BY "ai_relevance_score" DESC NULLS LAST, "popularity_score" DESC LIMIT 20`,
    );

    return {
      recommendations: Array.isArray(results) ? results : [],
      basedOn: profile ? 'user_preferences' : 'popularity',
    };
  }

  // ── Search suggestions (autocomplete) ──

  async getSearchSuggestions(q: string, limit = 10) {
    if (!q || q.trim().length < 2) {
      return [];
    }

    const results = await db.execute(
      sql`SELECT DISTINCT "title", "entity_type"::text FROM search_index WHERE "status" = 'active' AND "title" ILIKE ${`%${q.trim()}%`} ORDER BY "title" ASC LIMIT ${limit}`,
    );

    return Array.isArray(results) ? results : [];
  }

  // ── Saved items ──

  async saveItem(userId: string, entityType: string, entityId: string) {
    try {
      const [item] = await db
        .insert(saved_items)
        .values({
          user_id: userId,
          entity_type: entityType as any,
          entity_id: entityId,
        })
        .returning();

      return item;
    } catch (error: any) {
      if (error.code === '23505') {
        throw new ConflictError('Item is already saved');
      }
      throw error;
    }
  }

  async listSavedItems(userId: string, page = 1, limit = 20) {
    const offset = (page - 1) * limit;

    const [items, [{ count }]] = await Promise.all([
      db
        .select()
        .from(saved_items)
        .where(eq(saved_items.user_id, userId))
        .orderBy(sql`${saved_items.created_at} DESC`)
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(saved_items)
        .where(eq(saved_items.user_id, userId)),
    ]);

    return {
      data: items,
      pagination: buildPaginationMeta(count, page, limit),
    };
  }

  async removeSavedItem(userId: string, itemId: string) {
    const [item] = await db
      .select()
      .from(saved_items)
      .where(and(eq(saved_items.id, itemId), eq(saved_items.user_id, userId)))
      .limit(1);

    if (!item) {
      throw new NotFoundError('Saved item', itemId);
    }

    await db.delete(saved_items).where(eq(saved_items.id, itemId));

    return { success: true };
  }
}

// Helper: build a SQL object from a parameterized query string + params array
// Drizzle's sql.raw doesn't support params; we convert $1/$2/... to inline values
function buildParameterizedSql(queryStr: string, params: unknown[]) {
  let i = 0;
  const chunks: any[] = [];
  const parts = queryStr.split(/\$\d+/);
  for (let idx = 0; idx < parts.length; idx++) {
    chunks.push(sql.raw(parts[idx]));
    if (idx < params.length) {
      chunks.push(sql`${params[idx]}`);
    }
  }
  return sql.join(chunks, sql``);
}
