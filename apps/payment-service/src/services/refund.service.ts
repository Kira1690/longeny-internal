import { db } from '../db/index.js';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { refunds, payments, orders } from '../db/schema.js';
import { createLogger } from '@longeny/utils';
import { NotFoundError, BadRequestError, ForbiddenError } from '@longeny/errors';
import { createPaymentGateway } from './gateway/factory.js';
import { publishRefundProcessed } from '../events/publishers.js';

const logger = createLogger('payment-service:refund');

export interface RequestRefundInput {
  orderId: string;
  requestedBy: string;
  reason: string;
  amount?: number;
}

export async function requestRefund(input: RequestRefundInput) {
  const { orderId, requestedBy, reason, amount } = input;

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);

  if (!order) {
    throw new NotFoundError('Order', orderId);
  }

  if (order.user_id !== requestedBy) {
    throw new ForbiddenError('You do not have permission to refund this order');
  }

  if (order.status !== 'paid' && order.status !== 'fulfilled') {
    throw new BadRequestError(`Cannot refund order with status: ${order.status}`);
  }

  // Find the successful payment
  const [payment] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.order_id, orderId), eq(payments.status, 'succeeded')))
    .limit(1);

  if (!payment) {
    throw new BadRequestError('No successful payment found for this order');
  }

  const refundAmount = amount || Number(order.total);

  if (refundAmount > Number(order.total)) {
    throw new BadRequestError('Refund amount exceeds order total');
  }

  const [refund] = await db.insert(refunds).values({
    order_id: orderId,
    payment_id: payment.id,
    amount: refundAmount.toString(),
    reason,
    status: 'pending',
    requested_by: requestedBy,
  }).returning();

  logger.info({ refundId: refund.id, orderId, requestedBy }, 'Refund requested');
  return refund;
}

export async function processRefund(refundId: string) {
  const [refund] = await db.select().from(refunds).where(eq(refunds.id, refundId)).limit(1);

  if (!refund) {
    throw new NotFoundError('Refund', refundId);
  }

  if (refund.status !== 'approved') {
    throw new BadRequestError(`Cannot process refund with status: ${refund.status}`);
  }

  const [payment] = await db.select().from(payments).where(eq(payments.id, refund.payment_id)).limit(1);
  const [order] = await db.select().from(orders).where(eq(orders.id, refund.order_id)).limit(1);

  if (!payment?.gateway_payment_id) {
    throw new BadRequestError('No gateway payment found for refund');
  }

  const gateway = (order.payment_gateway as 'stripe' | 'razorpay') || 'stripe';
  const paymentGateway = createPaymentGateway(gateway);

  try {
    await db.update(refunds).set({ status: 'processing', updated_at: new Date() }).where(eq(refunds.id, refundId));

    const { refundId: gatewayRefundId } = await paymentGateway.createRefund(
      payment.gateway_payment_id,
      Number(refund.amount),
    );

    const [updated] = await db.update(refunds).set({
      status: 'completed',
      gateway_refund_id: gatewayRefundId,
      processed_at: new Date(),
      updated_at: new Date(),
    }).where(eq(refunds.id, refundId)).returning();

    // Update order status if fully refunded
    const completedRefunds = await db
      .select()
      .from(refunds)
      .where(and(eq(refunds.order_id, refund.order_id), eq(refunds.status, 'completed')));

    const totalRefunded = completedRefunds.reduce((sum, r) => sum + Number(r.amount), 0);
    if (totalRefunded >= Number(order.total)) {
      await db.update(orders).set({ status: 'refunded', updated_at: new Date() }).where(eq(orders.id, refund.order_id));
    }

    await publishRefundProcessed({
      refundId: refund.id,
      orderId: refund.order_id,
      userId: order.user_id,
      providerId: order.provider_id,
      amount: Number(refund.amount),
      currency: order.currency,
    });

    logger.info({ refundId, gatewayRefundId }, 'Refund processed');
    return updated;
  } catch (error) {
    await db.update(refunds).set({
      status: 'rejected',
      rejection_reason: 'Gateway processing failed',
      updated_at: new Date(),
    }).where(eq(refunds.id, refundId));
    logger.error({ error, refundId }, 'Refund processing failed');
    throw error;
  }
}

export async function listRefunds(
  userId: string,
  filters: { status?: string; page?: number; limit?: number },
) {
  const page = Math.max(1, filters.page || 1);
  const limit = Math.min(100, Math.max(1, filters.limit || 20));
  const offset = (page - 1) * limit;

  // Get order IDs for this user
  const userOrders = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.user_id, userId));

  if (userOrders.length === 0) {
    return {
      refunds: [],
      pagination: { page, limit, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
    };
  }

  const orderIds = userOrders.map((o) => o.id);

  const statusFilter = filters.status
    ? and(inArray(refunds.order_id, orderIds), eq(refunds.status, filters.status as any))
    : inArray(refunds.order_id, orderIds);

  const [refundList, [{ count }]] = await Promise.all([
    db.select().from(refunds).where(statusFilter).limit(limit).offset(offset).orderBy(refunds.created_at),
    db.select({ count: sql<number>`COUNT(*)::int` }).from(refunds).where(statusFilter),
  ]);

  const total = count;
  const totalPages = Math.ceil(total / limit);

  return {
    refunds: refundList,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}

export async function updateRefundStatus(
  refundId: string,
  status: 'approved' | 'rejected',
  approvedBy: string,
  rejectionReason?: string,
) {
  const [refund] = await db.select().from(refunds).where(eq(refunds.id, refundId)).limit(1);

  if (!refund) {
    throw new NotFoundError('Refund', refundId);
  }

  if (refund.status !== 'pending') {
    throw new BadRequestError(`Cannot update refund with status: ${refund.status}`);
  }

  const [updated] = await db.update(refunds).set({
    status,
    approved_by: approvedBy,
    approved_at: status === 'approved' ? new Date() : null,
    rejection_reason: rejectionReason || null,
    updated_at: new Date(),
  }).where(eq(refunds.id, refundId)).returning();

  logger.info({ refundId, status, approvedBy }, 'Refund status updated');
  return updated;
}
