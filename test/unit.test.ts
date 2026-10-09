import { describe, expect, it } from 'vitest';
import { trimHistory } from '../src/ai/chatService.js';
import { parseChunks, RetrievalKnowledge, tokenize } from '../src/ai/knowledge.js';
import { buildSystemPrompt, loadKnowledge } from '../src/ai/prompt.js';
import { loadConfig } from '../src/config.js';
import { MemoryConversationStore } from '../src/store/memory.js';

describe('config', () => {
  it('requires LLM_API_KEY outside tests', () => {
    expect(() => loadConfig({ NODE_ENV: 'development' })).toThrow(/LLM_API_KEY/);
  });

  it('requires ALLOWED_ORIGINS in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', LLM_API_KEY: 'k' })).toThrow(/ALLOWED_ORIGINS/);
  });

  it('never echoes secret values in config errors', () => {
    try {
      loadConfig({ NODE_ENV: 'production', LLM_API_KEY: 'gsk_supersecret', LLM_TEMPERATURE: 'abc' });
    } catch (err) {
      expect(String(err)).not.toContain('gsk_supersecret');
      return;
    }
    throw new Error('expected loadConfig to throw');
  });

  it('parses origins and trust proxy settings', () => {
    const cfg = loadConfig({
      NODE_ENV: 'production',
      LLM_API_KEY: 'k',
      ALLOWED_ORIGINS: 'https://a.example/, https://b.example',
      TRUST_PROXY: '2',
    });
    expect(cfg.allowedOrigins).toEqual(['https://a.example', 'https://b.example']);
    expect(cfg.trustProxy).toBe(2);
    expect(cfg.llm.model).toBe('openai/gpt-oss-120b');
    expect(cfg.llm.reasoningEffort).toBe('low');
  });
});

describe('trimHistory', () => {
  it('keeps the latest messages and starts on a user turn', () => {
    const msgs = [
      { role: 'user', content: '1' },
      { role: 'assistant', content: '2' },
      { role: 'user', content: '3' },
      { role: 'assistant', content: '4' },
    ] as const;
    expect(trimHistory([...msgs], 3).map((m) => m.content)).toEqual(['3', '4']);
    expect(trimHistory([...msgs], 0)).toEqual([]);
  });
});

describe('MemoryConversationStore', () => {
  it('expires entries after the TTL and evicts the oldest past the cap', async () => {
    let now = 0;
    const store = new MemoryConversationStore(60, 2, () => now);
    await store.save('a', [{ role: 'user', content: 'x' }]);
    await store.save('b', [{ role: 'user', content: 'y' }]);
    await store.save('c', [{ role: 'user', content: 'z' }]);
    expect(await store.get('a')).toBeUndefined();
    expect(await store.get('b')).toHaveLength(1);
    now = 61_000;
    expect(await store.get('b')).toBeUndefined();
    await store.close();
  });
});

describe('system prompt', () => {
  it('embeds the CryptoNet knowledge and the safety rules', () => {
    const prompt = buildSystemPrompt(loadKnowledge());
    expect(prompt).toContain('CryptoNet is a payment bridge between Indian UPI payments');
    expect(prompt).toMatch(/seed phrases/);
    expect(prompt).toMatch(/don't have enough information/);
    expect(prompt).toMatch(/Never invent transaction hashes/);
  });
});

describe('RetrievalKnowledge', () => {
  const kb = new RetrievalKnowledge(loadKnowledge(), 1600);

  it.each([
    ['What does COMMITTED mean?', '› COMMITTED'],
    ['how much is the platform fee?', '## 9. Fees'],
    ['is my UPI payment verified by a bank?', '## 13. Limitations'],
    ['what networks are supported?', '› Wrong network'],
    ['What happens when a request expires?', '› EXPIRED'],
  ])('retrieves the right section for %j', (query, heading) => {
    const ctx = kb.contextFor(query);
    expect(ctx.sections.some((s) => s.includes(heading))).toBe(true);
    expect(ctx.text.length / 4).toBeLessThanOrEqual(1600);
  });

  it('always includes the summary, and only the summary for off-topic questions', () => {
    expect(kb.contextFor('write me a poem about cats').sections).toEqual(['## Summary']);
  });

  it('parses headed chunks and stems related words', () => {
    const chunks = parseChunks('# T\n## A\nintro\n### B\nbody');
    expect(chunks.map((c) => c.heading)).toEqual(['## A', '## A › B']);
    expect(tokenize('expired expiry')).toEqual(tokenize('expire expires'));
    expect(tokenize('cancelled')).toEqual(tokenize('cancel'));
  });
});
