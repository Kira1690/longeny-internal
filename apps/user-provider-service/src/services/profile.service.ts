import { BadRequestError, NotFoundError, UnprocessableEntityError } from '@longeny/errors';
import { type CaregiverConsentType, type RroState, isValidRroTransition } from '@longeny/types';
import { createLogger, decrypt, encrypt } from '@longeny/utils';
import { uuidSchema } from '@longeny/validators';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  caregiver_consent,
  caregiver_consent_audit,
  notification_log,
  notification_targets,
  profiles,
  rro_state,
  rro_transition,
  users,
} from '../db/schema.js';
import { lookupHash } from './lookup-hash.js';
import type { MailerService } from './mailer.service.js';

const logger = createLogger('profile-service');

// The state union comes from the taxonomy, not a second copy of it.
type RroStateValue = RroState;
type NotifyChannel = 'sms' | 'email' | 'calendar';

/**
 * ProfileService — multi-profile / family (RRO) tenancy.
 *
 * One authenticated account (users row, keyed by auth_id from the JWT) owns many
 * profiles. A profile is the SUBJECT of care. Parent/dependent profiles have no
 * login; they are reached only through notification_targets. Every method that
 * takes a profileId first proves the profile belongs to the calling account
 * (ownership guard) before touching any data.
 */
export class ProfileService {
  constructor(
    private encryptionKey: string,
    private mailer: MailerService,
  ) {}

  // ── Account resolution ──

  /** Resolve the internal users row for the authenticated account (auth_id → user). */
  private async resolveAccount(authId: string) {
    const [user] = await db.select().from(users).where(eq(users.auth_id, authId)).limit(1);
    if (!user) throw new NotFoundError('Account');
    return user;
  }

  /**
   * The single ownership gate and the one choke point for the "acting-as
   * profile" model. Every profile-scoped read and write goes through it, so the
   * rule lives here rather than in each handler.
   *
   * A deactivated profile is treated as gone. `DELETE` is a soft delete — the row
   * stays for audit — but to the caller the person has been removed, and every
   * route must agree with the list they see. Without the status check a deleted
   * profile stayed readable, editable, consentable and, worst of all,
   * contactable: a notification target could be added to it and a message
   * actually delivered to someone the account had removed.
   *
   * `includeInactive` exists for the few callers that must reach a deactivated
   * row on purpose — deactivation itself, so a repeated DELETE stays idempotent
   * rather than answering 404 the second time. It is opt-in precisely so that
   * adding a new route cannot pick it up by accident.
   *
   * Wrong owner, missing, and deactivated all raise the same NotFoundError: a
   * 403 would confirm the row exists.
   */
  async assertOwnership(
    authId: string,
    profileId: string,
    { includeInactive = false }: { includeInactive?: boolean } = {},
  ) {
    // Postgres raises on a malformed uuid cast, which surfaced as a 500 for any
    // client that passed a bad route parameter. Reject it here, before the
    // query, so every {id} route answers the same way. 400 rather than 404: the
    // id is syntactically not an id, which tells the caller nothing about
    // whether any profile exists.
    if (!uuidSchema.safeParse(profileId).success) {
      throw new BadRequestError('profileId must be a UUID');
    }

    const account = await this.resolveAccount(authId);
    const [profile] = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
    if (!profile || profile.account_user_id !== account.id) {
      throw new NotFoundError('Profile');
    }
    if (!includeInactive && profile.status !== 'active') {
      throw new NotFoundError('Profile');
    }
    return { account, profile };
  }

  /**
   * The ownership question, answered for another service.
   *
   * ai-content, booking and payment store profile-scoped rows in their own
   * databases and cannot join to `profiles`. They ask here instead, over HMAC,
   * so the rule that decides who may act as a profile exists once — in
   * `assertOwnership` above — rather than once per service.
   *
   * No `profileId` means the account owner's own `self` profile, matching a
   * request that carries no `X-Active-Profile-Id`.
   *
   * The reply carries no PII: an id, the relation and whether the profile is
   * still active. The caller needs to scope a query, not to render a person.
   */
  async resolveForService(authId: string, profileId?: string) {
    let resolved: {
      profileId: string;
      accountUserId: string;
      relation: string;
      isSelf: boolean;
      status: string;
    };
    if (!profileId) {
      const selfId = await this.getSelfProfileId(authId);
      const [self] = await db.select().from(profiles).where(eq(profiles.id, selfId)).limit(1);
      resolved = {
        profileId: selfId,
        accountUserId: self.account_user_id,
        relation: self.relation,
        isSelf: true,
        status: self.status,
      };
    } else {
      const { profile } = await this.assertOwnership(authId, profileId);
      resolved = {
        profileId: profile.id,
        accountUserId: profile.account_user_id,
        relation: profile.relation,
        isSelf: profile.is_self,
        status: profile.status,
      };
    }

    // The care stage travels with the ownership answer so a caller that
    // records "what stage was this person in" (a report upload) needs no second
    // call, and cannot read the stage of a profile it does not own.
    const [state] = await db
      .select({ current: rro_state.current_state })
      .from(rro_state)
      .where(eq(rro_state.profile_id, resolved.profileId))
      .limit(1);
    return { ...resolved, rroState: state?.current ?? null };
  }

  /** Ensure the account owner always has a canonical 'self' profile. */
  private async ensureSelfProfile(
    accountUserId: string,
    firstName: string,
    lastName: string | null,
  ) {
    const [existing] = await db
      .select()
      .from(profiles)
      .where(and(eq(profiles.account_user_id, accountUserId), eq(profiles.is_self, true)))
      .limit(1);
    if (existing) return existing;

    const [created] = await db
      .insert(profiles)
      .values({
        account_user_id: accountUserId,
        relation: 'self',
        is_self: true,
        first_name: firstName,
        last_name: lastName,
        status: 'active',
      })
      .returning();
    await this.initRroState(created.id, undefined, 'system');
    return created;
  }

  // ── Profiles CRUD ──

  /**
   * The account owner's own profile id, creating it if this is the first call.
   * Requests that carry no X-Active-Profile-Id act as this profile.
   */
  async getSelfProfileId(authId: string): Promise<string> {
    const account = await this.resolveAccount(authId);
    const self = await this.ensureSelfProfile(account.id, account.first_name, account.last_name);
    return self.id;
  }

  async listProfiles(authId: string) {
    const account = await this.resolveAccount(authId);
    await this.ensureSelfProfile(account.id, account.first_name, account.last_name);
    // Deactivated profiles are kept for audit, not shown. Without this filter a
    // DELETE reported success and the profile stayed in the caller's list.
    // `profiles_account_status_idx` covers exactly this pair.
    const rows = await db
      .select()
      .from(profiles)
      .where(and(eq(profiles.account_user_id, account.id), eq(profiles.status, 'active')))
      .orderBy(desc(profiles.is_self), desc(profiles.created_at));
    return rows.map((p) => this.sanitizeProfile(p));
  }

  async getProfile(authId: string, profileId: string) {
    const { profile } = await this.assertOwnership(authId, profileId);
    const [state] = await db
      .select()
      .from(rro_state)
      .where(eq(rro_state.profile_id, profileId))
      .limit(1);
    return { ...this.sanitizeProfile(profile), rroState: state ?? null };
  }

  async createProfile(
    authId: string,
    data: {
      relation: string;
      firstName: string;
      lastName?: string;
      email?: string;
      phone?: string;
      dateOfBirth?: string;
      gender?: string;
      avatarUrl?: string;
      notes?: string;
      goal?: string;
    },
  ) {
    const account = await this.resolveAccount(authId);
    await this.ensureSelfProfile(account.id, account.first_name, account.last_name);

    if (data.relation === 'self') {
      const [selfExists] = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(and(eq(profiles.account_user_id, account.id), eq(profiles.is_self, true)))
        .limit(1);
      if (selfExists) throw new BadRequestError('A self profile already exists for this account');
    }

    const [created] = await db
      .insert(profiles)
      .values({
        account_user_id: account.id,
        relation: data.relation as any,
        is_self: false,
        first_name: data.firstName,
        last_name: data.lastName ?? null,
        email: data.email ?? null,
        phone_encrypted: data.phone ? encrypt(data.phone, this.encryptionKey) : null,
        phone_hash: data.phone ? lookupHash(data.phone, this.encryptionKey) : null,
        date_of_birth_encrypted: data.dateOfBirth
          ? encrypt(data.dateOfBirth, this.encryptionKey)
          : null,
        gender: (data.gender as any) ?? null,
        avatar_url: data.avatarUrl ?? null,
        notes: data.notes ?? null,
        status: 'active',
      })
      .returning();

    await this.initRroState(created.id, data.goal, 'system');
    logger.info(`Profile created ${created.id} (${data.relation}) for account ${account.id}`);
    return this.getProfile(authId, created.id);
  }

  async updateProfile(authId: string, profileId: string, data: Record<string, any>) {
    await this.assertOwnership(authId, profileId);

    const update: Record<string, unknown> = { updated_at: new Date() };
    if (data.relation !== undefined) update.relation = data.relation;
    if (data.firstName !== undefined) update.first_name = data.firstName;
    if (data.lastName !== undefined) update.last_name = data.lastName;
    if (data.email !== undefined) update.email = data.email;
    if (data.gender !== undefined) update.gender = data.gender;
    if (data.avatarUrl !== undefined) update.avatar_url = data.avatarUrl;
    if (data.notes !== undefined) update.notes = data.notes;
    if (data.phone !== undefined) {
      update.phone_encrypted = data.phone ? encrypt(data.phone, this.encryptionKey) : null;
      update.phone_hash = data.phone ? lookupHash(data.phone, this.encryptionKey) : null;
    }
    if (data.dateOfBirth !== undefined) {
      update.date_of_birth_encrypted = data.dateOfBirth
        ? encrypt(data.dateOfBirth, this.encryptionKey)
        : null;
    }

    await db
      .update(profiles)
      .set(update as any)
      .where(eq(profiles.id, profileId));
    return this.getProfile(authId, profileId);
  }

  /**
   * Soft-deactivate a profile. The self profile cannot be deactivated.
   *
   * Reaches inactive rows so that deleting twice stays idempotent — a caller
   * retrying a request it already made should not be told the person never
   * existed.
   */
  async deactivateProfile(authId: string, profileId: string) {
    const { profile } = await this.assertOwnership(authId, profileId, { includeInactive: true });
    if (profile.is_self)
      throw new BadRequestError('The account owner (self) profile cannot be deactivated');
    await db
      .update(profiles)
      .set({ status: 'inactive', updated_at: new Date() })
      .where(eq(profiles.id, profileId));
    return { id: profileId, status: 'inactive' as const };
  }

  /**
   * Validate that the account may act as this profile and return the active
   * context. The model is stateless — the client sends X-Active-Profile-Id on
   * subsequent requests; this endpoint proves ownership up front.
   */
  async activateProfile(authId: string, profileId: string) {
    const { account, profile } = await this.assertOwnership(authId, profileId);
    if (profile.status !== 'active')
      throw new BadRequestError('Cannot switch to an inactive profile');
    const [state] = await db
      .select()
      .from(rro_state)
      .where(eq(rro_state.profile_id, profileId))
      .limit(1);
    return {
      accountUserId: account.id,
      activeProfileId: profile.id,
      profile: this.sanitizeProfile(profile),
      rroState: state ?? null,
    };
  }

  // ── Caregiver consent ──

  async recordConsent(
    authId: string,
    profileId: string,
    data: {
      // The taxonomy, not `string`. The validator already rejects anything else,
      // but typing it loosely here is what let the free-text column survive: a
      // second caller could reach this method without going through the route.
      consentType: CaregiverConsentType;
      status?: 'granted' | 'revoked';
      documentUrl?: string;
      notes?: string;
    },
  ) {
    const { account } = await this.assertOwnership(authId, profileId);
    const status = data.status ?? 'granted';

    const [existing] = await db
      .select()
      .from(caregiver_consent)
      .where(
        and(
          eq(caregiver_consent.profile_id, profileId),
          eq(caregiver_consent.consent_type, data.consentType),
        ),
      )
      .limit(1);

    let record: typeof caregiver_consent.$inferSelect;
    if (existing) {
      [record] = await db
        .update(caregiver_consent)
        .set({
          status,
          document_url: data.documentUrl ?? existing.document_url,
          notes: data.notes ?? existing.notes,
          revoked_at: status === 'revoked' ? new Date() : null,
          granted_at: status === 'granted' ? new Date() : existing.granted_at,
          granted_by: account.id,
          updated_at: new Date(),
        })
        .where(eq(caregiver_consent.id, existing.id))
        .returning();
    } else {
      [record] = await db
        .insert(caregiver_consent)
        .values({
          profile_id: profileId,
          account_user_id: account.id,
          consent_type: data.consentType,
          status,
          granted_by: account.id,
          revoked_at: status === 'revoked' ? new Date() : null,
          document_url: data.documentUrl ?? null,
          notes: data.notes ?? null,
        })
        .returning();
    }

    await db.insert(caregiver_consent_audit).values({
      consent_id: record.id,
      profile_id: profileId,
      action: existing ? 'updated' : status,
      actor_user_id: account.id,
      metadata: { consentType: data.consentType, status },
    });

    return record;
  }

  async getConsent(authId: string, profileId: string) {
    await this.assertOwnership(authId, profileId);
    const rows = await db
      .select()
      .from(caregiver_consent)
      .where(eq(caregiver_consent.profile_id, profileId))
      .orderBy(desc(caregiver_consent.updated_at));
    return rows;
  }

  // ── RRO state ──

  private async initRroState(profileId: string, goal: string | undefined, source: string) {
    await db.insert(rro_state).values({
      profile_id: profileId,
      current_state: 'intake',
      goal: goal ?? null,
    });
    await db.insert(rro_transition).values({
      profile_id: profileId,
      from_state: null,
      to_state: 'intake',
      reason: 'Profile created',
      source,
    });
  }

  async getRroState(authId: string, profileId: string) {
    await this.assertOwnership(authId, profileId);
    const [state] = await db
      .select()
      .from(rro_state)
      .where(eq(rro_state.profile_id, profileId))
      .limit(1);
    if (!state) throw new NotFoundError('RRO state');
    const history = await db
      .select()
      .from(rro_transition)
      .where(eq(rro_transition.profile_id, profileId))
      .orderBy(desc(rro_transition.created_at))
      .limit(20);
    return { ...state, history };
  }

  /**
   * Current RRO state and recent history for a trusted service caller.
   *
   * The classifier needs the profile's history to see a regression, and it
   * authenticates with HMAC rather than a user token, so it cannot use the
   * account-scoped read above. Ownership was already established by whichever
   * request triggered the classification.
   */
  async getRroStateForService(profileId: string) {
    await this.assertActiveProfileForService(profileId);

    const [state] = await db
      .select()
      .from(rro_state)
      .where(eq(rro_state.profile_id, profileId))
      .limit(1);

    const history = await db
      .select({
        state: rro_transition.to_state,
        enteredAt: rro_transition.created_at,
        source: rro_transition.source,
      })
      .from(rro_transition)
      .where(eq(rro_transition.profile_id, profileId))
      .orderBy(rro_transition.created_at)
      .limit(50);

    return {
      profileId,
      currentState: state?.current_state ?? null,
      goal: state?.goal ?? null,
      enteredAt: state?.entered_at ?? null,
      history,
    };
  }

  /**
   * The service-caller equivalent of `assertOwnership`.
   *
   * The internal HMAC routes are reached by another service, not by the account
   * holder, so there is no account to check ownership against and they never
   * pass through `assertOwnership`. What they still owe is its *status* rule: a
   * deactivated profile is gone. Three of them looked the row up directly and
   * checked only that it existed, so a removed person stayed reachable through
   * exactly the paths that act on their behalf — including the one that emails
   * a human being.
   *
   * It lives here, in one place, because the reason it was missed is that the
   * rule was written out by hand at each call site and one copy simply never
   * grew it.
   */
  private async assertActiveProfileForService(profileId: string) {
    const [profile] = await db
      .select({ id: profiles.id, status: profiles.status })
      .from(profiles)
      .where(eq(profiles.id, profileId))
      .limit(1);
    // Missing and deactivated answer the same way, as everywhere else.
    if (!profile || profile.status !== 'active') throw new NotFoundError('Profile');
    return profile;
  }

  /**
   * Record an RRO transition (internal — called by the AI classifier or a
   * clinician action via HMAC). Updates the current state and appends history.
   * No auth guard here: the caller is a trusted service. Profile existence is
   * still verified.
   *
   * The move itself is validated against the taxonomy. Care can advance, hold or
   * fall back one step; it cannot skip from `intake` to `optimise`. That rule
   * lived in `@longeny/types` and was called from nowhere, so any caller — the
   * classifier included — could write any state it liked. A move the model does
   * not permit is refused here, at the one place every caller passes through,
   * rather than in each caller.
   */
  async recordTransition(data: {
    profileId: string;
    toState: RroStateValue;
    reason?: string;
    source?: string;
    goal?: string;
    metadata?: Record<string, unknown>;
  }) {
    await this.assertActiveProfileForService(data.profileId);

    const [current] = await db
      .select()
      .from(rro_state)
      .where(eq(rro_state.profile_id, data.profileId))
      .limit(1);
    const fromState = current?.current_state ?? null;

    if (fromState && fromState !== data.toState && !isValidRroTransition(fromState, data.toState)) {
      throw new UnprocessableEntityError(
        `RRO state cannot move from '${fromState}' to '${data.toState}'`,
        'INVALID_TRANSITION',
        { from: fromState, to: data.toState },
      );
    }

    if (current) {
      await db
        .update(rro_state)
        .set({
          current_state: data.toState,
          goal: data.goal ?? current.goal,
          entered_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(rro_state.profile_id, data.profileId));
    } else {
      await db.insert(rro_state).values({
        profile_id: data.profileId,
        current_state: data.toState,
        goal: data.goal ?? null,
      });
    }

    const [transition] = await db
      .insert(rro_transition)
      .values({
        profile_id: data.profileId,
        from_state: fromState,
        to_state: data.toState,
        reason: data.reason ?? null,
        source: data.source ?? 'system',
        metadata: data.metadata ?? null,
      })
      .returning();

    logger.info(
      `RRO transition ${data.profileId}: ${fromState ?? 'none'} → ${data.toState} (${data.source ?? 'system'})`,
    );
    return {
      profileId: data.profileId,
      fromState,
      toState: data.toState,
      transitionId: transition.id,
    };
  }

  // ── Notification targets + parent notifications ──

  async addNotificationTarget(
    authId: string,
    profileId: string,
    data: {
      channel: NotifyChannel;
      destination: string;
      calendarId?: string;
    },
  ) {
    await this.assertOwnership(authId, profileId);
    const [target] = await db
      .insert(notification_targets)
      .values({
        profile_id: profileId,
        channel: data.channel,
        destination_encrypted: encrypt(data.destination, this.encryptionKey),
        destination_hash: lookupHash(data.destination, this.encryptionKey),
        calendar_id: data.calendarId ?? null,
      })
      .returning({
        id: notification_targets.id,
        profile_id: notification_targets.profile_id,
        channel: notification_targets.channel,
        is_active: notification_targets.is_active,
        created_at: notification_targets.created_at,
      });
    return target;
  }

  /**
   * Route a notification to a dependent profile that has no login.
   *
   * Fans out to the profile's active targets — every channel unless one is
   * named — and records each attempt in the log.
   *
   * Delivery is real for `email` and `calendar`: the message is sent and the log
   * row moves to `sent` or to `failed` with the reason. It used to stop at
   * `queued`, with nothing consuming the queue, so every message a family
   * believed had gone out had never left the building.
   *
   * `sms` has no transport yet, and is recorded as `failed` with that reason
   * rather than `queued`. A row that says queued is a promise that something
   * will send it; there is nothing to make that true, and a visible gap is worth
   * more than a comforting status.
   */
  async notifyProfile(data: {
    profileId: string;
    channel?: NotifyChannel;
    subject?: string;
    body: string;
    metadata?: Record<string, unknown>;
    /** An ICS invite, for the calendar channel. */
    attachment?: { filename: string; contentType: string; content: string; method?: string };
  }) {
    // A deactivated profile keeps its notification targets — the rows are
    // audit, not reach. Without this the account removed someone and a
    // scheduler still emailed them; verified live before the guard existed.
    await this.assertActiveProfileForService(data.profileId);

    const conditions = [
      eq(notification_targets.profile_id, data.profileId),
      eq(notification_targets.is_active, true),
    ];
    if (data.channel) conditions.push(eq(notification_targets.channel, data.channel));
    const targets = await db
      .select()
      .from(notification_targets)
      .where(and(...conditions));

    if (targets.length === 0) {
      const [entry] = await db
        .insert(notification_log)
        .values({
          profile_id: data.profileId,
          channel: data.channel ?? 'email',
          subject: data.subject ?? null,
          body: data.body,
          status: 'failed',
          error: 'No active notification target for this profile/channel',
          metadata: data.metadata ?? null,
        })
        .returning();
      return { profileId: data.profileId, delivered: 0, entries: [entry] };
    }

    const entries = [];
    let deliveredCount = 0;

    for (const target of targets) {
      // Recorded before the attempt, so a crash mid-send leaves evidence that
      // something was tried rather than no trace at all.
      const [entry] = await db
        .insert(notification_log)
        .values({
          profile_id: data.profileId,
          target_id: target.id,
          channel: target.channel,
          subject: data.subject ?? null,
          body: data.body,
          status: 'queued',
          metadata: data.metadata ?? null,
        })
        .returning();

      const outcome = await this.deliver(target, data);
      const [settled] = await db
        .update(notification_log)
        .set({
          status: outcome.delivered ? 'sent' : 'failed',
          error: outcome.error ?? null,
          sent_at: outcome.delivered ? new Date() : null,
        })
        .where(eq(notification_log.id, entry.id))
        .returning();

      if (outcome.delivered) deliveredCount++;
      entries.push(settled);
    }

    logger.info(
      `Notified profile ${data.profileId}: ${deliveredCount}/${entries.length} delivered`,
    );
    return {
      profileId: data.profileId,
      delivered: deliveredCount,
      attempted: entries.length,
      entries,
    };
  }

  /**
   * Send one notification on one target's channel.
   *
   * The destination is decrypted here and nowhere else, held only for the length
   * of the send, and never returned or logged.
   */
  private async deliver(
    target: typeof notification_targets.$inferSelect,
    data: {
      subject?: string;
      body: string;
      attachment?: { filename: string; contentType: string; content: string; method?: string };
    },
  ): Promise<{ delivered: boolean; error?: string }> {
    if (target.channel === 'sms') {
      return { delivered: false, error: 'No SMS transport is configured' };
    }

    let destination: string;
    try {
      destination = decrypt(target.destination_encrypted, this.encryptionKey);
    } catch {
      return { delivered: false, error: 'Stored destination could not be decrypted' };
    }

    return this.mailer.send({
      to: destination,
      subject: data.subject ?? 'A message from Longeny',
      text: data.body,
      attachment: data.attachment,
    });
  }

  async getNotifications(authId: string, profileId: string) {
    await this.assertOwnership(authId, profileId);
    const rows = await db
      .select()
      .from(notification_log)
      .where(eq(notification_log.profile_id, profileId))
      .orderBy(desc(notification_log.created_at))
      .limit(50);
    return rows;
  }

  // ── Helpers ──

  private sanitizeProfile(p: typeof profiles.$inferSelect) {
    // Never leak PII: drop the encrypted blobs AND phone_hash. The hash is a
    // keyed digest, not plaintext, but it is still a correlation key — the same
    // number produces the same digest for every account. Expose only presence
    // booleans.
    const { phone_encrypted, date_of_birth_encrypted, phone_hash, ...rest } = p;
    return {
      ...rest,
      has_phone: Boolean(phone_encrypted),
      has_date_of_birth: Boolean(date_of_birth_encrypted),
    };
  }
}
