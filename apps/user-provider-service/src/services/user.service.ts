import { BadRequestError, ConflictError, NotFoundError } from '@longeny/errors';
import { createLogger, createServiceClient, decrypt, encrypt, toCSV } from '@longeny/utils';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { config } from '../config/index.js';
import { db } from '../db/index.js';
import {
  achievements,
  caregiver_consent,
  caregiver_consent_audit,
  data_export_requests,
  gdpr_erasure_requests,
  goals,
  habit_checkins,
  habits,
  health_profiles,
  notification_log,
  notification_targets,
  onboarding_state,
  profiles,
  progress_entries,
  reviews,
  rro_state,
  rro_transition,
  saved_items,
  user_preferences,
  user_profiles,
  users,
} from '../db/schema.js';
import { lookupHash } from './lookup-hash.js';

const logger = createLogger('user-service');

/** Export key → CSV filename for the profile-scoped tables. */
const RRO_CSV_SECTIONS: Record<string, string> = {
  profiles: 'profiles.csv',
  caregiverConsents: 'caregiver_consent.csv',
  caregiverConsentAudit: 'caregiver_consent_audit.csv',
  rroStates: 'rro_state.csv',
  rroTransitions: 'rro_transition.csv',
  notificationTargets: 'notification_targets.csv',
  notificationLog: 'notification_log.csv',
  goals: 'goals.csv',
  onboardingStates: 'onboarding_state.csv',
};

export class UserService {
  constructor(private encryptionKey: string) {}

  // ── Profile ──

  async getProfile(authId: string) {
    const [user] = await db.select().from(users).where(eq(users.auth_id, authId)).limit(1);

    if (!user) {
      throw new NotFoundError('User');
    }

    const [profile] = await db
      .select()
      .from(user_profiles)
      .where(eq(user_profiles.user_id, user.id))
      .limit(1);
    const [preferences] = await db
      .select()
      .from(user_preferences)
      .where(eq(user_preferences.user_id, user.id))
      .limit(1);
    const [healthProfileRow] = await db
      .select()
      .from(health_profiles)
      .where(eq(health_profiles.user_id, user.id))
      .limit(1);
    // /users/me carries no active-profile header, so the intake it returns is
    // deliberately the account owner's own. Filtering on user_id alone would
    // now return whichever profile's row Postgres happened to hand back first.
    const selfProfileId = await this.findSelfProfileId(user.id);
    const [onboardingRow] = selfProfileId
      ? await db
          .select()
          .from(onboarding_state)
          .where(
            and(
              eq(onboarding_state.user_id, user.id),
              eq(onboarding_state.profile_id, selfProfileId),
            ),
          )
          .limit(1)
      : [];

    const healthProfile = healthProfileRow
      ? this.decryptHealthProfile(healthProfileRow as any)
      : null;
    const onboarding = onboardingRow ? this.decryptOnboardingState(onboardingRow as any) : null;

    return this.sanitizeUser({ ...user, profile, preferences, healthProfile, onboarding });
  }

  async updateProfile(
    authId: string,
    data: {
      firstName?: string;
      lastName?: string;
      phone?: string;
      avatarUrl?: string;
      timezone?: string;
      bio?: string;
      healthGoals?: string[];
      dietaryPreferences?: string[];
      fitnessLevel?: string;
      wellnessInterests?: string[];
      preferredSessionType?: string;
      country?: string;
    },
  ) {
    const [user] = await db.select().from(users).where(eq(users.auth_id, authId)).limit(1);

    if (!user) {
      throw new NotFoundError('User');
    }

    const userUpdate: Record<string, unknown> = { updated_at: new Date() };
    if (data.firstName) userUpdate.first_name = data.firstName;
    if (data.lastName) userUpdate.last_name = data.lastName;
    if (data.timezone) userUpdate.timezone = data.timezone;
    if (data.avatarUrl) userUpdate.avatar_url = data.avatarUrl;
    if (data.phone) {
      userUpdate.phone_encrypted = encrypt(data.phone, this.encryptionKey);
      // A keyed digest, never the number: the column exists for lookup, and a
      // plaintext copy beside the ciphertext would make the encryption pointless.
      userUpdate.phone_hash = lookupHash(data.phone, this.encryptionKey);
    }

    const profileUpdate: Record<string, unknown> = { updated_at: new Date() };
    if (data.bio !== undefined) profileUpdate.bio = data.bio;
    if (data.healthGoals) profileUpdate.health_goals = data.healthGoals;
    if (data.dietaryPreferences) profileUpdate.dietary_preferences = data.dietaryPreferences;
    if (data.fitnessLevel) profileUpdate.fitness_level = data.fitnessLevel;
    if (data.wellnessInterests) profileUpdate.wellness_interests = data.wellnessInterests;
    if (data.preferredSessionType) profileUpdate.preferred_session_type = data.preferredSessionType;
    if (data.country) profileUpdate.country = data.country;

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set(userUpdate as any)
        .where(eq(users.id, user.id));

      if (Object.keys(profileUpdate).length > 1) {
        // > 1 because updated_at is always there
        const [existingProfile] = await tx
          .select({ id: user_profiles.id })
          .from(user_profiles)
          .where(eq(user_profiles.user_id, user.id))
          .limit(1);
        if (existingProfile) {
          await tx
            .update(user_profiles)
            .set(profileUpdate as any)
            .where(eq(user_profiles.user_id, user.id));
        } else {
          await tx.insert(user_profiles).values({ user_id: user.id, ...(profileUpdate as any) });
        }
      }
    });

    return this.getProfile(authId);
  }

  async softDelete(authId: string) {
    const [user] = await db.select().from(users).where(eq(users.auth_id, authId)).limit(1);

    if (!user) {
      throw new NotFoundError('User');
    }

    await db
      .update(users)
      .set({ status: 'deactivated', updated_at: new Date() })
      .where(eq(users.id, user.id));

    return { id: user.id };
  }

  async getAvatarUploadUrl(authId: string) {
    const [user] = await db.select().from(users).where(eq(users.auth_id, authId)).limit(1);

    if (!user) {
      throw new NotFoundError('User');
    }

    const key = `avatars/${user.id}/${Date.now()}.jpg`;
    const uploadUrl = `https://s3.amazonaws.com/longeny-uploads/${key}`;
    const publicUrl = `https://longeny-uploads.s3.amazonaws.com/${key}`;

    return { uploadUrl, publicUrl, key };
  }

  // ── Health Profile ──

  async getHealthProfile(authId: string) {
    const [user] = await db.select().from(users).where(eq(users.auth_id, authId)).limit(1);

    if (!user) {
      throw new NotFoundError('User');
    }

    const [healthProfile] = await db
      .select()
      .from(health_profiles)
      .where(eq(health_profiles.user_id, user.id))
      .limit(1);

    if (!healthProfile) {
      return null;
    }

    return this.decryptHealthProfile(healthProfile as any);
  }

  async updateHealthProfile(
    authId: string,
    data: {
      heightCm?: number;
      weightKg?: number;
      bloodType?: string;
      allergies?: string[];
      medicalConditions?: string[];
      medications?: string[];
      emergencyContact?: string;
      notes?: string;
      lastCheckupDate?: string;
      consentHealthSharing?: boolean;
      consentAiAnalysis?: boolean;
    },
  ) {
    const [user] = await db.select().from(users).where(eq(users.auth_id, authId)).limit(1);

    if (!user) {
      throw new NotFoundError('User');
    }

    const profileData: Record<string, unknown> = { updated_at: new Date() };
    if (data.heightCm !== undefined) profileData.height_cm = String(data.heightCm);
    if (data.weightKg !== undefined) profileData.weight_kg = String(data.weightKg);
    if (data.bloodType !== undefined) profileData.blood_type = data.bloodType;
    if (data.notes !== undefined) profileData.notes = data.notes;
    if (data.lastCheckupDate) profileData.last_checkup_date = data.lastCheckupDate;
    if (data.consentHealthSharing !== undefined)
      profileData.consent_health_sharing = data.consentHealthSharing;
    if (data.consentAiAnalysis !== undefined)
      profileData.consent_ai_analysis = data.consentAiAnalysis;

    if (data.allergies)
      profileData.allergies_encrypted = encrypt(JSON.stringify(data.allergies), this.encryptionKey);
    if (data.medicalConditions)
      profileData.medical_conditions_encrypted = encrypt(
        JSON.stringify(data.medicalConditions),
        this.encryptionKey,
      );
    if (data.medications)
      profileData.medications_encrypted = encrypt(
        JSON.stringify(data.medications),
        this.encryptionKey,
      );
    if (data.emergencyContact)
      profileData.emergency_contact_encrypted = encrypt(data.emergencyContact, this.encryptionKey);

    const [existing] = await db
      .select({ id: health_profiles.id })
      .from(health_profiles)
      .where(eq(health_profiles.user_id, user.id))
      .limit(1);

    let profile: any;
    if (existing) {
      [profile] = await db
        .update(health_profiles)
        .set(profileData as any)
        .where(eq(health_profiles.user_id, user.id))
        .returning();
    } else {
      [profile] = await db
        .insert(health_profiles)
        .values({ user_id: user.id, ...(profileData as any) })
        .returning();
    }

    return this.decryptHealthProfile(profile);
  }

  // ── Preferences ──

  async getPreferences(authId: string) {
    const [user] = await db.select().from(users).where(eq(users.auth_id, authId)).limit(1);

    if (!user) {
      throw new NotFoundError('User');
    }

    const [prefs] = await db
      .select()
      .from(user_preferences)
      .where(eq(user_preferences.user_id, user.id))
      .limit(1);
    return prefs || null;
  }

  async updatePreferences(
    authId: string,
    data: {
      notifications?: { email?: boolean; sms?: boolean; push?: boolean };
      language?: string;
      theme?: string;
      newsletter?: boolean;
      bookingRemindersHours?: number;
    },
  ) {
    const [user] = await db.select().from(users).where(eq(users.auth_id, authId)).limit(1);

    if (!user) {
      throw new NotFoundError('User');
    }

    const prefData: Record<string, unknown> = { updated_at: new Date() };
    if (data.notifications?.email !== undefined)
      prefData.notification_email = data.notifications.email;
    if (data.notifications?.sms !== undefined) prefData.notification_sms = data.notifications.sms;
    if (data.notifications?.push !== undefined)
      prefData.notification_push = data.notifications.push;
    if (data.language) prefData.language = data.language;
    if (data.theme) prefData.theme = data.theme;
    if (data.newsletter !== undefined) prefData.newsletter = data.newsletter;
    if (data.bookingRemindersHours !== undefined)
      prefData.booking_reminders_hours = data.bookingRemindersHours;

    const [existing] = await db
      .select({ id: user_preferences.id })
      .from(user_preferences)
      .where(eq(user_preferences.user_id, user.id))
      .limit(1);

    let preferences: any;
    if (existing) {
      [preferences] = await db
        .update(user_preferences)
        .set(prefData as any)
        .where(eq(user_preferences.user_id, user.id))
        .returning();
    } else {
      [preferences] = await db
        .insert(user_preferences)
        .values({ user_id: user.id, ...(prefData as any) })
        .returning();
    }

    return preferences;
  }

  // ── Onboarding ──
  //
  // onboarding_state is keyed by (user_id, profile_id). The account still pays,
  // but the intake belongs to the subject of care the request is acting as, so
  // a parent's answers never surface under their child's profile.
  //
  // profileId arrives from `profileContext`, which has already proved the
  // account owns it (404 otherwise). These methods scope; they do not
  // re-authorise. The event path has no request context — see subscribers.ts.

  /**
   * The account owner's own profile, for the reads that predate the
   * active-profile header. Null until ProfileService has created one.
   */
  private async findSelfProfileId(accountUserId: string): Promise<string | null> {
    const [self] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(and(eq(profiles.account_user_id, accountUserId), eq(profiles.is_self, true)))
      .limit(1);
    return self?.id ?? null;
  }

  /** Resolve the internal users row for an authenticated account. */
  private async resolveAccount(authId: string) {
    const [user] = await db.select().from(users).where(eq(users.auth_id, authId)).limit(1);
    if (!user) throw new NotFoundError('User');
    return user;
  }

  private async findOnboardingState(userId: string, profileId: string) {
    const [state] = await db
      .select()
      .from(onboarding_state)
      .where(and(eq(onboarding_state.user_id, userId), eq(onboarding_state.profile_id, profileId)))
      .limit(1);
    return state ?? null;
  }

  /**
   * Seed an empty intake for one subject of care.
   *
   * Split out of createProfileDefaults because the self profile is only created
   * once ProfileService is asked for it, which is after the account row lands.
   * A row written before that would carry a null profile_id and be invisible to
   * every scoped read here.
   */
  async initOnboardingState(authId: string, profileId: string) {
    const user = await this.resolveAccount(authId);
    await db
      .insert(onboarding_state)
      .values({ user_id: user.id, profile_id: profileId })
      .onConflictDoNothing();
  }

  async getOnboardingState(authId: string, profileId: string) {
    const user = await this.resolveAccount(authId);
    return this.findOnboardingState(user.id, profileId);
  }

  async saveOnboardingStep(
    authId: string,
    profileId: string,
    step: number,
    data: Record<string, unknown>,
  ) {
    const user = await this.resolveAccount(authId);
    const existingState = await this.findOnboardingState(user.id, profileId);

    const completedSteps = (existingState?.completed_steps as number[]) || [];
    const stepData = (existingState?.step_data as Record<string, unknown>) || {};

    if (!completedSteps.includes(step)) {
      completedSteps.push(step);
    }
    stepData[`step_${step}`] = data;

    const totalSteps = existingState?.total_steps || 5;
    const isCompleted = completedSteps.length >= totalSteps;

    let state: typeof onboarding_state.$inferSelect;
    if (existingState) {
      [state] = await db
        .update(onboarding_state)
        .set({
          current_step: Math.min(step + 1, totalSteps),
          completed_steps: completedSteps,
          step_data: stepData,
          is_completed: isCompleted,
          completed_at: isCompleted ? new Date() : undefined,
          updated_at: new Date(),
        })
        .where(eq(onboarding_state.id, existingState.id))
        .returning();
    } else {
      [state] = await db
        .insert(onboarding_state)
        .values({
          user_id: user.id,
          profile_id: profileId,
          current_step: Math.min(step + 1, totalSteps),
          completed_steps: completedSteps,
          step_data: stepData,
          is_completed: isCompleted,
          completed_at: isCompleted ? new Date() : undefined,
        })
        .returning();
    }

    return state;
  }

  async completeOnboarding(authId: string, profileId: string) {
    const user = await this.resolveAccount(authId);
    const existing = await this.findOnboardingState(user.id, profileId);

    let state: typeof onboarding_state.$inferSelect;
    if (existing) {
      [state] = await db
        .update(onboarding_state)
        .set({
          is_completed: true,
          completed_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(onboarding_state.id, existing.id))
        .returning();
    } else {
      [state] = await db
        .insert(onboarding_state)
        .values({
          user_id: user.id,
          profile_id: profileId,
          is_completed: true,
          completed_at: new Date(),
        })
        .returning();
    }

    return state;
  }

  // ── AI onboarding persistence ──
  //
  // The AI onboarding agent keeps the intake only in Redis (7-day TTL) and hands back a
  // final match payload. This maps that payload into the durable patient record so the health
  // data survives session expiry and shows up when the patient revisits their profile.
  // Clinical fields (conditions, medications, full payload) are stored ENCRYPTED, mirroring the
  // manual health-profile write. Idempotent upsert — safe to call again on a re-match.
  async applyOnboardingPayload(
    authId: string,
    profileId: string,
    payload: Record<string, unknown>,
  ) {
    const [user] = await db.select().from(users).where(eq(users.auth_id, authId)).limit(1);
    if (!user) {
      throw new NotFoundError('User');
    }

    const asStrings = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        : [];
    const asString = (v: unknown): string | undefined =>
      typeof v === 'string' && v.trim().length > 0 ? v : undefined;

    // ── users.gender (agent uses "other"; DB enum uses "non_binary") ──
    const genderMap: Record<string, string> = {
      male: 'male',
      female: 'female',
      other: 'non_binary',
      non_binary: 'non_binary',
      prefer_not_to_say: 'prefer_not_to_say',
    };
    const gender = asString(payload.gender);
    if (gender && genderMap[gender]) {
      await db
        .update(users)
        .set({ gender: genderMap[gender] as any, updated_at: new Date() })
        .where(eq(users.id, user.id));
    }

    // ── user_profiles.preferred_session_type ← consultation_mode ──
    const mode = asString(payload.consultation_mode);
    if (mode) {
      const [existingProfile] = await db
        .select({ id: user_profiles.id })
        .from(user_profiles)
        .where(eq(user_profiles.user_id, user.id))
        .limit(1);
      if (existingProfile) {
        await db
          .update(user_profiles)
          .set({ preferred_session_type: mode, updated_at: new Date() })
          .where(eq(user_profiles.user_id, user.id));
      } else {
        await db.insert(user_profiles).values({ user_id: user.id, preferred_session_type: mode });
      }
    }

    // ── health_profiles: symptoms/complaints + medications, encrypted ──
    const conditions = [
      ...asStrings(payload.chief_complaints),
      ...asStrings(payload.conditions_icd_codes),
    ];
    const medications = asStrings(payload.medications_tried);
    const healthData: Record<string, unknown> = { updated_at: new Date() };
    if (conditions.length)
      healthData.medical_conditions_encrypted = encrypt(
        JSON.stringify(conditions),
        this.encryptionKey,
      );
    if (medications.length)
      healthData.medications_encrypted = encrypt(JSON.stringify(medications), this.encryptionKey);
    if (Object.keys(healthData).length > 1) {
      const [existingHealth] = await db
        .select({ id: health_profiles.id })
        .from(health_profiles)
        .where(eq(health_profiles.user_id, user.id))
        .limit(1);
      if (existingHealth) {
        await db
          .update(health_profiles)
          .set(healthData as any)
          .where(eq(health_profiles.user_id, user.id));
      } else {
        await db.insert(health_profiles).values({ user_id: user.id, ...(healthData as any) });
      }
    }

    // ── onboarding_state: mark complete + store the FULL payload encrypted inside step_data ──
    // (encrypted string kept in the existing jsonb column — no schema migration needed).
    const existingState = await this.findOnboardingState(user.id, profileId);
    const stepData = (existingState?.step_data as Record<string, unknown>) || {};
    stepData.ai_onboarding = {
      source: 'ai_onboarding',
      session_id: asString(payload.session_id) ?? null,
      for_whom: asString(payload.for_whom) ?? 'self',
      age_group: asString(payload.patient_age_group) ?? null,
      consultation_mode: mode ?? null,
      urgency: asString(payload.urgency) ?? null,
      urgency_level: asString(payload.urgency_level) ?? null,
      specialties_needed: asStrings(payload.specialties_needed),
      language_preference: asStrings(payload.language_preference),
    };
    stepData.ai_onboarding_encrypted = encrypt(JSON.stringify(payload), this.encryptionKey);

    if (existingState) {
      await db
        .update(onboarding_state)
        .set({
          is_completed: true,
          completed_at: new Date(),
          step_data: stepData,
          updated_at: new Date(),
        })
        .where(eq(onboarding_state.id, existingState.id));
    } else {
      await db.insert(onboarding_state).values({
        user_id: user.id,
        profile_id: profileId,
        is_completed: true,
        completed_at: new Date(),
        step_data: stepData,
      });
    }

    logger.info({ userId: user.id, authId }, 'AI onboarding payload persisted to durable profile');
    return { userId: user.id };
  }

  // ── Consents (proxy to auth service) ──

  async getConsents(authId: string) {
    const authClient = createServiceClient(
      'user-provider-service',
      config.AUTH_SERVICE_URL,
      config.HMAC_SECRET,
    );

    return authClient.get(`/internal/auth/consents/${authId}`);
  }

  // ── GDPR ──

  async requestDataExport(authId: string, exportType: 'dsar' | 'portable' = 'dsar') {
    const [user] = await db.select().from(users).where(eq(users.auth_id, authId)).limit(1);

    if (!user) {
      throw new NotFoundError('User');
    }

    const [existing] = await db
      .select()
      .from(data_export_requests)
      .where(
        and(
          eq(data_export_requests.user_id, user.id),
          inArray(data_export_requests.status, ['pending', 'processing']),
        ),
      )
      .limit(1);

    if (existing) {
      throw new ConflictError('An export request is already in progress');
    }

    const [exportRequest] = await db
      .insert(data_export_requests)
      .values({
        user_id: user.id,
        export_type: exportType,
        status: 'pending',
      })
      .returning();

    return exportRequest;
  }

  async requestGdprErasure(authId: string) {
    const [user] = await db.select().from(users).where(eq(users.auth_id, authId)).limit(1);

    if (!user) {
      throw new NotFoundError('User');
    }

    const [existing] = await db
      .select()
      .from(gdpr_erasure_requests)
      .where(
        and(
          eq(gdpr_erasure_requests.user_id, user.id),
          inArray(gdpr_erasure_requests.status, ['pending', 'processing']),
        ),
      )
      .limit(1);

    if (existing) {
      throw new ConflictError('An erasure request is already in progress');
    }

    const gracePeriodEnds = new Date();
    gracePeriodEnds.setDate(gracePeriodEnds.getDate() + 30);

    const [erasureRequest] = await db
      .insert(gdpr_erasure_requests)
      .values({
        user_id: user.id,
        status: 'pending',
        grace_period_ends: gracePeriodEnds,
      })
      .returning();

    return erasureRequest;
  }

  async getGdprErasureStatus(authId: string) {
    const [user] = await db.select().from(users).where(eq(users.auth_id, authId)).limit(1);

    if (!user) {
      throw new NotFoundError('User');
    }

    const [request] = await db
      .select()
      .from(gdpr_erasure_requests)
      .where(eq(gdpr_erasure_requests.user_id, user.id))
      .orderBy(desc(gdpr_erasure_requests.created_at))
      .limit(1);

    return request || null;
  }

  async cancelGdprErasure(authId: string) {
    const [user] = await db.select().from(users).where(eq(users.auth_id, authId)).limit(1);

    if (!user) {
      throw new NotFoundError('User');
    }

    const [request] = await db
      .select()
      .from(gdpr_erasure_requests)
      .where(
        and(
          eq(gdpr_erasure_requests.user_id, user.id),
          eq(gdpr_erasure_requests.status, 'pending'),
        ),
      )
      .orderBy(desc(gdpr_erasure_requests.created_at))
      .limit(1);

    if (!request) {
      throw new NotFoundError('Erasure request');
    }

    if (new Date() > request.grace_period_ends) {
      throw new BadRequestError('Grace period has expired, erasure cannot be cancelled');
    }

    const [updated] = await db
      .update(gdpr_erasure_requests)
      .set({ status: 'cancelled', cancelled_at: new Date() })
      .where(eq(gdpr_erasure_requests.id, request.id))
      .returning();

    return updated;
  }

  async executeDataExport(exportRequestId: string) {
    const [exportRequest] = await db
      .select()
      .from(data_export_requests)
      .where(eq(data_export_requests.id, exportRequestId))
      .limit(1);

    if (!exportRequest) {
      throw new NotFoundError('Export request');
    }

    const userId = exportRequest.user_id;

    await db
      .update(data_export_requests)
      .set({ status: 'processing' })
      .where(eq(data_export_requests.id, exportRequestId));

    try {
      const localData = await this.getAllUserDataForGdpr(userId);

      const [user] = await db
        .select({ auth_id: users.auth_id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!user) throw new NotFoundError('User', userId);
      const credentialId = user.auth_id;

      const authClient = createServiceClient(
        'user-provider-service',
        config.AUTH_SERVICE_URL,
        config.HMAC_SECRET,
      );
      const authData = await authClient
        .get(`/internal/gdpr/user-data/${credentialId}`)
        .catch((err: Error) => {
          logger.warn(
            { credentialId, error: err.message },
            'Failed to fetch auth data for DSAR export',
          );
          return { error: 'Failed to fetch auth data', details: err.message };
        });

      const bookingClient = createServiceClient(
        'user-provider-service',
        config.BOOKING_SERVICE_URL,
        config.HMAC_SECRET,
      );
      const bookingData = await bookingClient
        .get(`/internal/gdpr/user-data/${userId}`)
        .catch((err: Error) => {
          logger.warn(
            { userId, error: err.message },
            'Failed to fetch booking data for DSAR export',
          );
          return { error: 'Failed to fetch booking data', details: err.message };
        });

      const aiContentClient = createServiceClient(
        'user-provider-service',
        config.AI_CONTENT_SERVICE_URL,
        config.HMAC_SECRET,
      );
      const aiContentData = await aiContentClient
        .get(`/internal/gdpr/user-data/${userId}`)
        .catch((err: Error) => {
          logger.warn(
            { userId, error: err.message },
            'Failed to fetch AI content data for DSAR export',
          );
          return { error: 'Failed to fetch AI content data', details: err.message };
        });

      const paymentClient = createServiceClient(
        'user-provider-service',
        config.PAYMENT_SERVICE_URL,
        config.HMAC_SECRET,
      );
      const paymentData = await paymentClient
        .get(`/internal/gdpr/user-data/${userId}`)
        .catch((err: Error) => {
          logger.warn(
            { userId, error: err.message },
            'Failed to fetch payment data for DSAR export',
          );
          return { error: 'Failed to fetch payment data', details: err.message };
        });

      const combinedExport = {
        exportedAt: new Date().toISOString(),
        exportType: exportRequest.export_type,
        userId,
        userData: localData,
        authData,
        bookingData,
        aiContentData,
        paymentData,
      };

      const exportKey = `gdpr-exports/${userId}/${exportRequestId}.json`;
      const exportBody = JSON.stringify(combinedExport, null, 2);

      const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
      const s3 = new S3Client({
        region: config.AWS_REGION,
        endpoint: config.AWS_ENDPOINT_URL,
        forcePathStyle: true,
        credentials: {
          accessKeyId: config.AWS_ACCESS_KEY_ID,
          secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
        },
      });

      await s3.send(
        new PutObjectCommand({
          Bucket: config.S3_EXPORTS_BUCKET,
          Key: exportKey,
          Body: exportBody,
          ContentType: 'application/json',
        }),
      );

      const downloadUrl = `${config.AWS_ENDPOINT_URL}/${config.S3_EXPORTS_BUCKET}/${exportKey}`;

      await db
        .update(data_export_requests)
        .set({
          status: 'completed',
          file_url: downloadUrl,
          completed_at: new Date(),
        })
        .where(eq(data_export_requests.id, exportRequestId));

      logger.info({ userId, exportRequestId }, 'DSAR export completed successfully');
      return { exportRequestId, downloadUrl, status: 'completed' };
    } catch (error) {
      logger.error({ userId, exportRequestId, error }, 'DSAR export failed');
      await db
        .update(data_export_requests)
        .set({ status: 'failed' })
        .where(eq(data_export_requests.id, exportRequestId));
      throw error;
    }
  }

  async getPortableExport(authId: string, format: 'json' | 'csv' = 'json') {
    const [user] = await db.select().from(users).where(eq(users.auth_id, authId)).limit(1);

    if (!user) {
      throw new NotFoundError('User');
    }

    const [profile] = await db
      .select()
      .from(user_profiles)
      .where(eq(user_profiles.user_id, user.id))
      .limit(1);
    const [healthProfile] = await db
      .select()
      .from(health_profiles)
      .where(eq(health_profiles.user_id, user.id))
      .limit(1);
    const [prefs] = await db
      .select()
      .from(user_preferences)
      .where(eq(user_preferences.user_id, user.id))
      .limit(1);
    // One row per profile, not one per account — see getAllUserDataForGdpr.
    const obState = await db
      .select()
      .from(onboarding_state)
      .where(eq(onboarding_state.user_id, user.id));
    const progressData = await db
      .select()
      .from(progress_entries)
      .where(eq(progress_entries.user_id, user.id));
    const habitsData = await db.select().from(habits).where(eq(habits.user_id, user.id));
    const goalsData = await db.select().from(goals).where(eq(goals.user_id, user.id));
    const checkinsData = await db
      .select()
      .from(habit_checkins)
      .where(eq(habit_checkins.user_id, user.id));
    const achievementsData = await db
      .select()
      .from(achievements)
      .where(eq(achievements.user_id, user.id));
    const reviewsData = await db.select().from(reviews).where(eq(reviews.user_id, user.id));
    const savedData = await db.select().from(saved_items).where(eq(saved_items.user_id, user.id));
    const rroData = await this.getProfileScopedDataForGdpr(user.id);

    const decryptedHealth = healthProfile ? this.decryptHealthProfile(healthProfile as any) : null;

    const habitsWithCheckins = habitsData.map((h) => ({
      ...h,
      checkins: checkinsData.filter((c) => c.habit_id === h.id),
    }));

    const jsonData = {
      exportedAt: new Date().toISOString(),
      user: this.sanitizeUser({ ...user, profile, preferences: prefs }),
      healthProfile: decryptedHealth,
      preferences: prefs,
      onboardingStates: obState,
      progressEntries: progressData,
      habits: habitsWithCheckins,
      goals: goalsData,
      achievements: achievementsData,
      reviews: reviewsData,
      savedItems: savedData,
      ...rroData,
    };

    if (format === 'csv') {
      return this.convertPortableExportToCSV(jsonData);
    }

    return jsonData;
  }

  private convertPortableExportToCSV(data: Record<string, unknown>): Record<string, string> {
    const sections: Record<string, string> = {};

    const userData = data.user as Record<string, unknown> | null;
    if (userData) sections['profile.csv'] = toCSV([this.flattenObject(userData)]);

    const health = data.healthProfile as Record<string, unknown> | null;
    if (health) sections['health.csv'] = toCSV([this.flattenObject(health)]);

    const prefs = data.preferences as Record<string, unknown> | null;
    if (prefs) sections['preferences.csv'] = toCSV([this.flattenObject(prefs)]);

    const progress = data.progressEntries as Record<string, unknown>[] | null;
    if (progress && progress.length > 0)
      sections['progress.csv'] = toCSV(progress.map((e) => this.flattenObject(e)));

    const habitsArr = data.habits as Array<
      Record<string, unknown> & { checkins?: Record<string, unknown>[] }
    > | null;
    if (habitsArr && habitsArr.length > 0) {
      sections['habits.csv'] = toCSV(
        habitsArr.map(({ checkins, ...rest }) => this.flattenObject(rest)),
      );
      const allCheckins = habitsArr.flatMap((h) =>
        (h.checkins || []).map((c) => ({ ...this.flattenObject(c), habit_id: String(h.id ?? '') })),
      );
      if (allCheckins.length > 0) sections['habit_checkins.csv'] = toCSV(allCheckins);
    }

    const achievementsArr = data.achievements as Record<string, unknown>[] | null;
    if (achievementsArr && achievementsArr.length > 0)
      sections['achievements.csv'] = toCSV(achievementsArr.map((a) => this.flattenObject(a)));

    const reviewsArr = data.reviews as Record<string, unknown>[] | null;
    if (reviewsArr && reviewsArr.length > 0)
      sections['reviews.csv'] = toCSV(reviewsArr.map((r) => this.flattenObject(r)));

    const savedArr = data.savedItems as Record<string, unknown>[] | null;
    if (savedArr && savedArr.length > 0)
      sections['saved_items.csv'] = toCSV(savedArr.map((s) => this.flattenObject(s)));

    // The profile-scoped (RRO) tables. Each is a flat list, so one file each
    // keeps the CSV export as complete as the JSON one.
    for (const [key, file] of Object.entries(RRO_CSV_SECTIONS)) {
      const rows = data[key] as Record<string, unknown>[] | null;
      if (rows && rows.length > 0) sections[file] = toCSV(rows.map((r) => this.flattenObject(r)));
    }

    return sections;
  }

  private flattenObject(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}_${key}` : key;
      if (value === null || value === undefined) result[fullKey] = '';
      else if (Array.isArray(value)) result[fullKey] = JSON.stringify(value);
      else if (typeof value === 'object' && value instanceof Date)
        result[fullKey] = value.toISOString();
      else if (typeof value === 'object')
        Object.assign(result, this.flattenObject(value as Record<string, unknown>, fullKey));
      else result[fullKey] = value;
    }
    return result;
  }

  // ── Internal endpoints ──

  async getUserById(userId: string) {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user) {
      throw new NotFoundError('User', userId);
    }

    const [profile] = await db
      .select()
      .from(user_profiles)
      .where(eq(user_profiles.user_id, user.id))
      .limit(1);
    const [preferences] = await db
      .select()
      .from(user_preferences)
      .where(eq(user_preferences.user_id, user.id))
      .limit(1);

    return this.sanitizeUser({ ...user, profile, preferences });
  }

  async getSanitizedHealthProfile(userId: string) {
    const [healthProfile] = await db
      .select()
      .from(health_profiles)
      .where(eq(health_profiles.user_id, userId))
      .limit(1);

    if (!healthProfile) return null;

    return {
      id: healthProfile.id,
      userId: healthProfile.user_id,
      heightCm: healthProfile.height_cm,
      weightKg: healthProfile.weight_kg,
      bloodType: healthProfile.blood_type,
      notes: healthProfile.notes,
      consentHealthSharing: healthProfile.consent_health_sharing,
      consentAiAnalysis: healthProfile.consent_ai_analysis,
      lastCheckupDate: healthProfile.last_checkup_date,
    };
  }

  // ── Profile-scoped (RRO) data: export & erasure ──

  /**
   * The ids of every profile under this account.
   *
   * The seven RRO tables are keyed by profile, not by account, and carry no
   * foreign keys, so nothing cascades from the account row. Both the export and
   * the erasure have to start from this list or they silently miss every
   * dependent — people who never consented themselves and have no login of
   * their own to ask with.
   */
  private async accountProfileIds(accountUserId: string): Promise<string[]> {
    const rows = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.account_user_id, accountUserId));
    return rows.map((row) => row.id);
  }

  /** Decrypt a stored blob for the data subject's own export — never for an API response. */
  private decryptForExport(value: string | null): string | null {
    if (!value) return null;
    try {
      return decrypt(value, this.encryptionKey);
    } catch {
      // A blob written under a retired key must not fail the whole export; the
      // subject still receives everything else.
      return null;
    }
  }

  /**
   * Everything the RRO tables hold for this account, shaped for a GDPR export.
   *
   * PII is decrypted — the subject is entitled to their own data — while the
   * `*_hash` lookup columns are dropped: a correlation key is an implementation
   * detail of ours, not personal data of theirs.
   */
  private async getProfileScopedDataForGdpr(accountUserId: string) {
    const profileRows = await db
      .select()
      .from(profiles)
      .where(eq(profiles.account_user_id, accountUserId));
    const profileIds = profileRows.map((row) => row.id);

    if (profileIds.length === 0) {
      return {
        profiles: [],
        caregiverConsents: [],
        caregiverConsentAudit: [],
        rroStates: [],
        rroTransitions: [],
        notificationTargets: [],
        notificationLog: [],
      };
    }

    const [consents, consentAudit, states, transitions, targets, notifications] = await Promise.all(
      [
        db
          .select()
          .from(caregiver_consent)
          .where(inArray(caregiver_consent.profile_id, profileIds)),
        db
          .select()
          .from(caregiver_consent_audit)
          .where(inArray(caregiver_consent_audit.profile_id, profileIds)),
        db.select().from(rro_state).where(inArray(rro_state.profile_id, profileIds)),
        db.select().from(rro_transition).where(inArray(rro_transition.profile_id, profileIds)),
        db
          .select()
          .from(notification_targets)
          .where(inArray(notification_targets.profile_id, profileIds)),
        db.select().from(notification_log).where(inArray(notification_log.profile_id, profileIds)),
      ],
    );

    return {
      profiles: profileRows.map(
        ({ phone_encrypted, date_of_birth_encrypted, phone_hash: _hash, ...rest }) => ({
          ...rest,
          phone: this.decryptForExport(phone_encrypted),
          dateOfBirth: this.decryptForExport(date_of_birth_encrypted),
        }),
      ),
      caregiverConsents: consents,
      caregiverConsentAudit: consentAudit,
      rroStates: states,
      rroTransitions: transitions,
      notificationTargets: targets.map(
        ({ destination_encrypted, destination_hash: _hash, ...rest }) => ({
          ...rest,
          destination: this.decryptForExport(destination_encrypted),
        }),
      ),
      notificationLog: notifications,
    };
  }

  async getAllUserDataForGdpr(userId: string) {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user) {
      throw new NotFoundError('User', userId);
    }

    const [profile] = await db
      .select()
      .from(user_profiles)
      .where(eq(user_profiles.user_id, userId))
      .limit(1);
    const [healthProfile] = await db
      .select()
      .from(health_profiles)
      .where(eq(health_profiles.user_id, userId))
      .limit(1);
    const [prefs] = await db
      .select()
      .from(user_preferences)
      .where(eq(user_preferences.user_id, userId))
      .limit(1);
    // One row per profile, not one row per account: a `LIMIT 1` here dropped
    // every profile's onboarding but one from the export.
    const obState = await db
      .select()
      .from(onboarding_state)
      .where(eq(onboarding_state.user_id, userId));
    const progressData = await db
      .select()
      .from(progress_entries)
      .where(eq(progress_entries.user_id, userId));
    const habitsData = await db.select().from(habits).where(eq(habits.user_id, userId));
    const goalsData = await db.select().from(goals).where(eq(goals.user_id, userId));
    const achievementsData = await db
      .select()
      .from(achievements)
      .where(eq(achievements.user_id, userId));
    const reviewsData = await db.select().from(reviews).where(eq(reviews.user_id, userId));
    const savedData = await db.select().from(saved_items).where(eq(saved_items.user_id, userId));
    const rroData = await this.getProfileScopedDataForGdpr(userId);

    return {
      user,
      profile,
      healthProfile,
      preferences: prefs,
      onboardingStates: obState,
      progressEntries: progressData,
      habits: habitsData,
      goals: goalsData,
      achievements: achievementsData,
      reviews: reviewsData,
      savedItems: savedData,
      ...rroData,
    };
  }

  /**
   * GDPR erasure for an account and everyone under it.
   *
   * Two scopes, because the data has two shapes. Account-scoped tables hang off
   * `users.id`. Profile-scoped tables hang off `profiles.id`, have no foreign
   * keys back to the account and therefore never cascade — a dependent parent
   * profile would otherwise keep their name, email, notes, encrypted DOB and
   * phone after the only person who could ask for erasure had asked for it.
   *
   * Deleted, in child-before-parent order so no row is ever orphaned mid-erasure.
   *
   * KEPT DELIBERATELY:
   *   - `phi_access_log` — an access record, not user content. Deleting it would
   *     destroy the evidence that the erasure happened and who touched the data
   *     before it. It holds ids, routes and timestamps, no names or health data.
   *   - `caregiver_consent_audit` — the proof that consent was granted and
   *     revoked lawfully. Both tables are append-only in the database (see
   *     db/enforce-append-only.sql); an UPDATE or DELETE against either raises
   *     `insufficient_privilege`, so this method must not touch them.
   *   - the `users` row itself, anonymised rather than deleted: other services
   *     (bookings, payments) reference it and have their own retention duties.
   */
  async deleteAllUserData(userId: string) {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user) {
      throw new NotFoundError('User', userId);
    }

    const profileIds = await this.accountProfileIds(userId);

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          email: `deleted_${userId}@erased.longeny.com`,
          first_name: 'Deleted',
          last_name: 'User',
          phone_encrypted: null,
          phone_hash: null,
          avatar_url: null,
          date_of_birth_encrypted: null,
          status: 'deactivated',
          updated_at: new Date(),
        })
        .where(eq(users.id, userId));

      // ── Profile-scoped, child first ──
      if (profileIds.length > 0) {
        // Bodies and subjects of parent notifications are content, not audit.
        await tx.delete(notification_log).where(inArray(notification_log.profile_id, profileIds));
        await tx
          .delete(notification_targets)
          .where(inArray(notification_targets.profile_id, profileIds));
        await tx.delete(rro_transition).where(inArray(rro_transition.profile_id, profileIds));
        await tx.delete(rro_state).where(inArray(rro_state.profile_id, profileIds));
        await tx.delete(caregiver_consent).where(inArray(caregiver_consent.profile_id, profileIds));

        // Health data written while acting as a dependent profile. These rows
        // are also matched by user_id below, but `user_id` on them is not
        // consistent — routes that read the JWT store the auth_id there while
        // service-side writes store users.id (see db/backfill-profile-ids.ts),
        // so the profile scope is what actually guarantees they all go.
        await tx.delete(habit_checkins).where(inArray(habit_checkins.profile_id, profileIds));
        await tx.delete(habits).where(inArray(habits.profile_id, profileIds));
        await tx.delete(goals).where(inArray(goals.profile_id, profileIds));
        await tx.delete(progress_entries).where(inArray(progress_entries.profile_id, profileIds));
        await tx.delete(health_profiles).where(inArray(health_profiles.profile_id, profileIds));
        await tx.delete(onboarding_state).where(inArray(onboarding_state.profile_id, profileIds));

        // The profiles themselves last: everything above pointed at them.
        await tx.delete(profiles).where(inArray(profiles.id, profileIds));
      }

      // ── Account-scoped ──
      await tx.delete(user_profiles).where(eq(user_profiles.user_id, userId));
      await tx.delete(health_profiles).where(eq(health_profiles.user_id, userId));
      await tx.delete(onboarding_state).where(eq(onboarding_state.user_id, userId));
      await tx.delete(user_preferences).where(eq(user_preferences.user_id, userId));
      await tx.delete(progress_entries).where(eq(progress_entries.user_id, userId));
      await tx.delete(habit_checkins).where(eq(habit_checkins.user_id, userId));
      await tx.delete(habits).where(eq(habits.user_id, userId));
      await tx.delete(goals).where(eq(goals.user_id, userId));
      await tx.delete(achievements).where(eq(achievements.user_id, userId));
      await tx.delete(reviews).where(eq(reviews.user_id, userId));
      await tx.delete(saved_items).where(eq(saved_items.user_id, userId));
    });

    logger.info(
      { userId, profilesErased: profileIds.length },
      'GDPR erasure completed for account and its profiles',
    );
    return { success: true };
  }

  async getUserByIdPublic(userId: string) {
    return this.getUserById(userId);
  }

  async listUsers(filters: {
    search?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    const conditions: any[] = [];
    if (filters.status) conditions.push(eq(users.status, filters.status as any));
    if (filters.search) {
      conditions.push(
        or(
          ilike(users.email, `%${filters.search}%`),
          ilike(users.first_name, `%${filters.search}%`),
          ilike(users.last_name, `%${filters.search}%`),
        ),
      );
    }

    const { and: drizzleAnd } = await import('drizzle-orm');
    const whereClause = conditions.length > 0 ? drizzleAnd(...conditions) : undefined;

    const usersList = await db
      .select({
        id: users.id,
        auth_id: users.auth_id,
        email: users.email,
        first_name: users.first_name,
        last_name: users.last_name,
        avatar_url: users.avatar_url,
        status: users.status,
        timezone: users.timezone,
        created_at: users.created_at,
        updated_at: users.updated_at,
      })
      .from(users)
      .where(whereClause)
      .orderBy(desc(users.created_at))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await db.select({ count: db.$count(users, whereClause) }).from(users);
    const total = Number(count);

    return {
      data: usersList,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async createProfileDefaults(authId: string, email: string, firstName: string, lastName: string) {
    const [existing] = await db.select().from(users).where(eq(users.auth_id, authId)).limit(1);

    if (existing) {
      logger.warn({ authId }, 'User profile already exists, skipping creation');
      return existing;
    }

    const [user] = await db
      .insert(users)
      .values({
        auth_id: authId,
        email,
        first_name: firstName,
        last_name: lastName,
      })
      .returning();

    await db.insert(user_profiles).values({ user_id: user.id });
    await db.insert(user_preferences).values({ user_id: user.id });
    // onboarding_state is seeded by the subscriber once the self profile exists
    // — see initOnboardingState.

    logger.info({ userId: user.id, authId }, 'Created default profile for new user');
    return user;
  }

  // ── Private helpers ──

  private sanitizeUser(user: Record<string, unknown>) {
    const { phone_encrypted, phone_hash, date_of_birth_encrypted, ...rest } = user as any;
    const result: Record<string, unknown> = { ...rest };

    if (phone_encrypted) {
      try {
        result.phone = decrypt(phone_encrypted, this.encryptionKey);
      } catch {
        result.phone = null;
      }
    }

    if (date_of_birth_encrypted) {
      try {
        result.dateOfBirth = decrypt(date_of_birth_encrypted, this.encryptionKey);
      } catch {
        result.dateOfBirth = null;
      }
    }

    return result;
  }

  private decryptHealthProfile(profile: Record<string, unknown>) {
    const {
      allergies_encrypted,
      medical_conditions_encrypted,
      medications_encrypted,
      emergency_contact_encrypted,
      ...rest
    } = profile as any;

    const result: Record<string, unknown> = { ...rest };

    if (allergies_encrypted) {
      try {
        result.allergies = JSON.parse(decrypt(allergies_encrypted, this.encryptionKey));
      } catch {
        result.allergies = [];
      }
    }

    if (medical_conditions_encrypted) {
      try {
        result.medicalConditions = JSON.parse(
          decrypt(medical_conditions_encrypted, this.encryptionKey),
        );
      } catch {
        result.medicalConditions = [];
      }
    }

    if (medications_encrypted) {
      try {
        result.medications = JSON.parse(decrypt(medications_encrypted, this.encryptionKey));
      } catch {
        result.medications = [];
      }
    }

    if (emergency_contact_encrypted) {
      try {
        result.emergencyContact = decrypt(emergency_contact_encrypted, this.encryptionKey);
      } catch {
        result.emergencyContact = null;
      }
    }

    return result;
  }

  private decryptOnboardingState(state: Record<string, unknown>) {
    const stepData = (state.step_data as Record<string, unknown>) || {};
    const { ai_onboarding_encrypted, ...restStep } = stepData as any;

    let aiOnboardingDetail: Record<string, unknown> | null = null;
    if (ai_onboarding_encrypted) {
      try {
        aiOnboardingDetail = JSON.parse(decrypt(ai_onboarding_encrypted, this.encryptionKey));
      } catch {
        aiOnboardingDetail = null;
      }
    }

    return {
      is_completed: state.is_completed,
      current_step: state.current_step,
      total_steps: state.total_steps,
      completed_steps: state.completed_steps,
      completed_at: state.completed_at,
      updated_at: state.updated_at,
      step_data: restStep, // step_data without the encrypted blob
      aiOnboarding: aiOnboardingDetail, // full decrypted AI onboarding payload (symptoms, history, summaries)
    };
  }
}
