import {
  ProviderStatus,
  VerificationStatus,
  ProgramStatus,
  ProductStatus,
  PriceType,
  DayOfWeek,
} from './enums.js';

export interface Provider {
  id: string;
  user_id: string;
  business_name: string;
  display_name: string | null;
  bio: string | null;
  /** JSONB array of specialty strings */
  specialties: Record<string, unknown> | unknown[];
  /** JSONB array of credential objects */
  credentials: Record<string, unknown> | unknown[];
  years_experience: number | null;
  hourly_rate: number | null;
  currency: string;
  /** JSONB object containing location details (city, state, lat, lng) */
  location: Record<string, unknown> | null;
  service_area_radius_miles: number | null;
  offers_virtual: boolean;
  offers_in_person: boolean;
  status: ProviderStatus;
  rating_avg: number;
  review_count: number;
  total_bookings: number;
  website_url: string | null;
  /** JSONB object containing social media links */
  social_links: Record<string, unknown> | null;
  cancellation_policy: string | null;
  cancellation_hours: number;
  created_at: Date;
  updated_at: Date;
}

export interface ProviderVerification {
  id: string;
  provider_id: string;
  document_type: string;
  document_url: string;
  status: VerificationStatus;
  reviewer_id: string | null;
  reviewed_at: Date | null;
  notes: string | null;
  created_at: Date;
}

export interface Program {
  id: string;
  provider_id: string;
  title: string;
  description: string;
  short_description: string | null;
  category: string;
  subcategory: string | null;
  duration_weeks: number | null;
  session_count: number | null;
  session_duration_minutes: number;
  price: number;
  price_type: PriceType;
  max_participants: number | null;
  current_participants: number;
  prerequisites: string | null;
  what_to_expect: string | null;
  /** JSONB array of expected outcome descriptions */
  outcomes: Record<string, unknown> | null;
  /** JSONB array of tag strings */
  tags: Record<string, unknown> | unknown[];
  image_url: string | null;
  is_featured: boolean;
  status: ProgramStatus;
  created_at: Date;
  updated_at: Date;
}

export interface Product {
  id: string;
  provider_id: string;
  title: string;
  description: string;
  short_description: string | null;
  category: string;
  price: number;
  compare_at_price: number | null;
  inventory_count: number;
  sku: string | null;
  /** JSONB array of image URL strings */
  image_urls: Record<string, unknown> | unknown[];
  /** JSONB array of tag strings */
  tags: Record<string, unknown> | unknown[];
  /** JSONB object containing product-specific attributes */
  attributes: Record<string, unknown> | null;
  is_digital: boolean;
  digital_file_url: string | null;
  status: ProductStatus;
  created_at: Date;
  updated_at: Date;
}

export interface AvailabilityRule {
  id: string;
  provider_id: string;
  day_of_week: DayOfWeek;
  start_time: Date;
  end_time: Date;
  timezone: string;
  slot_duration_minutes: number;
  buffer_minutes: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface AvailabilityOverride {
  id: string;
  provider_id: string;
  date: Date;
  start_time: Date | null;
  end_time: Date | null;
  is_blocked: boolean;
  reason: string | null;
  created_at: Date;
}

export interface ProviderCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parent_id: string | null;
  icon_url: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: Date;
}

export interface Specialty {
  id: string;
  category_id: string | null;
  name: string;
  created_at: Date;
}

export interface SearchIndex {
  id: string;
  entity_type: string;
  entity_id: string;
  title: string;
  description: string | null;
  category: string | null;
  subcategory: string | null;
  /** JSONB array of tag strings */
  tags: Record<string, unknown> | unknown[];
  /** JSONB array of specialty strings */
  specialties: Record<string, unknown> | unknown[];
  location_city: string | null;
  location_state: string | null;
  location_lat: number | null;
  location_lng: number | null;
  price_min: number | null;
  price_max: number | null;
  rating_avg: number;
  review_count: number;
  provider_id: string | null;
  provider_name: string | null;
  provider_verified: boolean;
  offers_virtual: boolean;
  offers_in_person: boolean;
  ai_relevance_score: number | null;
  popularity_score: number;
  image_url: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface FeaturedListing {
  id: string;
  entity_type: string;
  entity_id: string;
  position: number;
  start_date: Date;
  end_date: Date;
  status: string;
  created_by: string | null;
  created_at: Date;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parent_id: string | null;
  icon_url: string | null;
  listing_count: number;
  sort_order: number;
  is_active: boolean;
  created_at: Date;
}

export interface SavedItem {
  id: string;
  user_id: string;
  entity_type: string;
  entity_id: string;
  created_at: Date;
}
