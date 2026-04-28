import { config } from '../config/index.js';
import { AppError } from '@longeny/errors';

const BASE = config.AI_AGENT_URL;

export interface TimeSlot {
  start: string;
  end: string;
  available: boolean;
}

export interface AvailabilityResult {
  provider_id: string;
  date: string;
  slots: TimeSlot[];
}

export interface BookingResult {
  booking_id: string;
  status: string;
  provider_id: string;
  patient_id: string;
  slot_start: string;
  slot_end: string;
  consultation_mode: string;
  created_at: string;
}

export class SchedulingService {
  async checkAvailability(
    providerId: string,
    date: string,
    mode: string,
  ): Promise<AvailabilityResult> {
    const res = await fetch(`${BASE}/ai/scheduling/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider_id: providerId, date, consultation_mode: mode }),
    });
    if (!res.ok) throw new AppError('Availability check failed', 502, 'AGENT_ERROR');
    return res.json() as Promise<AvailabilityResult>;
  }

  async bookSlot(data: {
    provider_id: string;
    patient_id: string;
    session_id?: string;
    slot_start: string;
    slot_end: string;
    consultation_mode: string;
    reason?: string;
  }): Promise<BookingResult> {
    const res = await fetch(`${BASE}/ai/scheduling/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new AppError('Booking failed', 502, 'AGENT_ERROR');
    return res.json() as Promise<BookingResult>;
  }

  async getBooking(bookingId: string): Promise<BookingResult | null> {
    const res = await fetch(`${BASE}/ai/scheduling/${bookingId}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new AppError('Failed to fetch booking', 502, 'AGENT_ERROR');
    return res.json() as Promise<BookingResult>;
  }
}
