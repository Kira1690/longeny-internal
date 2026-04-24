import type { ChromaHeartbeat, Collection, CollectionInfo } from './types.js';

export class ChromaClient {
  constructor(private readonly baseUrl: string) {}

  private async _fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`ChromaDB ${path} → ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  async heartbeat(): Promise<boolean> {
    try {
      await this._fetch<ChromaHeartbeat>('/api/v1/heartbeat');
      return true;
    } catch {
      return false;
    }
  }

  async listCollections(): Promise<Collection[]> {
    return this._fetch<Collection[]>('/api/v1/collections');
  }

  async getCollection(name: string): Promise<CollectionInfo> {
    const col = await this._fetch<Collection>(`/api/v1/collections/${encodeURIComponent(name)}`);
    const count = await this.collectionCount(name);
    return { ...col, count };
  }

  async collectionCount(name: string): Promise<number> {
    const data = await this._fetch<{ count: number }>(
      `/api/v1/collections/${encodeURIComponent(name)}/count`,
    );
    return data.count;
  }

  async deleteCollection(name: string): Promise<void> {
    await this._fetch<unknown>(`/api/v1/collections/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  }
}
