import { BadRequestError } from '@longeny/errors';
import {
  createCheckoutSchema,
  createOrderSchema,
  createPaymentIntentSchema,
  createSetupIntentSchema,
  payOrderSchema,
  requestRefundSchema,
} from '@longeny/validators';
import * as invoiceService from '../services/invoice.service.js';
import * as paymentService from '../services/payment.service.js';
import * as refundService from '../services/refund.service.js';

export async function checkout({ body, store, set }: any) {
  const userId = store.userId as string;
  const parsed = createCheckoutSchema.safeParse(body);

  if (!parsed.success) {
    throw new BadRequestError('Invalid checkout data', 'VALIDATION_ERROR', {
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  const { successUrl, cancelUrl, gateway, ...orderInput } = parsed.data;

  const order = await paymentService.createOrder({ userId, ...orderInput });

  const result = await paymentService.processCheckout(
    order.id,
    userId,
    gateway,
    successUrl,
    cancelUrl,
  );

  set.status = 201;
  return {
    success: true,
    data: {
      orderId: order.id,
      orderNumber: order.order_number,
      ...result,
    },
  };
}

export async function createOrder({ body, store, set }: any) {
  const userId = store.userId as string;
  const parsed = createOrderSchema.safeParse(body);

  if (!parsed.success) {
    throw new BadRequestError('Invalid order data', 'VALIDATION_ERROR', {
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  const order = await paymentService.createOrder({
    userId,
    // The account pays; the profile receives. Scope stays with the account.
    profileId: store.activeProfileId || undefined,
    ...parsed.data,
  });

  set.status = 201;
  return { success: true, data: order };
}

export async function payOrder({ body, store, params }: any) {
  const userId = store.userId as string;
  const orderId = params.id;
  const parsed = payOrderSchema.safeParse(body);

  if (!parsed.success) {
    throw new BadRequestError('Invalid payment data', 'VALIDATION_ERROR', {
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  const result = await paymentService.payOrder(
    orderId,
    userId,
    parsed.data.gateway,
    parsed.data.successUrl,
    parsed.data.cancelUrl,
  );

  return { success: true, data: result };
}

export async function createPaymentIntent({ body, store, set }: any) {
  const userId = store.userId as string;
  const parsed = createPaymentIntentSchema.safeParse(body);

  if (!parsed.success) {
    throw new BadRequestError('Invalid payment intent data', 'VALIDATION_ERROR', {
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  const result = await paymentService.createPaymentIntent(
    userId,
    parsed.data.amount,
    parsed.data.currency,
    parsed.data.gateway,
    parsed.data.metadata,
  );

  set.status = 201;
  return { success: true, data: result };
}

export async function createSetupIntent({ body, store, set }: any) {
  const userId = store.userId as string;
  const parsed = createSetupIntentSchema.safeParse(body ?? {});

  if (!parsed.success) {
    throw new BadRequestError('Invalid setup intent data', 'VALIDATION_ERROR', {
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  const result = await paymentService.createSetupIntent(userId, parsed.data.gateway);

  set.status = 201;
  return { success: true, data: result };
}

export async function approveRefund({ store, params }: any) {
  const userId = store.userId as string;
  const refundId = params.id;

  const refund = await paymentService.approveRefund(refundId, userId);
  return { success: true, data: refund };
}

export async function listOrders({ store, query }: any) {
  const userId = store.userId as string;

  const result = await paymentService.listOrders(userId, {
    status: query.status,
    page: query.page ? Number.parseInt(query.page) : undefined,
    limit: query.limit ? Number.parseInt(query.limit) : undefined,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder as 'asc' | 'desc' | undefined,
  });

  return {
    success: true,
    data: result.orders,
    pagination: result.pagination,
  };
}

export async function getOrderDetail({ store, params }: any) {
  const userId = store.userId as string;
  const orderId = params.id;

  const order = await paymentService.getOrderDetail(orderId, userId);
  return { success: true, data: order };
}

export async function listPaymentMethods({ store }: any) {
  const userId = store.userId as string;
  const methods = await paymentService.listPaymentMethods(userId);

  return {
    success: true,
    data: methods.map((m) => ({
      id: m.id,
      type: m.type,
      card: m.card
        ? {
            brand: m.card.brand,
            last4: m.card.last4,
            expMonth: m.card.exp_month,
            expYear: m.card.exp_year,
          }
        : null,
    })),
  };
}

export async function addPaymentMethod({ store, set }: any) {
  const userId = store.userId as string;
  const result = await paymentService.addPaymentMethod(userId);

  set.status = 201;
  return { success: true, data: result };
}

export async function removePaymentMethod({ store, params }: any) {
  const userId = store.userId as string;
  const paymentMethodId = params.id;

  await paymentService.removePaymentMethod(userId, paymentMethodId);
  return { success: true, data: { message: 'Payment method removed' } };
}

export async function listRefunds({ store, query }: any) {
  const userId = store.userId as string;

  const result = await refundService.listRefunds(userId, {
    status: query.status,
    page: query.page ? Number.parseInt(query.page) : undefined,
    limit: query.limit ? Number.parseInt(query.limit) : undefined,
  });

  return {
    success: true,
    data: result.refunds,
    pagination: result.pagination,
  };
}

export async function requestRefund({ body, store, set }: any) {
  const userId = store.userId as string;
  const parsed = requestRefundSchema.safeParse(body);

  if (!parsed.success) {
    throw new BadRequestError('Invalid refund request', 'VALIDATION_ERROR', {
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  const refund = await refundService.requestRefund({
    orderId: parsed.data.orderId,
    requestedBy: userId,
    reason: parsed.data.reason,
    amount: parsed.data.amount,
  });

  set.status = 201;
  return { success: true, data: refund };
}

export async function listInvoices({ store, query }: any) {
  const userId = store.userId as string;

  const result = await invoiceService.listInvoices(userId, {
    status: query.status,
    page: query.page ? Number.parseInt(query.page) : undefined,
    limit: query.limit ? Number.parseInt(query.limit) : undefined,
  });

  return {
    success: true,
    data: result.invoices,
    pagination: result.pagination,
  };
}

export async function downloadInvoice({ store, params }: any) {
  const userId = store.userId as string;
  const invoiceId = params.id;

  const result = await invoiceService.getInvoiceDownloadUrl(invoiceId, userId);
  return { success: true, data: result };
}
