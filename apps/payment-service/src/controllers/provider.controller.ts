import * as paymentService from '../services/payment.service.js';

export async function getProviderEarnings({ store }: any) {
  const userId = store.userId as string;

  // The userId is the provider's user ID; in this context
  // the provider_id on orders matches this user.
  const earnings = await paymentService.getProviderEarnings(userId);

  return {
    success: true,
    data: earnings,
  };
}

export async function getProviderPayouts({ store, query }: any) {
  const userId = store.userId as string;

  const result = await paymentService.getProviderPayouts(userId, {
    page: query.page ? parseInt(query.page) : undefined,
    limit: query.limit ? parseInt(query.limit) : undefined,
  });

  return {
    success: true,
    data: result.payouts,
    pagination: result.pagination,
  };
}
