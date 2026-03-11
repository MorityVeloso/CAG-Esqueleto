import { describe, it, expect, beforeEach } from 'vitest';
import { StaticCagCache } from '../../src/layers/layer1-static-cag/static-cache.js';
import { KnowledgeLoader } from '../../src/layers/layer1-static-cag/knowledge-loader.js';
import { createTestConfig } from '../../src/core/config.js';

describe('KnowledgeLoader', () => {
  let loader: KnowledgeLoader;

  beforeEach(() => {
    loader = new KnowledgeLoader();
  });

  it('should load knowledge sources', async () => {
    await loader.load([
      { id: 'faq', type: 'text', content: 'FAQ content here' },
      { id: 'docs', type: 'markdown', content: '# Documentation' },
    ]);
    expect(loader.getSourceCount()).toBe(2);
  });

  it('should skip empty sources', async () => {
    await loader.load([
      { id: 'empty', type: 'text', content: '' },
      { id: 'whitespace', type: 'text', content: '   ' },
      { id: 'valid', type: 'text', content: 'Valid content' },
    ]);
    expect(loader.getSourceCount()).toBe(1);
  });

  it('should build system prompt with XML tags', async () => {
    await loader.load([
      { id: 'faq', type: 'text', content: 'FAQ content' },
    ]);
    const prompt = loader.buildSystemPrompt();
    expect(prompt).toContain('<knowledge id="faq"');
    expect(prompt).toContain('FAQ content');
    expect(prompt).toContain('</knowledge>');
  });

  it('should use <data> tag for JSON sources', async () => {
    await loader.load([
      { id: 'config', type: 'json', content: '{"key": "value"}' },
    ]);
    const prompt = loader.buildSystemPrompt();
    expect(prompt).toContain('<data id="config"');
  });

  it('should estimate tokens', async () => {
    await loader.load([
      { id: 'test', type: 'text', content: 'Hello world test content' },
    ]);
    const tokens = loader.estimateTokens();
    expect(tokens).toBeGreaterThan(0);
  });

  it('should clear all sources', async () => {
    await loader.load([{ id: 'test', type: 'text', content: 'Content' }]);
    loader.clear();
    expect(loader.getSourceCount()).toBe(0);
    expect(loader.buildSystemPrompt()).toBe('');
  });
});

describe('StaticCagCache', () => {
  let cache: StaticCagCache;

  beforeEach(() => {
    const config = createTestConfig();
    cache = new StaticCagCache(config);
  });

  it('should load knowledge and build system prompt', async () => {
    await cache.loadKnowledge([
      { id: 'faq', type: 'text', content: 'Return policy: 30 days' },
    ]);
    expect(cache.getSystemPrompt()).toContain('Return policy');
  });

  it('should set cache breakpoints when prompt caching enabled', async () => {
    await cache.loadKnowledge([
      { id: 'faq', type: 'text', content: 'Content' },
    ]);
    const breakpoints = cache.getCacheBreakpoints();
    expect(breakpoints.length).toBe(1);
    expect(breakpoints[0]?.type).toBe('ephemeral');
  });

  it('should invalidate cache', async () => {
    await cache.loadKnowledge([
      { id: 'faq', type: 'text', content: 'Content' },
    ]);
    cache.invalidate();
    expect(cache.getSystemPrompt()).toBe('');
    expect(cache.getCacheBreakpoints()).toHaveLength(0);
  });
});
