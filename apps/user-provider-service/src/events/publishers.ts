import { EventPublisher } from '@longeny/events';
import { EVENT_NAMES } from '@longeny/types';
import { createLogger } from '@longeny/utils';

const logger = createLogger('user-provider-publisher');

/**
 * Event publisher wrapper for user-provider-service.
 * Provides typed publish methods for all domain events.
 */
export function createEventPublishers(publisher: EventPublisher) {
  return {
    // User events
    async userUpdated(authId: string, changes: string[], correlationId?: string) {
      await publisher.publish(EVENT_NAMES.USER_UPDATED, { authId, changes }, correlationId);
      logger.debug({ authId }, 'Published user.updated');
    },

    async userDeactivated(authId: string, userId: string, correlationId?: string) {
      await publisher.publish(EVENT_NAMES.USER_DEACTIVATED, { authId, userId }, correlationId);
      logger.debug({ authId, userId }, 'Published user.deactivated');
    },

    // Provider events
    async providerRegistered(providerId: string, authId: string, businessName: string, correlationId?: string) {
      await publisher.publish(
        EVENT_NAMES.PROVIDER_REGISTERED,
        { providerId, authId, businessName },
        correlationId,
      );
      logger.debug({ providerId }, 'Published provider.registered');
    },

    async providerVerified(providerId: string, correlationId?: string) {
      await publisher.publish(EVENT_NAMES.PROVIDER_VERIFIED, { providerId }, correlationId);
      logger.debug({ providerId }, 'Published provider.verified');
    },

    async providerUpdated(providerId: string, changes: string[], correlationId?: string) {
      await publisher.publish(
        EVENT_NAMES.PROVIDER_UPDATED,
        { providerId, changes },
        correlationId,
      );
      logger.debug({ providerId }, 'Published provider.updated');
    },

    // Program events
    async programCreated(programId: string, providerId: string, title: string, correlationId?: string) {
      await publisher.publish(
        EVENT_NAMES.PROVIDER_PROGRAM_CREATED,
        { programId, providerId, title },
        correlationId,
      );
      logger.debug({ programId, providerId }, 'Published provider.program.created');
    },

    async programUpdated(programId: string, providerId: string, changes: string[], correlationId?: string) {
      await publisher.publish(
        EVENT_NAMES.PROVIDER_PROGRAM_UPDATED,
        { programId, providerId, changes },
        correlationId,
      );
      logger.debug({ programId, providerId }, 'Published provider.program.updated');
    },

    // Product events
    async productCreated(productId: string, providerId: string, title: string, correlationId?: string) {
      await publisher.publish(
        EVENT_NAMES.PROVIDER_PRODUCT_CREATED,
        { productId, providerId, title },
        correlationId,
      );
      logger.debug({ productId, providerId }, 'Published provider.product.created');
    },

    // GDPR events
    async gdprErasureRequested(authId: string, requestId: string, correlationId?: string) {
      await publisher.publish(
        EVENT_NAMES.GDPR_ERASURE_REQUESTED,
        { authId, requestId },
        correlationId,
      );
      logger.debug({ authId, requestId }, 'Published user.gdpr.erasure.requested');
    },

    async gdprExportReady(authId: string, exportId: string, fileUrl: string, correlationId?: string) {
      await publisher.publish(
        EVENT_NAMES.GDPR_EXPORT_READY,
        { authId, exportId, fileUrl },
        correlationId,
      );
      logger.debug({ authId, exportId }, 'Published user.gdpr.export.ready');
    },
  };
}

export type Publishers = ReturnType<typeof createEventPublishers>;
