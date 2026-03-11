/**
 * Layer 1 — Knowledge Loader
 * Loads and prepares static knowledge from various sources.
 */

import type { KnowledgeSource } from '@core/types.js';

export class KnowledgeLoader {
  private sources: Map<string, KnowledgeSource> = new Map();

  /**
   * Load knowledge from multiple sources.
   * Validates and deduplicates entries.
   */
  async load(sources: KnowledgeSource[]): Promise<void> {
    for (const source of sources) {
      if (!source.content.trim()) {
        continue;
      }
      this.sources.set(source.id, source);
    }
  }

  /**
   * Formats all loaded knowledge into a single system prompt block.
   * Uses XML-style tags for clear context boundaries (Claude best practice).
   */
  buildSystemPrompt(): string {
    if (this.sources.size === 0) return '';

    const blocks = Array.from(this.sources.values()).map((source) => {
      const tag = source.type === 'json' ? 'data' : 'knowledge';
      return `<${tag} id="${source.id}" type="${source.type}">\n${source.content}\n</${tag}>`;
    });

    return blocks.join('\n\n');
  }

  /**
   * Get total token estimate for loaded knowledge.
   * Rough estimate: 1 token ≈ 4 chars for English, 2 chars for other languages.
   */
  estimateTokens(): number {
    let totalChars = 0;
    for (const source of this.sources.values()) {
      totalChars += source.content.length;
    }
    // Conservative estimate (mix of English and other languages)
    return Math.ceil(totalChars / 3);
  }

  getSourceCount(): number {
    return this.sources.size;
  }

  clear(): void {
    this.sources.clear();
  }
}
