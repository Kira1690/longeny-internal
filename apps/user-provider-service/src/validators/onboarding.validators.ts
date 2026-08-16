import { t } from 'elysia';
import { type TSchema } from '@sinclair/typebox';

export const SECTION_KEYS = [
  'basic_identity',
  'professional_credentials',
  'license_verification',
  'practice_services',
  'scheduling_setup',
  'marketplace_profile',
  'banking_commercial',
  'platform_readiness',
  'document_capability',
  'compliance_consents',
  'legal_declarations',
  'trust_layer',
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

export const sectionKeySchema = t.Union(
  SECTION_KEYS.map((k) => t.Literal(k)) as [ReturnType<typeof t.Literal>, ...ReturnType<typeof t.Literal>[]],
);

// ── Section 1: Basic Identity ──

export const basicIdentitySchema = t.Object({
  full_legal_name: t.String({ minLength: 1, maxLength: 200 }),
  display_name: t.String({ minLength: 1, maxLength: 200 }),
  gender: t.Union([
    t.Literal('male'),
    t.Literal('female'),
    t.Literal('non_binary'),
    t.Literal('prefer_not_to_say'),
  ]),
  date_of_birth: t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
  nationality: t.String({ minLength: 1, maxLength: 100 }),
  mobile_number: t.String({ minLength: 5, maxLength: 20 }),
  email: t.String({ format: 'email' }),
  current_city: t.String({ minLength: 1, maxLength: 100 }),
  state: t.String({ minLength: 1, maxLength: 100 }),
  country: t.String({ minLength: 1, maxLength: 100 }),
  profile_photo_url: t.String({ maxLength: 500 }),
  whatsapp_number: t.Optional(t.String({ maxLength: 20 })),
});

// ── Section 2: Professional Credentials ──

export const professionalCredentialsSchema = t.Object({
  primary_degree: t.String({ minLength: 1, maxLength: 100 }),
  specialty: t.String({ minLength: 1, maxLength: 100 }),
  university: t.String({ minLength: 1, maxLength: 200 }),
  year_of_graduation: t.Integer({ minimum: 1950, maximum: 2030 }),
  years_of_experience: t.Integer({ minimum: 0, maximum: 70 }),
  current_practice_type: t.String({ minLength: 1, maxLength: 100 }),
  current_organization: t.String({ minLength: 1, maxLength: 200 }),
  super_specialty: t.Optional(t.String({ maxLength: 100 })),
  additional_certifications: t.Optional(t.Array(t.String())),
  functional_medicine_cert: t.Optional(t.String({ maxLength: 200 })),
});

// ── Section 3: License & Verification ──

export const licenseVerificationSchema = t.Object({
  medical_registration_number: t.String({ minLength: 1, maxLength: 50 }),
  licensing_council: t.String({ minLength: 1, maxLength: 200 }),
  registration_country: t.String({ minLength: 1, maxLength: 100 }),
  registration_state: t.String({ minLength: 1, maxLength: 100 }),
  license_valid_till: t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
  govt_id_proof_url: t.String({ maxLength: 500 }),
  address_proof_url: t.String({ maxLength: 500 }),
  pan_tax_id: t.String({ minLength: 1, maxLength: 20 }),
  gst_number: t.Optional(t.String({ maxLength: 20 })),
  malpractice_insurance_status: t.Optional(t.String({ maxLength: 50 })),
  insurance_proof_url: t.Optional(t.String({ maxLength: 500 })),
});

// ── Section 4: Practice & Services ──

export const practiceServicesSchema = t.Object({
  consultation_modes: t.Array(
    t.Union([t.Literal('online'), t.Literal('offline')]),
    { minItems: 1 },
  ),
  initial_consultation_fee: t.Number({ minimum: 0 }),
  followup_consultation_fee: t.Number({ minimum: 0 }),
  available_duration_minutes: t.Integer({ minimum: 5, maximum: 240 }),
  languages_spoken: t.Array(t.String(), { minItems: 1 }),
  areas_of_expertise: t.Array(t.String(), { minItems: 1 }),
  conditions_treated: t.Array(t.String(), { minItems: 1 }),
  teleconsult_available: t.Boolean(),
  in_person_address: t.Optional(t.String({ maxLength: 500 })),
});

// ── Section 5: Scheduling Setup ──

export const schedulingSetupSchema = t.Object({
  available_days: t.Array(
    t.Union([
      t.Literal('monday'),
      t.Literal('tuesday'),
      t.Literal('wednesday'),
      t.Literal('thursday'),
      t.Literal('friday'),
      t.Literal('saturday'),
      t.Literal('sunday'),
    ]),
    { minItems: 1 },
  ),
  available_hours_start: t.String({ pattern: '^\\d{2}:\\d{2}$' }),
  available_hours_end: t.String({ pattern: '^\\d{2}:\\d{2}$' }),
  timezone: t.String({ minLength: 1, maxLength: 50 }),
  slot_duration_minutes: t.Integer({ minimum: 5, maximum: 120 }),
  max_appointments_per_day: t.Integer({ minimum: 1, maximum: 50 }),
  holiday_rules: t.Optional(t.String({ maxLength: 500 })),
  calendar_integration: t.Optional(t.String({ maxLength: 200 })),
});

// ── Section 6: Marketplace Profile ──

export const marketplaceProfileSchema = t.Object({
  short_bio: t.String({ minLength: 1, maxLength: 500 }),
  why_patients_choose_me: t.String({ minLength: 1, maxLength: 1000 }),
  profile_headline: t.String({ minLength: 1, maxLength: 200 }),
  special_focus_areas: t.Array(t.String(), { minItems: 1 }),
  profile_photo_url: t.String({ maxLength: 500 }),
  languages: t.Array(t.String(), { minItems: 1 }),
  long_bio: t.Optional(t.String({ maxLength: 5000 })),
  intro_video_url: t.Optional(t.String({ maxLength: 500 })),
});

// ── Section 7: Banking & Commercial ──

export const bankingCommercialSchema = t.Object({
  legal_entity_name: t.String({ minLength: 1, maxLength: 200 }),
  bank_account_name: t.String({ minLength: 1, maxLength: 200 }),
  bank_account_number: t.String({ minLength: 1, maxLength: 30 }),
  ifsc_routing_code: t.String({ minLength: 1, maxLength: 20 }),
  bank_name: t.String({ minLength: 1, maxLength: 200 }),
  payout_email: t.String({ format: 'email' }),
  invoice_name: t.String({ minLength: 1, maxLength: 200 }),
  tax_preference: t.String({ minLength: 1, maxLength: 50 }),
  upi_id: t.Optional(t.String({ maxLength: 50 })),
});

// ── Section 8: Platform Operational Readiness ──

export const platformReadinessSchema = t.Object({
  internet_stable: t.Literal(true),
  device_ready: t.Literal(true),
  camera_audio_ready: t.Literal(true),
  can_issue_digital_docs: t.Literal(true),
  can_use_dashboard: t.Literal(true),
  sla_accepted: t.Literal(true),
});

// ── Section 9: Document Generation Capability ──

export const documentCapabilitySchema = t.Object({
  can_issue_prescription: t.Boolean(),
  can_review_reports: t.Boolean(),
  can_upload_notes: t.Boolean(),
  can_issue_nutrition_plan: t.Optional(t.Boolean()),
  can_issue_training_plan: t.Optional(t.Boolean()),
});

// ── Section 10: Compliance Consents ──

const consentItemSchema = t.Object({
  consent_key: t.String({ minLength: 1 }),
  granted: t.Literal(true),
  granted_at: t.Optional(t.String()),
  ip: t.Optional(t.String()),
});

export const CONSENT_KEYS = [
  'platform_terms', 'privacy_policy', 'telemedicine_guidelines',
  'store_profile_data', 'store_consultation_records', 'receive_bookings',
  'payout_processing', 'platform_communications', 'review_ratings_display',
  'credential_verification', 'fraud_kyc_screening', 'service_fee_commission',
  'cancellation_refund_policies', 'response_time_obligations', 'code_of_conduct',
] as const;

export const complianceConsentsSchema = t.Array(consentItemSchema);

// ── Section 11: Legal Declarations ──

const declarationItemSchema = t.Object({
  declaration_key: t.String({ minLength: 1 }),
  declared: t.Literal(true),
  declared_at: t.Optional(t.String()),
  ip: t.Optional(t.String()),
});

export const DECLARATION_KEYS = [
  'valid_medical_license', 'accurate_information', 'professional_standards',
  'comply_local_laws', 'no_patient_data_misuse', 'understand_violations_suspension',
] as const;

export const legalDeclarationsSchema = t.Array(declarationItemSchema);

// ── Section 12: Trust Layer (all optional) ──

export const trustLayerSchema = t.Object({
  awards: t.Optional(t.Array(t.String())),
  publications: t.Optional(t.Array(t.String())),
  testimonials: t.Optional(t.Array(t.String())),
  google_review_link: t.Optional(t.String({ maxLength: 500 })),
  media_mentions: t.Optional(t.Array(t.String())),
});

// ── Section schema map ──

export const sectionSchemas: Record<SectionKey, TSchema> = {
  basic_identity: basicIdentitySchema,
  professional_credentials: professionalCredentialsSchema,
  license_verification: licenseVerificationSchema,
  practice_services: practiceServicesSchema,
  scheduling_setup: schedulingSetupSchema,
  marketplace_profile: marketplaceProfileSchema,
  banking_commercial: bankingCommercialSchema,
  platform_readiness: platformReadinessSchema,
  document_capability: documentCapabilitySchema,
  compliance_consents: complianceConsentsSchema,
  legal_declarations: legalDeclarationsSchema,
  trust_layer: trustLayerSchema,
};

export function getPartialSchema(key: SectionKey): TSchema {
  const schema = sectionSchemas[key];
  if (key === 'compliance_consents') {
    return t.Array(
      t.Object({
        consent_key: t.Optional(t.String()),
        granted: t.Optional(t.Boolean()),
        granted_at: t.Optional(t.String()),
        ip: t.Optional(t.String()),
      }),
    );
  }
  if (key === 'legal_declarations') {
    return t.Array(
      t.Object({
        declaration_key: t.Optional(t.String()),
        declared: t.Optional(t.Boolean()),
        declared_at: t.Optional(t.String()),
        ip: t.Optional(t.String()),
      }),
    );
  }
  return t.Partial(schema);
}

// ── Admin check schema ──

export const ADMIN_CHECK_KEYS = [
  'credential_verified', 'license_verified', 'identity_verified',
  'banking_verified', 'profile_reviewed', 'fees_confirmed',
  'availability_confirmed', 'documents_reviewed', 'compliance_confirmed',
  'admin_activated',
] as const;

export const adminCheckUpdateSchema = t.Object({
  check_key: t.Union(
    ADMIN_CHECK_KEYS.map((k) => t.Literal(k)) as [ReturnType<typeof t.Literal>, ...ReturnType<typeof t.Literal>[]],
  ),
  is_checked: t.Boolean(),
  notes: t.Optional(t.String({ maxLength: 1000 })),
});

export const adminStatusUpdateSchema = t.Object({
  status: t.Union([t.Literal('approved'), t.Literal('rejected')]),
  reviewer_notes: t.Optional(t.String({ maxLength: 2000 })),
});

// ── Save section body schema ──

export const saveSectionBodySchema = t.Object({
  data: t.Record(t.String(), t.Unknown()),
  mark_complete: t.Boolean(),
});
