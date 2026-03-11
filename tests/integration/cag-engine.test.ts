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

// ─── CAGEngine Integration ──────────────────────────────────────────────────

describe('CAGEngine', () => {
  let engine: CAGEngine;

  beforeEach(() => {
    const config = createTestConfig({ anthropic: { maxRetries: 0 } });
    engine = new CAGEngine(config);
  });

  afterEach(async () => {
    try { await engine.shutdown(); } catch { /* may not be initialized */ }
  });

  // ── 1. Initialize with minimal config ─────────────────────────────────

  it('should initialize with minimal config', async () => {
    await engine.initialize();
    const stats = await engine.getStats();

    expect(stats.totalQueries).toBe(0);
    expect(stats.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(stats.layerStats.semanticCache.totalEntries).toBe(0);
  });

  it('should throw if not initialized', async () => {
    await expect(engine.query('test')).rejects.toThrow('not initialized');
  });

  it('should throw on teach() before initialization', async () => {
    await expect(engine.teach('content', 'category')).rejects.toThrow('not initialized');
  });

  // ── 2. Answer query using static context ──────────────────────────────

  it('should assemble static context and attempt API call', async () => {
    const config = createTestConfig({
      anthropic: { maxRetries: 0 },
      layers: {
        staticCAG: {
          sources: [
            {
              id: 'rules',
              name: 'Rules',
              type: 'text',
              content: 'Return policy: 30 days full refund.',
              category: 'rules',
              priority: 10,
            },
          ],
        },
      },
    });
    engine = new CAGEngine(config);
    await engine.initialize();

    const events: CAGEvent[] = [];
    engine.on((event) => events.push(event));

    // Will fail at API call (mocked), but context assembly should succeed
    await expect(engine.query('What is the return policy?')).rejects.toThrow('Mock');

    // Verify context was assembled with static layer
    const assembled = events.find((e) => e.type === 'contextAssembled');
    expect(assembled).toBeDefined();
    if (assembled?.type === 'contextAssembled') {
      expect(assembled.layersUsed).toContain('static');
    }
  });

  // ── 3. Semantic cache for similar queries ─────────────────────────────

  it('should use semantic cache for similar queries', async () => {
    const config = createTestConfig({ anthropic: { maxRetries: 0 } });
    engine = new CAGEngine(config);

    // Set up fake embedding function with deterministic vectors
    engine.setEmbeddingFunction(async (text: string) => {
      if (text.includes('saldo') || text.includes('caixa')) return [1, 0, 0];
      return [0, 1, 0];
    });

    await engine.initialize();

    // Manually store a cached response
    const semanticCache = (engine as unknown as { semanticCache: { store: (q: string, r: string) => Promise<void> } }).semanticCache;
    await semanticCache.store('qual o saldo', 'O saldo é R$ 150.000');

    // Similar query should hit cache
    const response = await engine.query('quanto temos em caixa');

    expect(response.cacheHit).toBe(true);
    expect(response.answer).toBe('O saldo é R$ 150.000');
    expect(response.usage.estimatedCost).toBe(0); // no API call
    expect(response.processingTime.llmCall).toBe(0);
  });

  // ── 4. Compress dynamic context ───────────────────────────────────────

  it('should compress dynamic context', async () => {
    const longSnapshot = Array(50)
      .fill('Current inventory: 1000 tons of soybeans at R$120/ton. ')
      .join('\n');

    const config = createTestConfig({
      anthropic: { maxRetries: 0 },
      layers: {
        dynamicCAG: {
          snapshotFn: async () => longSnapshot,
        },
      },
    });
    engine = new CAGEngine(config);
    await engine.initialize();

    const events: CAGEvent[] = [];
    engine.on((event) => events.push(event));

    try { await engine.query('What is our inventory?'); } catch { /* API mock */ }

    // Dynamic layer should have been used
    const assembled = events.find((e) => e.type === 'contextAssembled');
    expect(assembled).toBeDefined();
    if (assembled?.type === 'contextAssembled') {
      expect(assembled.layersUsed).toContain('dynamic');
      // Compressed content should be shorter than original
      const dynamicBlock = assembled.context.blocks.find((b) => b.layer === 'dynamic');
      expect(dynamicBlock).toBeDefined();
      expect(dynamicBlock!.content.length).toBeLessThan(longSnapshot.length);
    }
  });

  // ── 5. Activate Think Tool for complex queries ────────────────────────

  it('should activate Think Tool for complex queries', async () => {
    const config = createTestConfig({ anthropic: { maxRetries: 0 } });
    engine = new CAGEngine(config);
    await engine.initialize();

    const events: CAGEvent[] = [];
    engine.on((event) => events.push(event));

    // "calcule" matches default trigger patterns
    try { await engine.query('Calcule a margem líquida da operação'); } catch { /* API mock */ }

    const thinkEvent = events.find((e) => e.type === 'thinkingActivated');
    expect(thinkEvent).toBeDefined();
    if (thinkEvent?.type === 'thinkingActivated') {
      expect(thinkEvent.budgetTokens).toBeGreaterThan(0);
    }
  });

  it('should NOT activate Think Tool for simple queries', async () => {
    const config = createTestConfig({ anthropic: { maxRetries: 0 } });
    engine = new CAGEngine(config);
    await engine.initialize();

    const events: CAGEvent[] = [];
    engine.on((event) => events.push(event));

    try { await engine.query('Qual o horário?'); } catch { /* API mock */ }

    const thinkEvent = events.find((e) => e.type === 'thinkingActivated');
    expect(thinkEvent).toBeUndefined();
  });

  // ── 6. Teach and retrieve curated knowledge ───────────────────────────

  it('should teach and retrieve curated knowledge', async () => {
    const config = createTestConfig({ anthropic: { maxRetries: 0 } });
    engine = new CAGEngine(config);
    await engine.initialize();

    // Teach something
    const entry = await engine.teach(
      'Return policy allows 30 day returns for full refund',
      'faq',
      ['returns', 'policy'],
    );

    expect(entry.source).toBe('user_taught');
    expect(entry.priority).toBe(0.7);

    // Query related to the taught knowledge
    const events: CAGEvent[] = [];
    engine.on((event) => events.push(event));

    try { await engine.query('What is the return policy?'); } catch { /* API mock */ }

    // Curated knowledge should appear in assembled context
    const assembled = events.find((e) => e.type === 'contextAssembled');
    expect(assembled).toBeDefined();
    if (assembled?.type === 'contextAssembled') {
      expect(assembled.layersUsed).toContain('curated');
      const curatedBlock = assembled.context.blocks.find((b) => b.layer === 'curated');
      expect(curatedBlock).toBeDefined();
      expect(curatedBlock!.content).toContain('return');
    }
  });

  // ── 7. Decay curated knowledge priorities over time ───────────────────

  it('should decay curated knowledge priorities over time', async () => {
    const config = createTestConfig({ anthropic: { maxRetries: 0 } });
    engine = new CAGEngine(config);
    await engine.initialize();

    const entry = await engine.teach('Decaying knowledge', 'general');
    const originalPriority = entry.priority; // 0.7

    // Access internal ACE engine to trigger decay
    const ace = (engine as unknown as { curatedKnowledge: { decayPriorities: () => Promise<void>; getStore: () => { getById: (id: string) => { priority: number } | null } } }).curatedKnowledge;
    await ace.decayPriorities();

    const updated = ace.getStore().getById(entry.id);
    expect(updated).not.toBeNull();
    expect(updated!.priority).toBeLessThan(originalPriority);
    expect(updated!.priority).toBeCloseTo(0.7 * 0.95);
  });

  // ── 8. Emit events correctly ──────────────────────────────────────────

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

  it('should emit knowledgeAdded event on teach()', async () => {
    const events: CAGEvent[] = [];
    engine.on((event) => events.push(event));
    await engine.initialize();

    await engine.teach('Something new', 'faq', ['test']);

    const addedEvent = events.find((e) => e.type === 'knowledgeAdded');
    expect(addedEvent).toBeDefined();
  });

  // ── 9. Handle layer failures gracefully ───────────────────────────────

  it('should not break if event handler throws', async () => {
    engine.on(() => { throw new Error('Handler crash'); });
    await engine.initialize();

    // Should not propagate handler error — only the API error
    await expect(engine.query('test')).rejects.toThrow('Mock');
  });

  it('should continue when dynamic layer fails', async () => {
    const config = createTestConfig({
      anthropic: { maxRetries: 0 },
      layers: {
        dynamicCAG: {
          snapshotFn: async () => { throw new Error('DB down'); },
        },
      },
    });
    engine = new CAGEngine(config);
    await engine.initialize();

    const events: CAGEvent[] = [];
    engine.on((event) => events.push(event));

    // Should fail at API call, not at dynamic layer
    await expect(engine.query('test')).rejects.toThrow('Mock');

    // DynamicSnapshot.getContext() handles errors internally (graceful degradation),
    // so contextAssembled should still be emitted — dynamic layer just returns empty content
    expect(events.some((e) => e.type === 'contextAssembled')).toBe(true);

    // Dynamic layer should NOT appear in layersUsed (no content returned)
    const assembled = events.find((e) => e.type === 'contextAssembled');
    if (assembled?.type === 'contextAssembled') {
      expect(assembled.layersUsed).not.toContain('dynamic');
    }
  });

  // ── 10. Calculate costs correctly ─────────────────────────────────────

  it('should return initial stats with zero queries', async () => {
    await engine.initialize();
    const stats = await engine.getStats();

    expect(stats.totalQueries).toBe(0);
    expect(stats.cacheHitRate).toBe(0);
    expect(stats.avgResponseTimeMs).toBe(0);
    expect(stats.tokenUsage.totalCostUSD).toBe(0);
  });

  it('should clear semantic cache without errors', async () => {
    await engine.initialize();
    await engine.clearSemanticCache();

    const stats = await engine.getStats();
    expect(stats.layerStats.semanticCache.totalEntries).toBe(0);
  });

  // ── Dynamic refresh ───────────────────────────────────────────────────

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

// ─── Cost Calculation ───────────────────────────────────────────────────────

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

  it('should calculate Opus pricing correctly', () => {
    const opusPricing: PricingConfig = {
      inputTokens: 15.0,
      cachedInputTokens: 1.5,
      outputTokens: 75.0,
    };
    const cost = AnthropicAdapter.calculateCost(100_000, 10_000, 80_000, opusPricing);
    // Fresh: (20000/1M * $15) = $0.30
    // Cached: (80000/1M * $1.50) = $0.12
    // Output: (10000/1M * $75) = $0.75
    // Total: $1.17
    expect(cost).toBeCloseTo(1.17, 2);
  });
});
