import { Redis } from 'ioredis';
import type { ChatMessage } from '../llm/types.js';
import type { ConversationStore } from './types.js';

const KEY_PREFIX = 'gonex:conv:';

export function createRedisClient(url: string): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: 2,
    connectTimeout: 5_000,
    // Fail fast instead of queueing commands while Redis is unreachable.
    enableOfflineQueue: false,
  });
}

export class RedisConversationStore implements ConversationStore {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number,
  ) {}

  async get(id: string): Promise<ChatMessage[] | undefined> {
    const raw = await this.redis.get(KEY_PREFIX + id);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ChatMessage[]) : undefined;
  }

  async save(id: string, messages: ChatMessage[]): Promise<void> {
    await this.redis.set(KEY_PREFIX + id, JSON.stringify(messages), 'EX', this.ttlSeconds);
  }

  async close(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
