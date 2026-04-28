import { config } from '../config/index.js';
import { AppError } from '@longeny/errors';

const BASE = config.AI_AGENT_URL;

export interface ProviderProfileInput {
  specialties: string[];
  conditions_treated?: string[];
  consultation_modes: string[];
  languages?: string[];
  city?: string;
  hourly_rate_inr?: number;
  years_experience?: number;
  availability_rules?: Record<string, unknown>;
  bio?: string;
}

export interface ProviderProfile extends ProviderProfileInput {
  provider_id: string;
  rating: number;
  total_consultations: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export class ProviderProfileService {
  async upsert(providerId: string, data: ProviderProfileInput): Promise<ProviderProfile> {
    const res = await fetch(`${BASE}/ai/provider/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider_id: providerId, ...data }),
    });
    if (!res.ok) throw new AppError('Failed to upsert profile', 502, 'AGENT_ERROR');
    return res.json() as Promise<ProviderProfile>;
  }

  async get(providerId: string): Promise<ProviderProfile | null> {
    const res = await fetch(`${BASE}/ai/provider/profile/${providerId}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new AppError('Failed to fetch profile', 502, 'AGENT_ERROR');
    return res.json() as Promise<ProviderProfile>;
  }

  async list(filters?: { specialty?: string; city?: string; mode?: string }): Promise<ProviderProfile[]> {
    const params = new URLSearchParams();
    if (filters?.specialty) params.set('specialty', filters.specialty);
    if (filters?.city) params.set('city', filters.city);
    if (filters?.mode) params.set('mode', filters.mode);
    const qs = params.toString();
    const res = await fetch(`${BASE}/ai/provider/profiles${qs ? `?${qs}` : ''}`);
    if (!res.ok) throw new AppError('Failed to list profiles', 502, 'AGENT_ERROR');
    return res.json() as Promise<ProviderProfile[]>;
  }

  async deactivate(providerId: string): Promise<void> {
    const res = await fetch(`${BASE}/ai/provider/profile/${providerId}/deactivate`, {
      method: 'PUT',
    });
    if (!res.ok) throw new AppError('Failed to deactivate profile', 502, 'AGENT_ERROR');
  }
}
