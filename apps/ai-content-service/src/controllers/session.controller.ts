import { AppError } from '@longeny/errors';
import { SessionService } from '../services/session.service.js';

export class SessionController {
  constructor(private readonly sessionSvc: SessionService) {}

  async start({ store }: { store: { userId: string } }) {
    const result = await this.sessionSvc.createSession(store.userId);
    return { success: true, data: result };
  }

  async history({ store }: { store: { userId: string } }) {
    const sessions = await this.sessionSvc.getUserHistory(store.userId);
    return { success: true, data: sessions };
  }

  async getSession({ params }: { params: { id: string } }) {
    const session = await this.sessionSvc.getSession(params.id);
    if (!session) {
      throw new AppError('Session not found', 404, 'NOT_FOUND');
    }
    return { success: true, data: session };
  }
}
