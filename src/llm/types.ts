export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface CompletionResult {
  text: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

/**
 * Provider-neutral LLM interface. The rest of the app never imports a
 * provider SDK directly, so swapping providers only touches `src/llm/`.
 */
export interface LlmClient {
  complete(input: { system: string; messages: ChatMessage[] }): Promise<CompletionResult>;
}
