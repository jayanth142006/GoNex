import type { Redis } from 'ioredis';
import type { Config } from '../config.js';
import { MemoryConversationStore } from './memory.js';
import { createRedisClient, RedisConversationStore } from './redis.js';
import type { ConversationStore } from './types.js';

export type { ConversationStore } from './types.js';

export function createStore(config: Config): { store: ConversationStore; redis?: Redis } {
  if (config.redisUrl) {
    const redis = createRedisClient(config.redisUrl);
    return { store: new RedisConversationStore(redis, config.conversationTtlSeconds), redis };
  }
  return { store: new MemoryConversationStore(config.conversationTtlSeconds) };
}
