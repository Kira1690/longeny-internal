import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  boolean,
  integer,
  decimal,
  text,
  json,
  timestamp,
} from 'drizzle-orm/pg-core';

// ── Enums ────────────────────────────────────────────────────

export const paymentGatewayEnum = pgEnum('payment_gateway', ['stripe', 'razorpay']);
export const orderTypeEnum = pgEnum('order_type', ['session', 'program', 'product', 'subscription']);
export const orderStatusEnum = pgEnum('order_status', ['pending', 'paid', 'fulfilled', 'cancelled', 'refunded']);
export const entityTypeEnum = pgEnum('entity_type', ['session', 'program', 'product']);
export const paymentStatusEnum = pgEnum('payment_status', ['pending', 'succeeded', 'failed', 'cancelled']);
export const subscriptionIntervalEnum = pgEnum('subscription_interval', ['weekly', 'monthly', 'quarterly', 'yearly']);
export const subscriptionStatusEnum = pgEnum('subscription_status', ['trialing', 'active', 'past_due', 'cancelled', 'paused']);
export const refundStatusEnum = pgEnum('refund_status', ['pending', 'approved', 'processing', 'completed', 'rejected']);
export const invoiceStatusEnum = pgEnum('invoice_status', ['draft', 'sent', 'paid', 'void', 'overdue']);
export const payoutStatusEnum = pgEnum('payout_status', ['pending', 'processing', 'completed', 'failed']);

// ── Tables ───────────────────────────────────────────────────

export const gateway_customers = pgTable('gateway_customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull(),
  payment_gateway: paymentGatewayEnum('payment_gateway').notNull().default('stripe'),
  gateway_customer_id: varchar('gateway_customer_id', { length: 100 }).notNull(),
  default_payment_method_id: varchar('default_payment_method_id', { length: 100 }),
  email_encrypted: text('email_encrypted'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  order_number: varchar('order_number', { length: 20 }).notNull().unique(),
  user_id: uuid('user_id').notNull(),
  provider_id: uuid('provider_id').notNull(),
  booking_id: uuid('booking_id'),
  order_type: orderTypeEnum('order_type').notNull(),
  status: orderStatusEnum('status').notNull().default('pending'),
  subtotal: decimal('subtotal', { precision: 10, scale: 2 }).notNull(),
  tax: decimal('tax', { precision: 10, scale: 2 }).notNull().default('0'),
  platform_fee: decimal('platform_fee', { precision: 10, scale: 2 }).notNull().default('0'),
  platform_fee_percent: decimal('platform_fee_percent', { precision: 4, scale: 2 }).notNull().default('10'),
  discount: decimal('discount', { precision: 10, scale: 2 }).notNull().default('0'),
  total: decimal('total', { precision: 10, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('USD'),
  payment_gateway: paymentGatewayEnum('payment_gateway'),
  gateway_payment_intent_id: varchar('gateway_payment_intent_id', { length: 100 }),
  gateway_checkout_session_id: varchar('gateway_checkout_session_id', { length: 100 }),
  notes: text('notes'),
  metadata: json('metadata'),
  paid_at: timestamp('paid_at', { withTimezone: true }),
  cancelled_at: timestamp('cancelled_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const order_items = pgTable('order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  order_id: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  entity_type: entityTypeEnum('entity_type').notNull(),
  entity_id: uuid('entity_id').notNull(),
  description: varchar('description', { length: 500 }).notNull(),
  quantity: integer('quantity').notNull().default(1),
  unit_price: decimal('unit_price', { precision: 10, scale: 2 }).notNull(),
  total_price: decimal('total_price', { precision: 10, scale: 2 }).notNull(),
  metadata: json('metadata'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  order_id: uuid('order_id').notNull().references(() => orders.id),
  gateway_payment_id: varchar('gateway_payment_id', { length: 100 }).unique(),
  gateway_charge_id: varchar('gateway_charge_id', { length: 100 }),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('USD'),
  status: paymentStatusEnum('status').notNull().default('pending'),
  payment_method: varchar('payment_method', { length: 50 }),
  card_last_four: varchar('card_last_four', { length: 4 }),
  card_brand: varchar('card_brand', { length: 20 }),
  receipt_url: text('receipt_url'),
  failure_code: varchar('failure_code', { length: 50 }),
  failure_message: text('failure_message'),
  paid_at: timestamp('paid_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull(),
  provider_id: uuid('provider_id').notNull(),
  program_id: uuid('program_id'),
  gateway_subscription_id: varchar('gateway_subscription_id', { length: 100 }).unique(),
  gateway_price_id: varchar('gateway_price_id', { length: 100 }),
  plan_name: varchar('plan_name', { length: 200 }).notNull(),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('USD'),
  interval: subscriptionIntervalEnum('interval').notNull().default('monthly'),
  status: subscriptionStatusEnum('status').notNull().default('active'),
  current_period_start: timestamp('current_period_start', { withTimezone: true }),
  current_period_end: timestamp('current_period_end', { withTimezone: true }),
  trial_end: timestamp('trial_end', { withTimezone: true }),
  cancel_at_period_end: boolean('cancel_at_period_end').notNull().default(false),
  cancelled_at: timestamp('cancelled_at', { withTimezone: true }),
  cancellation_reason: text('cancellation_reason'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const refunds = pgTable('refunds', {
  id: uuid('id').primaryKey().defaultRandom(),
  order_id: uuid('order_id').notNull().references(() => orders.id),
  payment_id: uuid('payment_id').notNull().references(() => payments.id),
  gateway_refund_id: varchar('gateway_refund_id', { length: 100 }).unique(),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  reason: text('reason').notNull(),
  status: refundStatusEnum('status').notNull().default('pending'),
  requested_by: uuid('requested_by').notNull(),
  approved_by: uuid('approved_by'),
  approved_at: timestamp('approved_at', { withTimezone: true }),
  processed_at: timestamp('processed_at', { withTimezone: true }),
  rejection_reason: text('rejection_reason'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  order_id: uuid('order_id').notNull().unique().references(() => orders.id),
  user_id: uuid('user_id').notNull(),
  invoice_number: varchar('invoice_number', { length: 30 }).notNull().unique(),
  gateway_invoice_id: varchar('gateway_invoice_id', { length: 100 }),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  tax: decimal('tax', { precision: 10, scale: 2 }).notNull().default('0'),
  total: decimal('total', { precision: 10, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('USD'),
  status: invoiceStatusEnum('status').notNull().default('draft'),
  pdf_url: text('pdf_url'),
  due_date: timestamp('due_date', { withTimezone: false }),
  paid_at: timestamp('paid_at', { withTimezone: true }),
  sent_at: timestamp('sent_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const gateway_webhook_events = pgTable('gateway_webhook_events', {
  gateway_event_id: varchar('gateway_event_id', { length: 255 }).primaryKey(),
  payment_gateway: paymentGatewayEnum('payment_gateway').notNull(),
  event_type: varchar('event_type', { length: 100 }).notNull(),
  processed: boolean('processed').notNull().default(false),
  payload: json('payload').notNull(),
  processed_at: timestamp('processed_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const payouts = pgTable('payouts', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider_id: uuid('provider_id').notNull(),
  gateway: paymentGatewayEnum('gateway').notNull(),
  gateway_payout_id: varchar('gateway_payout_id', { length: 100 }).unique(),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('USD'),
  status: payoutStatusEnum('status').notNull().default('pending'),
  period_start: timestamp('period_start', { withTimezone: true }).notNull(),
  period_end: timestamp('period_end', { withTimezone: true }).notNull(),
  items_count: integer('items_count').notNull().default(0),
  processed_at: timestamp('processed_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const processed_events = pgTable('processed_events', {
  event_id: uuid('event_id').primaryKey(),
  event_type: varchar('event_type', { length: 100 }).notNull(),
  processed_at: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
});
