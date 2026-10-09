import type { ChatMessage } from '../llm/types.js';
import type { ConversationStore } from './types.js';

interface Entry {
  messages: ChatMessage[];
  expiresAt: number;
}

/**
 * Single-process conversation store with TTL and a hard cap on entries.
 * Map insertion order doubles as LRU order: `save` re-inserts, so the
 * first key is always the least recently written conversation.
 */
export class MemoryConversationStore implements ConversationStore {
  private readonly entries = new Map<string, Entry>();
  private readonly sweepTimer: NodeJS.Timeout;

  constructor(
    private readonly ttlSeconds: number,
    private readonly maxEntries = 10_000,
    private readonly now: () => number = Date.now,
  ) {
    this.sweepTimer = setInterval(() => this.sweep(), 60_000);
    this.sweepTimer.unref();
  }

  async get(id: string): Promise<ChatMessage[] | undefined> {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(id);
      return undefined;
    }
    return entry.messages.map((m) => ({ ...m }));
  }

  async save(id: string, messages: ChatMessage[]): Promise<void> {
    this.entries.delete(id);
    this.entries.set(id, {
      messages: messages.map((m) => ({ ...m })),
      expiresAt: this.now() + this.ttlSeconds * 1000,
    });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  async close(): Promise<void> {
    clearInterval(this.sweepTimer);
    this.entries.clear();
  }

  private sweep(): void {
    const now = this.now();
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(id);
    }
  }
}
