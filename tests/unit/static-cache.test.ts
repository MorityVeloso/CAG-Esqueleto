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

  it('should estimate tokens', async () => {
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
});
