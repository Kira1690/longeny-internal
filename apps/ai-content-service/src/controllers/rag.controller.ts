import { AppError } from '@longeny/errors';
import { config } from '../config/index.js';

export class RagController {
  async query({ body }: { body: { query: string; collection_name?: string; k?: number } }) {
    const res = await fetch(`${config.AI_AGENT_URL}/ai/rag/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: body.query,
        collection_name: body.collection_name ?? 'knowledge_base',
        k: body.k ?? 5,
      }),
    });

    if (!res.ok) {
      throw new AppError('RAG service unavailable', 502, 'SERVICE_UNAVAILABLE');
    }

    const data = await res.json();
    return { success: true, data };
  }
}
