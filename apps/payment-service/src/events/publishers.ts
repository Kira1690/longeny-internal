import { EventPublisher } from '@longeny/events';
import { EVENT_NAMES } from '@longeny/types';
import { loadConfig, paymentConfigSchema } from '@longeny/config';

const config = loadConfig(paymentConfigSchema);
const redisUrl = config.REDIS_PASSWORD
  ? `redis://:${config.REDIS_PASSWORD}@${config.REDIS_HOST}:${config.REDIS_PORT}`
  : `redis://${config.REDIS_HOST}:${config.REDIS_PORT}`;

const publisher = new EventPublisher(redisUrl, 'payment-service');

export interface PaymentCompletedPayload {
  orderId: string;
  orderNumber: string;
  userId: string;
  providerId: string;
  bookingId: string | null;
  amount: number;
  currency: string;
  gateway: string;
}

export interface PaymentFailedPayload {
  orderId: string;
  orderNumber: string;
  userId: string;
  providerId: string;
  bookingId: string | null;
  amount: number;
  currency: string;
  error: string;
}

export interface RefundProcessedPayload {
  refundId: string;
  orderId: string;
  userId: string;
  providerId: string;
  amount: number;
  currency: string;
}

export interface SubscriptionCreatedPayload {
  subscriptionId: string;
  userId: string;
  providerId: string;
  programId: string | null;
  planName: string;
  amount: number;
  currency: string;
  interval: string;
}

export interface SubscriptionCancelledPayload {
  subscriptionId: string;
  userId: string;
  providerId: string;
  programId: string | null;
  planName: string;
  immediately: boolean;
}

export async function publishPaymentCompleted(payload: PaymentCompletedPayload) {
  await publisher.publish(EVENT_NAMES.PAYMENT_COMPLETED, payload);
}

export async function publishPaymentFailed(payload: PaymentFailedPayload) {
  await publisher.publish(EVENT_NAMES.PAYMENT_FAILED, payload);
}

export async function publishRefundProcessed(payload: RefundProcessedPayload) {
  await publisher.publish(EVENT_NAMES.REFUND_PROCESSED, payload);
}

export async function publishSubscriptionCreated(payload: SubscriptionCreatedPayload) {
  await publisher.publish(EVENT_NAMES.SUBSCRIPTION_CREATED, payload);
}

export async function publishSubscriptionCancelled(payload: SubscriptionCancelledPayload) {
  await publisher.publish(EVENT_NAMES.SUBSCRIPTION_CANCELLED, payload);
}

export async function disconnectPublisher() {
  await publisher.disconnect();
}
