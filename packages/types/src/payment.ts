import {
  PaymentGateway,
  OrderType,
  OrderStatus,
  PaymentStatus,
  SubscriptionStatus,
  SubscriptionInterval,
  RefundStatus,
  InvoiceStatus,
} from './enums.js';

export interface GatewayCustomer {
  id: string;
  user_id: string;
  payment_gateway: PaymentGateway;
  gateway_customer_id: string;
  default_payment_method_id: string | null;
  email_encrypted: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Order {
  id: string;
  /** Format: ORD-YYYYMMDD-XXXXX */
  order_number: string;
  user_id: string;
  provider_id: string;
  /** Cross-DB reference to booking_db.bookings.id */
  booking_id: string | null;
  order_type: OrderType;
  status: OrderStatus;
  subtotal: number;
  tax: number;
  platform_fee: number;
  platform_fee_percent: number;
  discount: number;
  total: number;
  currency: string;
  payment_gateway: PaymentGateway | null;
  gateway_payment_intent_id: string | null;
  gateway_checkout_session_id: string | null;
  notes: string | null;
  /** JSONB object containing order-specific metadata */
  metadata: Record<string, unknown> | null;
  paid_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface OrderItem {
  id: string;
  order_id: string;
  entity_type: string;
  entity_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  /** JSONB object containing item-specific metadata */
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

export interface Payment {
  id: string;
  order_id: string;
  gateway_payment_id: string | null;
  gateway_charge_id: string | null;
  amount: number;
  currency: string;
  status: PaymentStatus;
  payment_method: string | null;
  card_last_four: string | null;
  card_brand: string | null;
  receipt_url: string | null;
  failure_code: string | null;
  failure_message: string | null;
  paid_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface Subscription {
  id: string;
  user_id: string;
  provider_id: string;
  program_id: string | null;
  gateway_subscription_id: string | null;
  gateway_price_id: string | null;
  plan_name: string;
  amount: number;
  currency: string;
  interval: SubscriptionInterval;
  status: SubscriptionStatus;
  current_period_start: Date | null;
  current_period_end: Date | null;
  trial_end: Date | null;
  cancel_at_period_end: boolean;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Refund {
  id: string;
  order_id: string;
  payment_id: string;
  gateway_refund_id: string | null;
  amount: number;
  reason: string;
  status: RefundStatus;
  requested_by: string;
  approved_by: string | null;
  approved_at: Date | null;
  processed_at: Date | null;
  rejection_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Invoice {
  id: string;
  order_id: string;
  user_id: string;
  /** Format: INV-YYYYMMDD-XXXXX */
  invoice_number: string;
  gateway_invoice_id: string | null;
  amount: number;
  tax: number;
  total: number;
  currency: string;
  status: InvoiceStatus;
  pdf_url: string | null;
  due_date: Date | null;
  paid_at: Date | null;
  sent_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface GatewayWebhookEvent {
  gateway_event_id: string;
  payment_gateway: PaymentGateway;
  event_type: string;
  processed: boolean;
  /** JSONB object containing the raw webhook payload */
  payload: Record<string, unknown>;
  processed_at: Date | null;
  created_at: Date;
}

export interface Payout {
  id: string;
  provider_id: string;
  payment_gateway: PaymentGateway;
  gateway_payout_id: string | null;
  amount: number;
  currency: string;
  status: string;
  /** Period start date for the payout calculation */
  period_start: Date;
  /** Period end date for the payout calculation */
  period_end: Date;
  paid_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
