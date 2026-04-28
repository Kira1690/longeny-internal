import { config } from '../config/index.js';
import { AppError } from '@longeny/errors';

const BASE = config.AI_AGENT_URL;

export interface ProviderNotification {
  notification_id: string;
  provider_id: string;
  patient_summary: string;
  specialties_needed: string[];
  urgency_level: string;
  consultation_mode: string;
  match_score: number;
  created_at: string;
  status: string;
}

export class NotificationService {
  async createNotification(
    providerId: string,
    sessionId: string,
    matchScore: number,
  ): Promise<ProviderNotification> {
    const res = await fetch(`${BASE}/ai/notifications/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider_id: providerId,
        session_id: sessionId,
        match_score: matchScore,
      }),
    });
    if (!res.ok) throw new AppError('Failed to create notification', 502, 'AGENT_ERROR');
    return res.json() as Promise<ProviderNotification>;
  }

  async getPending(providerId: string): Promise<ProviderNotification[]> {
    const res = await fetch(`${BASE}/ai/notifications/provider/${providerId}`);
    if (!res.ok) throw new AppError('Failed to fetch notifications', 502, 'AGENT_ERROR');
    return res.json() as Promise<ProviderNotification[]>;
  }

  async updateStatus(
    providerId: string,
    notificationId: string,
    status: string,
  ): Promise<void> {
    const res = await fetch(
      `${BASE}/ai/notifications/${providerId}/${notificationId}/status`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      },
    );
    if (!res.ok) throw new AppError('Failed to update notification', 502, 'AGENT_ERROR');
  }
}
