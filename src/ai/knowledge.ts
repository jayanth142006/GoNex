/**
 * CryptoNet knowledge provider.
 *
 * - `full` mode returns the whole knowledge file for every request (most complete,
 *   ~6k tokens per request).
 * - `retrieval` mode splits the file into heading-level sections and returns only the
 *   sections most relevant to the question (BM25 keyword ranking) within a token
 *   budget, plus the document summary. This keeps requests small enough for
 *   low tokens-per-minute LLM quotas.
 */

export interface KnowledgeContext {
  text: string;
  /** Headings of the sections included (for logging). */
  sections: string[];
}

export interface KnowledgeBase {
  contextFor(query: string): KnowledgeContext;
}

export interface Chunk {
  heading: string;
  text: string;
  tokens: string[];
  approxTokens: number;
}

export const approxTokenCount = (text: string): number => Math.ceil(text.length / 4);

export class FullKnowledge implements KnowledgeBase {
  constructor(private readonly text: string) {}
  contextFor(): KnowledgeContext {
    return { text: this.text, sections: ['(full document)'] };
  }
}

/**
 * Splits markdown into chunks at `##` / `###` headings. A `###` chunk's heading is
 * prefixed with its parent `##` heading so it stays meaningful on its own.
 */
export function parseChunks(markdown: string): Chunk[] {
  const chunks: Chunk[] = [];
  let parent = '';
  let heading = '';
  let lines: string[] = [];

  const flush = () => {
    const body = lines.join('\n').trim();
    if (heading && body) {
      const text = `${heading}\n${body}`;
      chunks.push({ heading, text, tokens: tokenize(`${heading} ${heading} ${body}`), approxTokens: approxTokenCount(text) });
    }
    lines = [];
  };

  for (const line of markdown.split('\n')) {
    const h2 = /^##\s+(.+)$/.exec(line);
    const h3 = /^###\s+(.+)$/.exec(line);
    if (h2) {
      flush();
      parent = h2[1]!.trim();
      heading = `## ${parent}`;
    } else if (h3) {
      flush();
      heading = `## ${parent} › ${h3[1]!.trim()}`;
    } else if (!/^#\s/.test(line)) {
      lines.push(line);
    }
  }
  flush();
  return chunks;
}

const STOPWORDS = new Set(
  (
    'a an the and or but if then else of to in on at by for with from into onto about as is are was were be been being ' +
    'do does did done doing have has had having i me my we our you your he she it its they them their this that these those ' +
    'what which who whom whose when where why how can could should would will shall may might must not no yes so than too very ' +
    'just also there here any some all each every both either neither such own same other more most much many few only up down ' +
    'out over under again further once get got please tell explain know want need like mean means hi hello hey thanks thank'
  ).split(' '),
);

/** Lowercases, drops stopwords and applies a light suffix stemmer (expired/expiry → expir, cancelled → cancel). */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (STOPWORDS.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

function stem(word: string): string {
  if (word.length <= 4 || /^\d+$/.test(word)) return word;
  let w = word.replace(/(ing|ed|es|s|ly)$/, '');
  if (w.length > 4) w = w.replace(/[ey]$/, '');
  if (/([^aeiou])\1$/.test(w)) w = w.slice(0, -1);
  return w.length >= 3 ? w : word;
}

export class RetrievalKnowledge implements KnowledgeBase {
  private readonly chunks: Chunk[];
  private readonly core: Chunk[];
  private readonly docFreq = new Map<string, number>();
  private readonly avgLen: number;

  constructor(
    markdown: string,
    private readonly budgetTokens: number,
    /** Headings always included as baseline context. */
    coreHeadings: string[] = ['## Summary'],
  ) {
    const all = parseChunks(markdown);
    this.core = all.filter((c) => coreHeadings.includes(c.heading));
    this.chunks = all.filter((c) => !coreHeadings.includes(c.heading));
    for (const chunk of this.chunks) {
      for (const term of new Set(chunk.tokens)) this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
    }
    this.avgLen = this.chunks.reduce((n, c) => n + c.tokens.length, 0) / Math.max(1, this.chunks.length);
  }

  contextFor(query: string): KnowledgeContext {
    const scored = this.rank(query);
    let used = this.core.reduce((n, c) => n + c.approxTokens, 0);
    const picked = new Set<Chunk>();
    const top = scored[0]?.score ?? 0;
    for (const { chunk, score } of scored) {
      // Ignore weak matches relative to the best one.
      if (score <= 0 || score < top * 0.2) break;
      if (used + chunk.approxTokens > this.budgetTokens) continue;
      picked.add(chunk);
      used += chunk.approxTokens;
    }
    // Keep the original document order so related sections read naturally.
    const selected = [...this.chunks.filter((c) => picked.has(c)), ...this.core];
    return {
      text: selected.map((c) => c.text).join('\n\n'),
      sections: selected.map((c) => c.heading),
    };
  }

  private rank(query: string): { chunk: Chunk; score: number }[] {
    const terms = [...new Set(tokenize(query))];
    const n = this.chunks.length;
    const k1 = 1.2;
    const b = 0.75;
    return this.chunks
      .map((chunk) => {
        let score = 0;
        for (const term of terms) {
          const df = this.docFreq.get(term);
          if (!df) continue;
          let tf = 0;
          for (const t of chunk.tokens) if (t === term) tf++;
          if (!tf) continue;
          const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
          score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * chunk.tokens.length) / this.avgLen)));
        }
        return { chunk, score };
      })
      .sort((a, b2) => b2.score - a.score);
  }
}
