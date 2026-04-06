import {
  UserStatus,
  Gender,
  FitnessLevel,
  HabitFrequency,
} from './enums.js';

export interface User {
  id: string;
  auth_id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone_encrypted: string | null;
  phone_hash: string | null;
  avatar_url: string | null;
  date_of_birth_encrypted: string | null;
  gender: Gender | null;
  timezone: string;
  status: UserStatus;
  created_at: Date;
  updated_at: Date;
}

export interface UserProfile {
  id: string;
  user_id: string;
  bio: string | null;
  address_encrypted: string | null;
  country: string;
  /** JSONB array of health goal strings */
  health_goals: Record<string, unknown> | unknown[];
  /** JSONB array of dietary preference strings */
  dietary_preferences: Record<string, unknown> | unknown[];
  fitness_level: FitnessLevel | null;
  /** JSONB array of wellness interest strings */
  wellness_interests: Record<string, unknown> | unknown[];
  preferred_session_type: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface HealthProfile {
  id: string;
  user_id: string;
  height_cm: number | null;
  weight_kg: number | null;
  blood_type: string | null;
  /** Encrypted JSON string containing allergy information */
  allergies_encrypted: string | null;
  /** Encrypted JSON string containing medical conditions */
  medical_conditions_encrypted: string | null;
  /** Encrypted JSON string containing current medications */
  medications_encrypted: string | null;
  /** Encrypted JSON string containing emergency contact details */
  emergency_contact_encrypted: string | null;
  notes: string | null;
  last_checkup_date: Date | null;
  consent_health_sharing: boolean;
  consent_ai_analysis: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface OnboardingState {
  id: string;
  user_id: string;
  current_step: number;
  total_steps: number;
  /** JSONB array of completed step identifiers */
  completed_steps: Record<string, unknown> | unknown[];
  /** JSONB object containing data collected at each step */
  step_data: Record<string, unknown>;
  is_completed: boolean;
  started_at: Date;
  completed_at: Date | null;
  updated_at: Date;
}

export interface UserPreferences {
  id: string;
  user_id: string;
  notification_email: boolean;
  notification_sms: boolean;
  notification_push: boolean;
  language: string;
  theme: string;
  newsletter: boolean;
  booking_reminders_hours: number;
  created_at: Date;
  updated_at: Date;
}

export interface Goal {
  id: string;
  user_id: string;
  goal_type: string;
  title: string;
  description: string | null;
  target_value: number | null;
  current_value: number;
  unit: string | null;
  start_date: Date;
  target_date: Date | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface EngagementScore {
  id: string;
  user_id: string;
  score: number;
  login_streak: number;
  bookings_completed: number;
  checkins_count: number;
  calculated_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface Reminder {
  id: string;
  user_id: string;
  type: string;
  message: string;
  frequency: HabitFrequency;
  scheduled_time: string;
  timezone: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}
