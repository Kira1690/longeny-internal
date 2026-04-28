import { AppError } from '@longeny/errors';
import { SchedulingService } from '../services/scheduling.service.js';

export class SchedulingController {
  constructor(private readonly schedulingSvc: SchedulingService) {}

  async checkAvailability({
    body,
  }: {
    body: { provider_id: string; date: string; consultation_mode: string };
  }) {
    const result = await this.schedulingSvc.checkAvailability(
      body.provider_id,
      body.date,
      body.consultation_mode,
    );
    return { success: true, data: result };
  }

  async book({
    body,
    store,
  }: {
    body: {
      provider_id: string;
      slot_start: string;
      slot_end: string;
      consultation_mode: string;
      session_id?: string;
      reason?: string;
    };
    store: { userId: string };
  }) {
    const result = await this.schedulingSvc.bookSlot({
      provider_id: body.provider_id,
      patient_id: store.userId,
      slot_start: body.slot_start,
      slot_end: body.slot_end,
      consultation_mode: body.consultation_mode,
      session_id: body.session_id,
      reason: body.reason,
    });
    return { success: true, data: result };
  }

  async getBooking({ params }: { params: { id: string } }) {
    const booking = await this.schedulingSvc.getBooking(params.id);
    if (!booking) throw new AppError('Booking not found', 404, 'NOT_FOUND');
    return { success: true, data: booking };
  }
}
