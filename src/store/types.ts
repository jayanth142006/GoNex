import type { ChatMessage } from '../llm/types.js';

export interface ConversationStore {
  /** Returns the stored history, or `undefined` if the conversation is unknown or expired. */
  get(id: string): Promise<ChatMessage[] | undefined>;
  /** Replaces the stored history and refreshes its TTL. */
  save(id: string, messages: ChatMessage[]): Promise<void>;
  close(): Promise<void>;
}
