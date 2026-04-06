import { db } from '../db/index.js';
import { eq, sql } from 'drizzle-orm';
import { invoices, orders } from '../db/schema.js';
import { createLogger } from '@longeny/utils';
import { NotFoundError } from '@longeny/errors';

const logger = createLogger('payment-service:invoice');

function generateInvoiceNumber(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `INV-${date}-${random}`;
}

export async function createInvoiceForOrder(orderId: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);

  if (!order) {
    throw new NotFoundError('Order', orderId);
  }

  // Check if invoice already exists
  const [existing] = await db.select().from(invoices).where(eq(invoices.order_id, orderId)).limit(1);
  if (existing) {
    logger.debug({ orderId }, 'Invoice already exists');
    return existing;
  }

  const [invoice] = await db.insert(invoices).values({
    order_id: orderId,
    user_id: order.user_id,
    invoice_number: generateInvoiceNumber(),
    amount: order.subtotal,
    tax: order.tax,
    total: order.total,
    currency: order.currency,
    status: 'draft',
  }).returning();

  logger.info({ invoiceId: invoice.id, orderId }, 'Invoice created');
  return invoice;
}

export async function listInvoices(
  userId: string,
  filters: { status?: string; page?: number; limit?: number },
) {
  const page = Math.max(1, filters.page || 1);
  const limit = Math.min(100, Math.max(1, filters.limit || 20));
  const offset = (page - 1) * limit;

  const { and, eq: eqFn } = await import('drizzle-orm');

  const whereClause = filters.status
    ? and(eqFn(invoices.user_id, userId), eqFn(invoices.status, filters.status as any))
    : eqFn(invoices.user_id, userId);

  const [invoiceList, [{ count }]] = await Promise.all([
    db.select().from(invoices).where(whereClause).limit(limit).offset(offset).orderBy(invoices.created_at),
    db.select({ count: sql<number>`COUNT(*)::int` }).from(invoices).where(whereClause),
  ]);

  const total = count;
  const totalPages = Math.ceil(total / limit);

  return {
    invoices: invoiceList,
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

export async function getInvoiceDownloadUrl(invoiceId: string, userId: string) {
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);

  if (!invoice) {
    throw new NotFoundError('Invoice', invoiceId);
  }

  if (invoice.user_id !== userId) {
    throw new NotFoundError('Invoice', invoiceId);
  }

  if (invoice.pdf_url) {
    return { url: invoice.pdf_url, invoiceNumber: invoice.invoice_number };
  }

  // In a real implementation, generate PDF and upload to S3
  // For now, return a placeholder URL
  const placeholderUrl = `https://invoices.longeny.com/${invoice.invoice_number}.pdf`;

  await db.update(invoices).set({
    pdf_url: placeholderUrl,
    status: 'sent',
    sent_at: new Date(),
    updated_at: new Date(),
  }).where(eq(invoices.id, invoiceId));

  return { url: placeholderUrl, invoiceNumber: invoice.invoice_number };
}

export async function markInvoicePaid(invoiceId: string, paidAt?: Date) {
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);

  if (!invoice) {
    throw new NotFoundError('Invoice', invoiceId);
  }

  const [updated] = await db.update(invoices).set({
    status: 'paid',
    paid_at: paidAt || new Date(),
    updated_at: new Date(),
  }).where(eq(invoices.id, invoiceId)).returning();

  logger.info({ invoiceId }, 'Invoice marked as paid');
  return updated;
}
