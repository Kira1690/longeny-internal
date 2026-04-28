import { NotificationService } from '../services/notification.service.js';

export class NotificationController {
  constructor(private readonly notifySvc: NotificationService) {}

  async getPending({ store }: { store: { userId: string } }) {
    const notifications = await this.notifySvc.getPending(store.userId);
    return { success: true, data: notifications };
  }

  async updateStatus({
    params,
    body,
    store,
  }: {
    params: { id: string };
    body: { status: string };
    store: { userId: string };
  }) {
    await this.notifySvc.updateStatus(store.userId, params.id, body.status);
    return { success: true, data: { updated: true } };
  }
}
