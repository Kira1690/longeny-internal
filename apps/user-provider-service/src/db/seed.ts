import { db } from './index.js';
import { categories, provider_categories, specialties, platform_settings } from './schema.js';
import { createLogger } from '@longeny/utils';

const logger = createLogger('user-provider-seed');

async function seed() {
  logger.info('Seeding user-provider-service database...');

  // ── Marketplace categories ──
  await db.insert(categories).values([
    { name: 'Fitness', slug: 'fitness', description: 'Physical fitness and training', sort_order: 1, is_active: true },
    { name: 'Nutrition', slug: 'nutrition', description: 'Nutrition and diet coaching', sort_order: 2, is_active: true },
    { name: 'Mental Health', slug: 'mental-health', description: 'Mental health and wellness', sort_order: 3, is_active: true },
    { name: 'Yoga & Meditation', slug: 'yoga-meditation', description: 'Yoga, meditation, and mindfulness', sort_order: 4, is_active: true },
    { name: 'Sports Performance', slug: 'sports-performance', description: 'Athletic and sports performance', sort_order: 5, is_active: true },
    { name: 'Rehabilitation', slug: 'rehabilitation', description: 'Physical rehabilitation and recovery', sort_order: 6, is_active: true },
  ]).onConflictDoNothing();

  // ── Provider categories ──
  await db.insert(provider_categories).values([
    { name: 'Personal Trainer', slug: 'personal-trainer', sort_order: 1, is_active: true },
    { name: 'Nutritionist', slug: 'nutritionist', sort_order: 2, is_active: true },
    { name: 'Life Coach', slug: 'life-coach', sort_order: 3, is_active: true },
    { name: 'Yoga Instructor', slug: 'yoga-instructor', sort_order: 4, is_active: true },
    { name: 'Sports Coach', slug: 'sports-coach', sort_order: 5, is_active: true },
    { name: 'Physical Therapist', slug: 'physical-therapist', sort_order: 6, is_active: true },
    { name: 'Wellness Coach', slug: 'wellness-coach', sort_order: 7, is_active: true },
  ]).onConflictDoNothing();

  // ── Specialties ──
  await db.insert(specialties).values([
    { name: 'Weight Loss' },
    { name: 'Muscle Building' },
    { name: 'Cardio & Endurance' },
    { name: 'Flexibility & Mobility' },
    { name: 'Sports Nutrition' },
    { name: 'Plant-Based Diet' },
    { name: 'Stress Management' },
    { name: 'Sleep Optimization' },
    { name: 'Marathon Training' },
    { name: 'HIIT Training' },
  ]).onConflictDoNothing();

  // ── Platform settings ──
  await db.insert(platform_settings).values([
    {
      key: 'platform.max_programs_per_provider',
      value: 50 as any,
      category: 'provider',
      description: 'Maximum number of programs a provider can create',
      is_sensitive: false,
    },
    {
      key: 'platform.max_products_per_provider',
      value: 100 as any,
      category: 'provider',
      description: 'Maximum number of products a provider can list',
      is_sensitive: false,
    },
    {
      key: 'platform.featured_listings_max',
      value: 20 as any,
      category: 'marketplace',
      description: 'Maximum number of featured listings at any time',
      is_sensitive: false,
    },
    {
      key: 'platform.search_results_default_limit',
      value: 20 as any,
      category: 'marketplace',
      description: 'Default number of search results per page',
      is_sensitive: false,
    },
  ]).onConflictDoNothing();

  logger.info('Seeding complete');
  process.exit(0);
}

seed().catch((error) => {
  logger.error({ error }, 'Seeding failed');
  process.exit(1);
});
