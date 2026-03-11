/**
 * Layer 1 — Knowledge Loader
 * Loads and prepares static knowledge from various StaticSource types.
 */

import type { StaticSource } from '@core/types.js';

export class KnowledgeLoader {
  private sources: Map<string, { source: StaticSource; resolvedContent: string }> = new Map();

  /**
   * Load knowledge from StaticSource definitions.
   * Resolves content from text, file, or function sources.
   * Sorted by priority (highest first).
   */
  async load(sources: StaticSource[]): Promise<void> {
    const sorted = [...sources].sort((a, b) => b.priority - a.priority);

    for (const source of sorted) {
      const content = await this.resolveContent(source);
      if (!content.trim()) continue;
      this.sources.set(source.id, { source, resolvedContent: content });
    }
  }

  /**
   * Formats all loaded knowledge into a single system prompt block.
   * Uses XML-style tags for clear context boundaries (Claude best practice).
   */
  buildSystemPrompt(): string {
    if (this.sources.size === 0) return '';

    const blocks = Array.from(this.sources.values()).map(({ source, resolvedContent }) => {
      return `<knowledge id="${source.id}" name="${source.name}" category="${source.category}" priority="${source.priority}">\n${resolvedContent}\n</knowledge>`;
    });

    return blocks.join('\n\n');
  }

  /**
   * Get total token estimate for loaded knowledge.
   */
  estimateTokens(): number {
    let totalChars = 0;
    for (const { resolvedContent } of this.sources.values()) {
      totalChars += resolvedContent.length;
    }
    return Math.ceil(totalChars / 3);
  }

  getSourceCount(): number {
    return this.sources.size;
  }

  clear(): void {
    this.sources.clear();
  }

  private async resolveContent(source: StaticSource): Promise<string> {
    switch (source.type) {
      case 'text':
        return source.content ?? '';
      case 'function':
        if (!source.loadFn) return '';
        return source.loadFn();
      case 'file':
        // File loading deferred to fs adapter; use content if provided
        return source.content ?? '';
      default:
        return '';
    }
  }
}
