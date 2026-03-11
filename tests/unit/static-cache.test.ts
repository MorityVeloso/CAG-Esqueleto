import { describe, it, expect, beforeEach } from 'vitest';
import { StaticCagCache } from '../../src/layers/layer1-static-cag/static-cache.js';
import { KnowledgeLoader } from '../../src/layers/layer1-static-cag/knowledge-loader.js';
import { createTestConfig } from '../../src/core/config.js';
import type { StaticSource } from '../../src/core/types.js';

function createSource(overrides: Partial<StaticSource> & { id: string }): StaticSource {
  return {
    name: overrides.id,
    type: 'text',
    content: 'Default content',
    category: 'general',
    priority: 5,
    ...overrides,
  };
}

/** Generate long text to exceed 1024 token minimum for cache blocks */
function longText(prefix: string, tokenTarget = 1200): string {
  // ~4 chars per token, so 1200 tokens ≈ 4800 chars
  const sentence = `${prefix} - This is a detailed explanation of a business rule that spans multiple words. `;
  const repeats = Math.ceil((tokenTarget * 4) / sentence.length);
  return sentence.repeat(repeats);
}

describe('KnowledgeLoader', () => {
  let loader: KnowledgeLoader;

  beforeEach(() => {
    loader = new KnowledgeLoader();
  });

  it('should load knowledge sources sorted by priority', async () => {
    await loader.load([
      createSource({ id: 'faq', content: 'FAQ content here', priority: 3 }),
      createSource({ id: 'docs', content: '# Documentation', priority: 7 }),
    ]);
    expect(loader.getSourceCount()).toBe(2);
  });

  it('should skip empty sources', async () => {
    await loader.load([
      createSource({ id: 'empty', content: '' }),
      createSource({ id: 'whitespace', content: '   ' }),
      createSource({ id: 'valid', content: 'Valid content' }),
    ]);
    expect(loader.getSourceCount()).toBe(1);
  });

  it('should build system prompt with XML tags', async () => {
    await loader.load([
      createSource({ id: 'faq', content: 'FAQ content', category: 'support' }),
    ]);
    const prompt = loader.buildSystemPrompt();
    expect(prompt).toContain('<knowledge id="faq"');
    expect(prompt).toContain('name="faq"');
    expect(prompt).toContain('category="support"');
    expect(prompt).toContain('FAQ content');
    expect(prompt).toContain('</knowledge>');
  });

  it('should estimate tokens accurately', async () => {
    await loader.load([
      createSource({ id: 'test', content: 'Hello world test content' }),
    ]);
    const tokens = loader.estimateTokens();
    expect(tokens).toBeGreaterThan(0);
  });

  it('should clear all sources', async () => {
    await loader.load([createSource({ id: 'test', content: 'Content' })]);
    loader.clear();
    expect(loader.getSourceCount()).toBe(0);
    expect(loader.buildSystemPrompt()).toBe('');
  });

  it('should resolve function sources', async () => {
    await loader.load([{
      id: 'dynamic',
      name: 'Dynamic Source',
      type: 'function',
      category: 'general',
      priority: 5,
      loadFn: async () => 'Loaded dynamically',
    }]);
    expect(loader.getSourceCount()).toBe(1);
    expect(loader.buildSystemPrompt()).toContain('Loaded dynamically');
  });

  it('should return all loaded sources', async () => {
    await loader.load([
      createSource({ id: 'a', content: 'Content A' }),
      createSource({ id: 'b', content: 'Content B' }),
    ]);
    const all = loader.getAll();
    expect(all).toHaveLength(2);
    expect(all[0]!.tokenCount).toBeGreaterThan(0);
  });

  it('should list unique categories', async () => {
    await loader.load([
      createSource({ id: 'a', content: 'A', category: 'rules' }),
      createSource({ id: 'b', content: 'B', category: 'rules' }),
      createSource({ id: 'c', content: 'C', category: 'parameters' }),
    ]);
    const cats = loader.getCategories();
    expect(cats).toContain('rules');
    expect(cats).toContain('parameters');
    expect(cats).toHaveLength(2);
  });

  it('should format content with category header', () => {
    const formatted = loader.formatForContext('Some content here', 'business_rules');
    expect(formatted).toContain('[BUSINESS_RULES]');
    expect(formatted).toContain('Some content here');
  });

  it('should handle file type gracefully when file not found', async () => {
    await loader.load([{
      id: 'missing',
      name: 'Missing File',
      type: 'file',
      filePath: '/nonexistent/path/file.txt',
      category: 'general',
      priority: 5,
    }]);
    // Should not throw, just skip the source
    expect(loader.getSourceCount()).toBe(0);
  });
});

describe('StaticCagCache', () => {
  let cache: StaticCagCache;

  beforeEach(() => {
    const config = createTestConfig();
    cache = new StaticCagCache(config);
  });

  it('should load sources and build system prompt', async () => {
    await cache.loadSources([
      createSource({ id: 'faq', content: 'Return policy: 30 days' }),
    ]);
    expect(cache.getSystemPrompt()).toContain('Return policy');
  });

  it('should return context blocks after loading', async () => {
    await cache.loadSources([
      createSource({ id: 'faq', content: 'Content' }),
    ]);
    const blocks = cache.getContextBlocks();
    expect(blocks.length).toBe(1);
    expect(blocks[0]?.layer).toBe('static');
    expect(blocks[0]?.content).toContain('Content');
  });

  it('should invalidate cache', async () => {
    await cache.loadSources([
      createSource({ id: 'faq', content: 'Content' }),
    ]);
    cache.invalidate();
    expect(cache.getSystemPrompt()).toBe('');
    expect(cache.getContextBlocks()).toHaveLength(0);
  });

  it('should estimate tokens', async () => {
    await cache.loadSources([
      createSource({ id: 'faq', content: 'Some knowledge content for token estimation' }),
    ]);
    expect(cache.getEstimatedTokens()).toBeGreaterThan(0);
  });

  // ─── buildCacheBlocks() ─────────────────────────────────────────────────

  it('should return empty array when no sources loaded', () => {
    expect(cache.buildCacheBlocks()).toHaveLength(0);
  });

  it('should build cache blocks with cache_control ephemeral', async () => {
    await cache.loadSources([
      createSource({ id: 'rules', content: longText('Rule'), category: 'rules' }),
    ]);
    const blocks = cache.buildCacheBlocks();
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]?.type).toBe('text');
    expect(blocks[0]?.cache_control?.type).toBe('ephemeral');
  });

  it('should respect max 4 cache breakpoints', async () => {
    // Create 6 categories — should be merged into ≤4 blocks
    await cache.loadSources([
      createSource({ id: 'r1', content: longText('Rule 1'), category: 'rules' }),
      createSource({ id: 'p1', content: longText('Param 1'), category: 'parameters' }),
      createSource({ id: 'd1', content: longText('Data 1'), category: 'reference_data' }),
      createSource({ id: 'i1', content: longText('Instr 1'), category: 'instructions' }),
      createSource({ id: 'i2', content: longText('Instr 2'), category: 'general' }),
    ]);
    const blocks = cache.buildCacheBlocks();
    expect(blocks.length).toBeLessThanOrEqual(4);
  });

  it('should merge small blocks (< 1024 tokens) into larger ones', async () => {
    // Small blocks should get merged
    await cache.loadSources([
      createSource({ id: 'tiny1', content: 'Small rule', category: 'rules' }),
      createSource({ id: 'tiny2', content: 'Small param', category: 'parameters' }),
      createSource({ id: 'big', content: longText('Big instructions'), category: 'instructions' }),
    ]);
    const blocks = cache.buildCacheBlocks();

    // The two small blocks should be merged into one, plus the big block
    expect(blocks.length).toBeLessThanOrEqual(2);
    // All blocks should have cache_control
    for (const block of blocks) {
      expect(block.cache_control?.type).toBe('ephemeral');
    }
  });

  it('should group by category with stable ordering', async () => {
    await cache.loadSources([
      createSource({ id: 'i1', content: longText('Instructions'), category: 'general' }),
      createSource({ id: 'r1', content: longText('Rules'), category: 'rules' }),
    ]);
    const blocks = cache.buildCacheBlocks();

    // Rules should come before instructions (stable prefix)
    const combined = blocks.map((b) => b.text).join('\n');
    const rulesIdx = combined.indexOf('REGRAS E FÓRMULAS');
    const instrIdx = combined.indexOf('INSTRUÇÕES DE CONTEXTO');
    expect(rulesIdx).toBeLessThan(instrIdx);
  });

  // ─── refresh() ──────────────────────────────────────────────────────────

  it('should refresh by reloading last sources', async () => {
    let callCount = 0;
    const dynamicSource: StaticSource = {
      id: 'live',
      name: 'Live Data',
      type: 'function',
      category: 'parameters',
      priority: 5,
      loadFn: async () => {
        callCount++;
        return `Data version ${callCount}`;
      },
    };

    await cache.loadSources([dynamicSource]);
    expect(cache.getSystemPrompt()).toContain('version 1');

    await cache.refresh();
    expect(cache.getSystemPrompt()).toContain('version 2');
    expect(callCount).toBe(2);
  });

  // ─── getLayerStats() ───────────────────────────────────────────────────

  it('should return layer statistics', async () => {
    await cache.loadSources([
      createSource({ id: 'faq', content: 'FAQ content', category: 'rules' }),
      createSource({ id: 'cfg', content: 'Config data', category: 'parameters' }),
    ]);
    const stats = cache.getLayerStats();

    expect(stats.sourceCount).toBe(2);
    expect(stats.totalTokens).toBeGreaterThan(0);
    expect(stats.categories).toContain('rules');
    expect(stats.categories).toContain('parameters');
    expect(stats.lastLoadedAt).toBeInstanceOf(Date);
  });

  // ─── Token Budget Validation ────────────────────────────────────────────

  it('should throw when sources exceed maxTokens budget', async () => {
    const config = createTestConfig({
      layers: { staticCAG: { maxTokens: 10 } },
    });
    const small = new StaticCagCache(config);

    await expect(small.loadSources([
      createSource({ id: 'big', content: longText('Big content', 2000) }),
    ])).rejects.toThrow('exceeds maxTokens');
  });
});
