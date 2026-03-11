import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CAGEngine } from '../../src/core/cag-engine.js';
import { createTestConfig } from '../../src/core/config.js';
import { AnthropicAdapter } from '../../src/adapters/anthropic-adapter.js';
import type { CAGEvent, PricingConfig } from '../../src/core/types.js';

// Mock the Anthropic SDK so tests don't make real HTTP requests
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: vi.fn().mockRejectedValue(new Error('Mock: API not available in tests')),
      };
    },
  };
});

describe('CAGEngine', () => {
  let engine: CAGEngine;

  beforeEach(() => {
    const config = createTestConfig({ anthropic: { maxRetries: 0 } });
    engine = new CAGEngine(config);
  });

  afterEach(async () => {
    try { await engine.shutdown(); } catch { /* may not be initialized */ }
  });

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  it('should throw if not initialized', async () => {
    await expect(engine.query('test')).rejects.toThrow('not initialized');
  });

  it('should initialize and shutdown without errors', async () => {
    await engine.initialize();
    await engine.shutdown();
  });

  it('should throw on teach() before initialization', async () => {
    await expect(engine.teach('content', 'category')).rejects.toThrow('not initialized');
  });

  // ─── Query Pipeline ─────────────────────────────────────────────────────

  it('should accept string input and run pipeline until API call', async () => {
    await engine.initialize();
    // Mock adapter → immediate failure, no network wait
    await expect(engine.query('test')).rejects.toThrow();
  });

  it('should accept CAGQuery object as input', async () => {
    await engine.initialize();
    await expect(engine.query({ message: 'test', forceRefresh: true })).rejects.toThrow();
  });

  // ─── Event System ──────────────────────────────────────────────────────

  it('should emit beforeQuery and contextAssembled events', async () => {
    const events: string[] = [];
    engine.on((event) => events.push(event.type));
    await engine.initialize();

    try { await engine.query('test'); } catch { /* expected */ }

    expect(events).toContain('beforeQuery');
    expect(events).toContain('contextAssembled');
  });

  it('should emit events via typed handler', async () => {
    let fired = false;
    engine.on('beforeQuery', () => { fired = true; });
    await engine.initialize();

    try { await engine.query('test'); } catch { /* expected */ }

    expect(fired).toBe(true);
  });

  it('should not break if event handler throws', async () => {
    engine.on(() => { throw new Error('Handler crash'); });
    await engine.initialize();

    // Should not propagate handler error — only the API error
    await expect(engine.query('test')).rejects.toThrow('Mock');
  });

  // ─── teach() ────────────────────────────────────────────────────────────

  it('should teach knowledge and emit event', async () => {
    const events: CAGEvent[] = [];
    engine.on((event) => events.push(event));
    await engine.initialize();

    const entry = await engine.teach('Return policy is 30 days', 'faq', ['returns']);

    expect(entry.id).toBeDefined();
    expect(entry.content).toBe('Return policy is 30 days');
    expect(entry.source).toBe('user_taught');
    expect(entry.tags).toContain('returns');

    const addedEvent = events.find((e) => e.type === 'knowledgeAdded');
    expect(addedEvent).toBeDefined();
  });

  // ─── getStats() ─────────────────────────────────────────────────────────

  it('should return initial stats with zero queries', async () => {
    await engine.initialize();
    const stats = await engine.getStats();

    expect(stats.totalQueries).toBe(0);
    expect(stats.cacheHitRate).toBe(0);
    expect(stats.avgResponseTimeMs).toBe(0);
    expect(stats.tokenUsage.totalCostUSD).toBe(0);
    expect(stats.uptimeMs).toBeGreaterThanOrEqual(0);
  });

  // ─── clearSemanticCache() ───────────────────────────────────────────────

  it('should clear semantic cache without errors', async () => {
    await engine.initialize();
    await engine.clearSemanticCache();

    const stats = await engine.getStats();
    expect(stats.layerStats.semanticCache.totalEntries).toBe(0);
  });

  // ─── refreshDynamicContext() ────────────────────────────────────────────

  it('should warn when no snapshotFn is configured', async () => {
    await engine.initialize();
    // Should not throw — just logs a warning
    await engine.refreshDynamicContext();
  });

  it('should refresh when snapshotFn is provided', async () => {
    const events: CAGEvent[] = [];
    const config = createTestConfig({
      anthropic: { maxRetries: 0 },
      layers: {
        dynamicCAG: {
          snapshotFn: async () => 'Fresh data from source',
        },
      },
    });
    engine = new CAGEngine(config);
    engine.on((event) => events.push(event));
    await engine.initialize();

    await engine.refreshDynamicContext();

    const updated = events.find((e) => e.type === 'snapshotUpdated');
    expect(updated).toBeDefined();
  });
});

describe('AnthropicAdapter.calculateCost', () => {
  const sonnetPricing: PricingConfig = {
    inputTokens: 3.0,
    cachedInputTokens: 0.30,
    outputTokens: 15.0,
  };

  it('should calculate cost with no cached tokens', () => {
    const cost = AnthropicAdapter.calculateCost(1000, 500, 0, sonnetPricing);
    // (1000/1M * $3) + (500/1M * $15) = $0.003 + $0.0075 = $0.0105
    expect(cost).toBeCloseTo(0.0105, 4);
  });

  it('should apply cached discount correctly', () => {
    const cost = AnthropicAdapter.calculateCost(10000, 500, 8000, sonnetPricing);
    // Fresh: (2000/1M * $3) = $0.006
    // Cached: (8000/1M * $0.30) = $0.0024
    // Output: (500/1M * $15) = $0.0075
    // Total: $0.0159
    expect(cost).toBeCloseTo(0.0159, 4);
  });

  it('should return 0 for zero tokens', () => {
    expect(AnthropicAdapter.calculateCost(0, 0, 0, sonnetPricing)).toBe(0);
  });
});
