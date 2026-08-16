import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inArray } from 'drizzle-orm';
import { db } from './index.js';
import { users, providers } from './schema.js';
import { createLogger } from '@longeny/utils';

const logger = createLogger('user-provider-seed-providers');

interface ProviderSeedRecord {
  provider_id: string;
  user_id: string;
  auth_id: string;
  first_name: string;
  last_name: string;
  email: string;
  business_name: string;
  display_name: string;
  bio: string;
  specialties: string[];
  credentials: string[];
  years_experience: number;
  hourly_rate: number;
  city: string;
  state: string;
  lat: number;
  lng: number;
  offers_virtual: boolean;
  offers_in_person: boolean;
  rating: number;
  review_count: number;
  total_bookings: number;
  status: string;
  is_active: boolean;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadDataset(): ProviderSeedRecord[] {
  const raw = readFileSync(join(__dirname, 'providers.seed.json'), 'utf-8');
  return JSON.parse(raw) as ProviderSeedRecord[];
}

async function seed() {
  logger.info('Seeding providers dataset into user-provider-service database...');

  const dataset = loadDataset();
  logger.info({ count: dataset.length }, 'Loaded provider seed records');

  const userRows = dataset.map((r) => ({
    id: r.user_id,
    auth_id: r.auth_id,
    email: r.email,
    first_name: r.first_name,
    last_name: r.last_name,
    status: 'active' as const,
  }));

  const providerRows = dataset.map((r) => ({
    id: r.provider_id,
    user_id: r.user_id,
    business_name: r.business_name,
    display_name: r.display_name,
    bio: r.bio,
    specialties: r.specialties,
    credentials: r.credentials,
    years_experience: r.years_experience,
    // decimal columns are represented as strings by drizzle
    hourly_rate: r.hourly_rate.toFixed(2),
    currency: 'INR',
    location: {
      city: r.city,
      state: r.state,
      country: 'IN',
      lat: r.lat,
      lng: r.lng,
    },
    offers_virtual: r.offers_virtual,
    offers_in_person: r.offers_in_person,
    status: 'verified' as const,
    rating_avg: r.rating.toFixed(2),
    review_count: r.review_count,
    total_bookings: r.total_bookings,
  }));

  // Insert users first (providers.user_id references users.id), then providers.
  // Explicit ids keep providers.id === dataset provider_id so it matches the Chroma id.
  // onConflictDoNothing makes re-runs idempotent.
  await db.insert(users).values(userRows).onConflictDoNothing();
  logger.info({ count: userRows.length }, 'Upserted seed users');

  await db.insert(providers).values(providerRows).onConflictDoNothing();
  logger.info({ count: providerRows.length }, 'Upserted seed providers');

  const seededProviderIds = dataset.map((r) => r.provider_id);
  const present = await db
    .select({ id: providers.id })
    .from(providers)
    .where(inArray(providers.id, seededProviderIds));
  logger.info({ present: present.length }, 'Provider seed complete');

  process.exit(0);
}

seed().catch((error) => {
  logger.error({ error }, 'Provider seeding failed');
  process.exit(1);
});
