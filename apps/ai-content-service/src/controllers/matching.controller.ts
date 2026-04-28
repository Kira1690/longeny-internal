import { AppError } from '@longeny/errors';
import { MatchingService } from '../services/matching.service.js';

export class MatchingController {
  constructor(private readonly matchingSvc: MatchingService) {}

  async match({
    body,
    store,
  }: {
    body: { session_id: string };
    store: { userId: string };
  }) {
    const result = await this.matchingSvc.match(body.session_id, store.userId);
    return { success: true, data: result };
  }

  async getResult({ params }: { params: { matchId: string } }) {
    const result = await this.matchingSvc.getMatchResult(params.matchId);
    if (!result) throw new AppError('Match result not found', 404, 'NOT_FOUND');
    return { success: true, data: result };
  }
}
