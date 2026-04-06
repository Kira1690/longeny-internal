import { db } from '../db/index.js';
import { eq, and, inArray, lt, gte } from 'drizzle-orm';
import { orders, order_items, payments, refunds, invoices, gateway_customers, subscriptions } from '../db/schema.js';
import { createLogger } from '@longeny/utils';
import * as stripeService from '../services/stripe.service.js';

const logger = createLogger('payment-service:internal');

/**
 * GET /internal/gdpr/user-data/:userId
 * Return all payment data for a user (DSAR - Data Subject Access Request).
 */
export async function getUserPaymentData({ params }: any) {
  const userId = params.userId;

  const userOrders = await db.select().from(orders).where(eq(orders.user_id, userId)).orderBy(orders.created_at);
  const orderIds = userOrders.map((o) => o.id);

  const [orderItemsList, paymentsList, refundsList, subscriptionList, gatewayCustomerList, invoiceList] =
    await Promise.all([
      orderIds.length ? db.select().from(order_items).where(inArray(order_items.order_id, orderIds)) : [],
      orderIds.length ? db.select().from(payments).where(inArray(payments.order_id, orderIds)) : [],
      orderIds.length ? db.select().from(refunds).where(inArray(refunds.order_id, orderIds)) : [],
      db.select().from(subscriptions).where(eq(subscriptions.user_id, userId)).orderBy(subscriptions.created_at),
      db.select().from(gateway_customers).where(eq(gateway_customers.user_id, userId)),
      db.select().from(invoices).where(eq(invoices.user_id, userId)).orderBy(invoices.created_at),
    ]);

  return {
    success: true,
    data: {
      userId,
      orders: userOrders.map((order) => ({
        id: order.id,
        orderNumber: order.order_number,
        orderType: order.order_type,
        status: order.status,
        subtotal: order.subtotal,
        tax: order.tax,
        total: order.total,
        currency: order.currency,
        createdAt: order.created_at,
        paidAt: order.paid_at,
        items: orderItemsList
          .filter((i) => i.order_id === order.id)
          .map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unit_price,
            totalPrice: item.total_price,
          })),
        payments: paymentsList
          .filter((p) => p.order_id === order.id)
          .map((payment) => ({
            id: payment.id,
            amount: payment.amount,
            currency: payment.currency,
            status: payment.status,
            paymentMethod: payment.payment_method,
            cardLastFour: payment.card_last_four,
            cardBrand: payment.card_brand,
            paidAt: payment.paid_at,
          })),
        refunds: refundsList
          .filter((r) => r.order_id === order.id)
          .map((refund) => ({
            id: refund.id,
            amount: refund.amount,
            reason: refund.reason,
            status: refund.status,
            createdAt: refund.created_at,
            processedAt: refund.processed_at,
          })),
      })),
      subscriptions: subscriptionList.map((sub) => ({
        id: sub.id,
        planName: sub.plan_name,
        amount: sub.amount,
        currency: sub.currency,
        interval: sub.interval,
        status: sub.status,
        currentPeriodStart: sub.current_period_start,
        currentPeriodEnd: sub.current_period_end,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        createdAt: sub.created_at,
      })),
      gatewayCustomers: gatewayCustomerList.map((gc) => ({
        id: gc.id,
        gateway: gc.payment_gateway,
        createdAt: gc.created_at,
      })),
      invoices: invoiceList.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoice_number,
        amount: inv.amount,
        tax: inv.tax,
        total: inv.total,
        currency: inv.currency,
        status: inv.status,
        createdAt: inv.created_at,
        paidAt: inv.paid_at,
      })),
    },
  };
}

/**
 * DELETE /internal/gdpr/user-data/:userId
 * Anonymize orders (7-year retention for legal compliance), delete customer record.
 */
export async function anonymizeUserPaymentData({ params }: any) {
  const userId = params.userId;

  logger.info({ userId }, 'GDPR anonymization request received');

  const sevenYearsAgo = new Date();
  sevenYearsAgo.setFullYear(sevenYearsAgo.getFullYear() - 7);

  // Find orders older than 7 years
  const oldOrders = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.user_id, userId), lt(orders.created_at, sevenYearsAgo)));

  if (oldOrders.length > 0) {
    const oldOrderIds = oldOrders.map((o) => o.id);

    await db.delete(refunds).where(inArray(refunds.order_id, oldOrderIds));
    await db.delete(payments).where(inArray(payments.order_id, oldOrderIds));
    await db.delete(invoices).where(inArray(invoices.order_id, oldOrderIds));
    await db.delete(order_items).where(inArray(order_items.order_id, oldOrderIds));
    await db.delete(orders).where(inArray(orders.id, oldOrderIds));
  }

  // Anonymize recent orders (within 7 years) - remove PII notes/metadata
  await db.update(orders).set({
    notes: null,
    metadata: null,
    updated_at: new Date(),
  }).where(and(eq(orders.user_id, userId), gte(orders.created_at, sevenYearsAgo)));

  // Delete Stripe customers
  const gatewayCustomerList = await db
    .select()
    .from(gateway_customers)
    .where(eq(gateway_customers.user_id, userId));

  for (const gc of gatewayCustomerList) {
    try {
      if (gc.payment_gateway === 'stripe') {
        await stripeService.deleteCustomer(gc.gateway_customer_id);
      }
    } catch (error) {
      logger.error({ error, customerId: gc.gateway_customer_id }, 'Failed to delete gateway customer');
    }
  }

  await db.delete(gateway_customers).where(eq(gateway_customers.user_id, userId));

  // Cancel active subscriptions
  const activeSubscriptions = await db
    .select()
    .from(subscriptions)
    .where(and(
      eq(subscriptions.user_id, userId),
      inArray(subscriptions.status, ['active', 'trialing', 'past_due']),
    ));

  for (const sub of activeSubscriptions) {
    if (sub.gateway_subscription_id) {
      try {
        await stripeService.cancelSubscription(sub.gateway_subscription_id, true);
      } catch (error) {
        logger.error({ error, subscriptionId: sub.id }, 'Failed to cancel gateway subscription');
      }
    }
  }

  await db.update(subscriptions).set({
    status: 'cancelled',
    cancelled_at: new Date(),
    cancellation_reason: 'GDPR data erasure',
    updated_at: new Date(),
  }).where(eq(subscriptions.user_id, userId));

  logger.info({ userId, oldOrdersDeleted: oldOrders.length }, 'GDPR anonymization completed');

  return {
    success: true,
    data: {
      userId,
      message: 'Payment data anonymized. Financial records within 7-year retention period preserved per legal requirements.',
      oldOrdersDeleted: oldOrders.length,
      subscriptionsCancelled: activeSubscriptions.length,
      gatewayCustomersDeleted: gatewayCustomerList.length,
    },
  };
}
