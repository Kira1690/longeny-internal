export interface Collection {
  name: string;
  id: string;
  metadata: Record<string, unknown> | null;
}

export interface CollectionInfo extends Collection {
  count: number;
}

export interface ChromaHeartbeat {
  ok: boolean;
  nanosecond_heartbeat?: number;
}
