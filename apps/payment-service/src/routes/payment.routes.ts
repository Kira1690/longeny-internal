import { Elysia } from 'elysia';
import { requireAuth } from '@longeny/middleware';
import * as paymentController from '../controllers/payment.controller.js';

const paymentRoutes = new Elysia({ prefix: '/payments' })
  .use(requireAuth())
  .post('/checkout', paymentController.checkout)
  .post('/orders', paymentController.createOrder)
  .get('/orders', paymentController.listOrders)
  .get('/orders/:id', paymentController.getOrderDetail)
  .post('/orders/:id/pay', paymentController.payOrder)
  .post('/create-intent', paymentController.createPaymentIntent)
  .post('/setup-intent', paymentController.createSetupIntent)
  .get('/methods', paymentController.listPaymentMethods)
  .post('/methods', paymentController.addPaymentMethod)
  .delete('/methods/:id', paymentController.removePaymentMethod)
  .post('/refunds', paymentController.requestRefund)
  .get('/refunds', paymentController.listRefunds)
  .put('/refunds/:id/approve', paymentController.approveRefund)
  .get('/invoices', paymentController.listInvoices)
  .get('/invoices/:id/download', paymentController.downloadInvoice);

export default paymentRoutes;
