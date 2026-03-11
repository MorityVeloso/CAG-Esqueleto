/**
 * Layer 1 — Knowledge Loader
 *
 * Loads and prepares static knowledge from various StaticSource types.
 * Supports: text, file (.txt, .md, .json), and async function sources.
 * Each source is formatted with category headers and cleaned whitespace.
 */

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { StaticSource } from '@core/types.js';
import { countTokens } from '../../utils/token-counter.js';

export interface LoadedSource {
  source: StaticSource;
  resolvedContent: string;
  formattedContent: string;
  tokenCount: number;
}

export class KnowledgeLoader {
  private sources: Map<string, LoadedSource> = new Map();

  /**
   * Load knowledge from StaticSource definitions.
   * Resolves content, formats it, counts tokens.
   * Sources are sorted by priority (highest first) for stable ordering.
   */
  async load(sources: StaticSource[]): Promise<void> {
    const sorted = [...sources].sort((a, b) => b.priority - a.priority);

    for (const source of sorted) {
      const raw = await this.resolveContent(source);
      if (!raw.trim()) continue;

      const formatted = this.formatForContext(raw, source.category);
      const tokenCount = countTokens(formatted);

      this.sources.set(source.id, {
        source,
        resolvedContent: raw,
        formattedContent: formatted,
        tokenCount,
      });
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
   * Get all loaded sources grouped by category.
   */
  getByCategory(category: string): LoadedSource[] {
    return Array.from(this.sources.values())
      .filter((s) => this.normalizeCategoryGroup(s.source.category) === category);
  }

  /**
   * Get all loaded sources.
   */
  getAll(): LoadedSource[] {
    return Array.from(this.sources.values());
  }

  /**
   * Get unique categories present in loaded sources.
   */
  getCategories(): string[] {
    const cats = new Set<string>();
    for (const { source } of this.sources.values()) {
      cats.add(source.category);
    }
    return Array.from(cats);
  }

  /**
   * Get total token count across all loaded sources.
   */
  estimateTokens(): number {
    let total = 0;
    for (const { tokenCount } of this.sources.values()) {
      total += tokenCount;
    }
    return total;
  }

  getSourceCount(): number {
    return this.sources.size;
  }

  clear(): void {
    this.sources.clear();
  }

  // ─── Content Resolution ──────────────────────────────────────────────────

  private async resolveContent(source: StaticSource): Promise<string> {
    switch (source.type) {
      case 'text':
        return this.loadFromText(source.content ?? '');
      case 'file':
        return this.loadFromFile(source.filePath ?? '');
      case 'function':
        return this.loadFromFunction(source.loadFn);
      default:
        return '';
    }
  }

  /**
   * Load from inline text content.
   */
  private loadFromText(text: string): string {
    return text;
  }

  /**
   * Load from file. Supports .txt, .md, .json.
   * JSON files are formatted as readable key-value pairs.
   */
  private async loadFromFile(filePath: string): Promise<string> {
    if (!filePath) return '';

    try {
      const raw = await readFile(filePath, 'utf-8');
      const ext = extname(filePath).toLowerCase();

      switch (ext) {
        case '.json':
          return this.formatJson(raw);
        case '.txt':
        case '.md':
        default:
          return raw;
      }
    } catch {
      // File not found or unreadable — return empty
      return '';
    }
  }

  /**
   * Load from an async function.
   */
  private async loadFromFunction(fn?: () => Promise<string>): Promise<string> {
    if (!fn) return '';
    return fn();
  }

  // ─── Formatting ──────────────────────────────────────────────────────────

  /**
   * Format content for context with category header and cleaned whitespace.
   */
  formatForContext(content: string, category: string): string {
    const header = `[${category.toUpperCase()}]`;
    const cleaned = this.cleanWhitespace(content);
    return `${header}\n${cleaned}`;
  }

  /**
   * Format JSON into a readable text representation.
   */
  private formatJson(raw: string): string {
    try {
      const parsed: unknown = JSON.parse(raw);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return raw;
    }
  }

  /**
   * Remove excessive whitespace while preserving structure.
   */
  private cleanWhitespace(text: string): string {
    return text
      .replace(/\r\n/g, '\n')           // Normalize line endings
      .replace(/\n{3,}/g, '\n\n')       // Collapse 3+ newlines to 2
      .replace(/[ \t]+$/gm, '')         // Remove trailing spaces
      .trim();
  }

  /**
   * Map source categories to standard group names.
   */
  private normalizeCategoryGroup(category: string): string {
    const cat = category.toLowerCase();

    if (['business_rules', 'rules', 'formulas', 'regulations'].includes(cat)) {
      return 'rules_formulas';
    }
    if (['parameters', 'config', 'settings', 'configuration'].includes(cat)) {
      return 'parameters';
    }
    if (['reference', 'cadastros', 'data', 'reference_data', 'lookup'].includes(cat)) {
      return 'reference_data';
    }
    return 'instructions';
  }
}
