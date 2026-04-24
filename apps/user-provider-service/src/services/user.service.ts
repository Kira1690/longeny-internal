import { NotFoundError, ConflictError, BadRequestError } from '@longeny/errors';
import { encrypt, decrypt, createLogger, createServiceClient, toCSV } from '@longeny/utils';
import { config } from '../config/index.js';
import { db } from '../db/index.js';
import {
  users,
  user_profiles,
  health_profiles,
  onboarding_state,
  user_preferences,
  data_export_requests,
  gdpr_erasure_requests,
  progress_entries,
  habits,
  habit_checkins,
  achievements,
  reviews,
  saved_items,
} from '../db/schema.js';
import { eq, and, inArray, desc, ilike, or, sql } from 'drizzle-orm';

const logger = createLogger('user-service');

export class UserService {
  constructor(
    _prismaUnused: unknown,
    private encryptionKey: string,
  ) {}

  // ── Profile ──

  async getProfile(authId: string) {
    const [user] = await db.select().from(users).where(eq(users.auth_id, authId)).limit(1);

    if (!user) {
      throw new NotFoundError('User');
    }

    const [profile] = await db.select().from(user_profiles).where(eq(user_profiles.user_id, user.id)).limit(1);
    const [preferences] = await db.select().from(user_preferences).where(eq(user_preferences.user_id, user.id)).limit(1);

    return this.sanitizeUser({ ...user, profile, preferences });
  }

  async updateProfile(authId: string, data: {
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
  }) {
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
      userUpdate.phone_hash = data.phone;
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
      await tx.update(users).set(userUpdate as any).where(eq(users.id, user.id));

      if (Object.keys(profileUpdate).length > 1) { // > 1 because updated_at is always there
        const [existingProfile] = await tx.select({ id: user_profiles.id }).from(user_profiles).where(eq(user_profiles.user_id, user.id)).limit(1);
        if (existingProfile) {
          await tx.update(user_profiles).set(profileUpdate as any).where(eq(user_profiles.user_id, user.id));
        } else {
          await tx.insert(user_profiles).values({ user_id: user.id, ...profileUpdate as any });
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

    await db.update(users).set({ status: 'deactivated', updated_at: new Date() }).where(eq(users.id, user.id));

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

    const [healthProfile] = await db.select().from(health_profiles).where(eq(health_profiles.user_id, user.id)).limit(1);

    if (!healthProfile) {
      return null;
    }

    return this.decryptHealthProfile(healthProfile as any);
  }

  async updateHealthProfile(authId: string, data: {
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
  }) {
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
    if (data.consentHealthSharing !== undefined) profileData.consent_health_sharing = data.consentHealthSharing;
    if (data.consentAiAnalysis !== undefined) profileData.consent_ai_analysis = data.consentAiAnalysis;

    if (data.allergies) profileData.allergies_encrypted = encrypt(JSON.stringify(data.allergies), this.encryptionKey);
    if (data.medicalConditions) profileData.medical_conditions_encrypted = encrypt(JSON.stringify(data.medicalConditions), this.encryptionKey);
    if (data.medications) profileData.medications_encrypted = encrypt(JSON.stringify(data.medications), this.encryptionKey);
    if (data.emergencyContact) profileData.emergency_contact_encrypted = encrypt(data.emergencyContact, this.encryptionKey);

    const [existing] = await db.select({ id: health_profiles.id }).from(health_profiles).where(eq(health_profiles.user_id, user.id)).limit(1);

    let profile: any;
    if (existing) {
      [profile] = await db.update(health_profiles).set(profileData as any).where(eq(health_profiles.user_id, user.id)).returning();
    } else {
      [profile] = await db.insert(health_profiles).values({ user_id: user.id, ...profileData as any }).returning();
    }

    return this.decryptHealthProfile(profile);
  }

  // ── Preferences ──

  async getPreferences(authId: string) {
    const [user] = await db.select().from(users).where(eq(users.auth_id, authId)).limit(1);

    if (!user) {
      throw new NotFoundError('User');
    }

    const [prefs] = await db.select().from(user_preferences).where(eq(user_preferences.user_id, user.id)).limit(1);
    return prefs || null;
  }

  async updatePreferences(authId: string, data: {
    notifications?: { email?: boolean; sms?: boolean; push?: boolean };
    language?: string;
    theme?: string;
    newsletter?: boolean;
    bookingRemindersHours?: number;
  }) {
    const [user] = await db.select().from(users).where(eq(users.auth_id, authId)).limit(1);

    if (!user) {
      throw new NotFoundError('User');
    }

    const prefData: Record<string, unknown> = { updated_at: new Date() };
    if (data.notifications?.email !== undefined) prefData.notification_email = data.notifications.email;
    if (data.notifications?.sms !== undefined) prefData.notification_sms = data.notifications.sms;
    if (data.notifications?.push !== undefined) prefData.notification_push = data.notifications.push;
    if (data.language) prefData.language = data.language;
    if (data.theme) prefData.theme = data.theme;
    if (data.newsletter !== undefined) prefData.newsletter = data.newsletter;
    if (data.bookingRemindersHours !== undefined) prefData.booking_reminders_hours = data.bookingRemindersHours;

    const [existing] = await db.select({ id: user_preferences.id }).from(user_preferences).where(eq(user_preferences.user_id, user.id)).limit(1);

    let preferences: any;
    if (existing) {
      [preferences] = await db.update(user_preferences).set(prefData as any).where(eq(user_preferences.user_id, user.id)).returning();
    } else {
      [preferences] = await db.insert(user_preferences).values({ user_id: user.id, ...prefData as any }).returning();
    }

    return preferences;
  }

  // ── Onboarding ──

  async getOnboardingState(authId: string) {
    const [user] = await db.select().from(users).where(eq(users.auth_id, authId)).limit(1);

    if (!user) {
      throw new NotFoundError('User');
    }

    const [state] = await db.select().from(onboarding_state).where(eq(onboarding_state.user_id, user.id)).limit(1);
    return state || null;
  }

  async saveOnboardingStep(authId: string, step: number, data: Record<string, unknown>) {
    const [user] = await db.select().from(users).where(eq(users.auth_id, authId)).limit(1);

    if (!user) {
      throw new NotFoundError('User');
    }

    const [existingState] = await db.select().from(onboarding_state).where(eq(onboarding_state.user_id, user.id)).limit(1);

    const completedSteps = (existingState?.completed_steps as number[]) || [];
    const stepData = (existingState?.step_data as Record<string, unknown>) || {};

    if (!completedSteps.includes(step)) {
      completedSteps.push(step);
    }
    stepData[`step_${step}`] = data;

    const totalSteps = existingState?.total_steps || 5;
    const isCompleted = completedSteps.length >= totalSteps;

    let state: any;
    if (existingState) {
      [state] = await db.update(onboarding_state).set({
        current_step: Math.min(step + 1, totalSteps),
        completed_steps: completedSteps,
        step_data: stepData,
        is_completed: isCompleted,
        completed_at: isCompleted ? new Date() : undefined,
        updated_at: new Date(),
      }).where(eq(onboarding_state.user_id, user.id)).returning();
    } else {
      [state] = await db.insert(onboarding_state).values({
        user_id: user.id,
        current_step: Math.min(step + 1, totalSteps),
        completed_steps: completedSteps,
        step_data: stepData,
        is_completed: isCompleted,
        completed_at: isCompleted ? new Date() : undefined,
      }).returning();
    }

    return state;
  }

  async completeOnboarding(authId: string) {
    const [user] = await db.select().from(users).where(eq(users.auth_id, authId)).limit(1);

    if (!user) {
      throw new NotFoundError('User');
    }

    const [existing] = await db.select({ id: onboarding_state.id }).from(onboarding_state).where(eq(onboarding_state.user_id, user.id)).limit(1);

    let state: any;
    if (existing) {
      [state] = await db.update(onboarding_state).set({
        is_completed: true,
        completed_at: new Date(),
        updated_at: new Date(),
      }).where(eq(onboarding_state.user_id, user.id)).returning();
    } else {
      [state] = await db.insert(onboarding_state).values({
        user_id: user.id,
        is_completed: true,
        completed_at: new Date(),
      }).returning();
    }

    return state;
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

    const [exportRequest] = await db.insert(data_export_requests).values({
      user_id: user.id,
      export_type: exportType,
      status: 'pending',
    }).returning();

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

    const [erasureRequest] = await db.insert(gdpr_erasure_requests).values({
      user_id: user.id,
      status: 'pending',
      grace_period_ends: gracePeriodEnds,
    }).returning();

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
      .where(and(eq(gdpr_erasure_requests.user_id, user.id), eq(gdpr_erasure_requests.status, 'pending')))
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

    await db.update(data_export_requests).set({ status: 'processing' }).where(eq(data_export_requests.id, exportRequestId));

    try {
      const localData = await this.getAllUserDataForGdpr(userId);

      const [user] = await db.select({ auth_id: users.auth_id }).from(users).where(eq(users.id, userId)).limit(1);
      if (!user) throw new NotFoundError('User', userId);
      const credentialId = user.auth_id;

      const authClient = createServiceClient('user-provider-service', config.AUTH_SERVICE_URL, config.HMAC_SECRET);
      const authData = await authClient.get(`/internal/gdpr/user-data/${credentialId}`).catch((err: Error) => {
        logger.warn({ credentialId, error: err.message }, 'Failed to fetch auth data for DSAR export');
        return { error: 'Failed to fetch auth data', details: err.message };
      });

      const bookingClient = createServiceClient('user-provider-service', config.BOOKING_SERVICE_URL, config.HMAC_SECRET);
      const bookingData = await bookingClient.get(`/internal/gdpr/user-data/${userId}`).catch((err: Error) => {
        logger.warn({ userId, error: err.message }, 'Failed to fetch booking data for DSAR export');
        return { error: 'Failed to fetch booking data', details: err.message };
      });

      const aiContentClient = createServiceClient('user-provider-service', config.AI_CONTENT_SERVICE_URL, config.HMAC_SECRET);
      const aiContentData = await aiContentClient.get(`/internal/gdpr/user-data/${userId}`).catch((err: Error) => {
        logger.warn({ userId, error: err.message }, 'Failed to fetch AI content data for DSAR export');
        return { error: 'Failed to fetch AI content data', details: err.message };
      });

      const paymentClient = createServiceClient('user-provider-service', config.PAYMENT_SERVICE_URL, config.HMAC_SECRET);
      const paymentData = await paymentClient.get(`/internal/gdpr/user-data/${userId}`).catch((err: Error) => {
        logger.warn({ userId, error: err.message }, 'Failed to fetch payment data for DSAR export');
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

      await s3.send(new PutObjectCommand({
        Bucket: config.S3_EXPORTS_BUCKET,
        Key: exportKey,
        Body: exportBody,
        ContentType: 'application/json',
      }));

      const downloadUrl = `${config.AWS_ENDPOINT_URL}/${config.S3_EXPORTS_BUCKET}/${exportKey}`;

      await db.update(data_export_requests).set({
        status: 'completed',
        file_url: downloadUrl,
        completed_at: new Date(),
      }).where(eq(data_export_requests.id, exportRequestId));

      logger.info({ userId, exportRequestId }, 'DSAR export completed successfully');
      return { exportRequestId, downloadUrl, status: 'completed' };
    } catch (error) {
      logger.error({ userId, exportRequestId, error }, 'DSAR export failed');
      await db.update(data_export_requests).set({ status: 'failed' }).where(eq(data_export_requests.id, exportRequestId));
      throw error;
    }
  }

  async getPortableExport(authId: string, format: 'json' | 'csv' = 'json') {
    const [user] = await db.select().from(users).where(eq(users.auth_id, authId)).limit(1);

    if (!user) {
      throw new NotFoundError('User');
    }

    const [profile] = await db.select().from(user_profiles).where(eq(user_profiles.user_id, user.id)).limit(1);
    const [healthProfile] = await db.select().from(health_profiles).where(eq(health_profiles.user_id, user.id)).limit(1);
    const [prefs] = await db.select().from(user_preferences).where(eq(user_preferences.user_id, user.id)).limit(1);
    const [obState] = await db.select().from(onboarding_state).where(eq(onboarding_state.user_id, user.id)).limit(1);
    const progressData = await db.select().from(progress_entries).where(eq(progress_entries.user_id, user.id));
    const habitsData = await db.select().from(habits).where(eq(habits.user_id, user.id));
    const checkinsData = await db.select().from(habit_checkins).where(eq(habit_checkins.user_id, user.id));
    const achievementsData = await db.select().from(achievements).where(eq(achievements.user_id, user.id));
    const reviewsData = await db.select().from(reviews).where(eq(reviews.user_id, user.id));
    const savedData = await db.select().from(saved_items).where(eq(saved_items.user_id, user.id));

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
      onboardingState: obState,
      progressEntries: progressData,
      habits: habitsWithCheckins,
      achievements: achievementsData,
      reviews: reviewsData,
      savedItems: savedData,
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
    if (progress && progress.length > 0) sections['progress.csv'] = toCSV(progress.map((e) => this.flattenObject(e)));

    const habitsArr = data.habits as Array<Record<string, unknown> & { checkins?: Record<string, unknown>[] }> | null;
    if (habitsArr && habitsArr.length > 0) {
      sections['habits.csv'] = toCSV(habitsArr.map(({ checkins, ...rest }) => this.flattenObject(rest)));
      const allCheckins = habitsArr.flatMap((h) => (h.checkins || []).map((c) => ({ ...this.flattenObject(c), habit_id: String(h.id ?? '') })));
      if (allCheckins.length > 0) sections['habit_checkins.csv'] = toCSV(allCheckins);
    }

    const achievementsArr = data.achievements as Record<string, unknown>[] | null;
    if (achievementsArr && achievementsArr.length > 0) sections['achievements.csv'] = toCSV(achievementsArr.map((a) => this.flattenObject(a)));

    const reviewsArr = data.reviews as Record<string, unknown>[] | null;
    if (reviewsArr && reviewsArr.length > 0) sections['reviews.csv'] = toCSV(reviewsArr.map((r) => this.flattenObject(r)));

    const savedArr = data.savedItems as Record<string, unknown>[] | null;
    if (savedArr && savedArr.length > 0) sections['saved_items.csv'] = toCSV(savedArr.map((s) => this.flattenObject(s)));

    return sections;
  }

  private flattenObject(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}_${key}` : key;
      if (value === null || value === undefined) result[fullKey] = '';
      else if (Array.isArray(value)) result[fullKey] = JSON.stringify(value);
      else if (typeof value === 'object' && value instanceof Date) result[fullKey] = value.toISOString();
      else if (typeof value === 'object') Object.assign(result, this.flattenObject(value as Record<string, unknown>, fullKey));
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

    const [profile] = await db.select().from(user_profiles).where(eq(user_profiles.user_id, user.id)).limit(1);
    const [preferences] = await db.select().from(user_preferences).where(eq(user_preferences.user_id, user.id)).limit(1);

    return this.sanitizeUser({ ...user, profile, preferences });
  }

  async getSanitizedHealthProfile(userId: string) {
    const [healthProfile] = await db.select().from(health_profiles).where(eq(health_profiles.user_id, userId)).limit(1);

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

  async getAllUserDataForGdpr(userId: string) {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user) {
      throw new NotFoundError('User', userId);
    }

    const [profile] = await db.select().from(user_profiles).where(eq(user_profiles.user_id, userId)).limit(1);
    const [healthProfile] = await db.select().from(health_profiles).where(eq(health_profiles.user_id, userId)).limit(1);
    const [prefs] = await db.select().from(user_preferences).where(eq(user_preferences.user_id, userId)).limit(1);
    const [obState] = await db.select().from(onboarding_state).where(eq(onboarding_state.user_id, userId)).limit(1);
    const progressData = await db.select().from(progress_entries).where(eq(progress_entries.user_id, userId));
    const habitsData = await db.select().from(habits).where(eq(habits.user_id, userId));
    const achievementsData = await db.select().from(achievements).where(eq(achievements.user_id, userId));
    const reviewsData = await db.select().from(reviews).where(eq(reviews.user_id, userId));
    const savedData = await db.select().from(saved_items).where(eq(saved_items.user_id, userId));

    return {
      user,
      profile,
      healthProfile,
      preferences: prefs,
      onboardingState: obState,
      progressEntries: progressData,
      habits: habitsData,
      achievements: achievementsData,
      reviews: reviewsData,
      savedItems: savedData,
    };
  }

  async deleteAllUserData(userId: string) {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user) {
      throw new NotFoundError('User', userId);
    }

    await db.transaction(async (tx) => {
      await tx.update(users).set({
        email: `deleted_${userId}@erased.longeny.com`,
        first_name: 'Deleted',
        last_name: 'User',
        phone_encrypted: null,
        phone_hash: null,
        avatar_url: null,
        date_of_birth_encrypted: null,
        status: 'deactivated',
        updated_at: new Date(),
      }).where(eq(users.id, userId));

      await tx.delete(user_profiles).where(eq(user_profiles.user_id, userId));
      await tx.delete(health_profiles).where(eq(health_profiles.user_id, userId));
      await tx.delete(onboarding_state).where(eq(onboarding_state.user_id, userId));
      await tx.delete(user_preferences).where(eq(user_preferences.user_id, userId));
      await tx.delete(progress_entries).where(eq(progress_entries.user_id, userId));
      await tx.delete(habit_checkins).where(eq(habit_checkins.user_id, userId));
      await tx.delete(habits).where(eq(habits.user_id, userId));
      await tx.delete(achievements).where(eq(achievements.user_id, userId));
      await tx.delete(reviews).where(eq(reviews.user_id, userId));
      await tx.delete(saved_items).where(eq(saved_items.user_id, userId));
    });

    logger.info({ userId }, 'GDPR erasure completed for user');
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
      conditions.push(or(
        ilike(users.email, `%${filters.search}%`),
        ilike(users.first_name, `%${filters.search}%`),
        ilike(users.last_name, `%${filters.search}%`),
      ));
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

    const [user] = await db.insert(users).values({
      auth_id: authId,
      email,
      first_name: firstName,
      last_name: lastName,
    }).returning();

    await db.insert(user_profiles).values({ user_id: user.id });
    await db.insert(user_preferences).values({ user_id: user.id });
    await db.insert(onboarding_state).values({ user_id: user.id });

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
      try { result.allergies = JSON.parse(decrypt(allergies_encrypted, this.encryptionKey)); }
      catch { result.allergies = []; }
    }

    if (medical_conditions_encrypted) {
      try { result.medicalConditions = JSON.parse(decrypt(medical_conditions_encrypted, this.encryptionKey)); }
      catch { result.medicalConditions = []; }
    }

    if (medications_encrypted) {
      try { result.medications = JSON.parse(decrypt(medications_encrypted, this.encryptionKey)); }
      catch { result.medications = []; }
    }

    if (emergency_contact_encrypted) {
      try { result.emergencyContact = decrypt(emergency_contact_encrypted, this.encryptionKey); }
      catch { result.emergencyContact = null; }
    }

    return result;
  }
}
