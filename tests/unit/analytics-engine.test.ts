import { describe, it, expect, beforeEach } from 'vitest';
import { AnalyticsEngine } from '../../src/analytics/analytics-engine.js';
import type { UsageAnalytics } from '../../src/core/types.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function createRecord(overrides: Partial<UsageAnalytics> = {}): UsageAnalytics {
  return {
    queryId: `q-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date(),
    layersUsed: ['static', 'dynamic'],
    cacheHit: false,
    processingTimeMs: 200,
    inputTokens: 1000,
    outputTokens: 500,
    cachedTokens: 0,
    estimatedCostUSD: 0.01,
    ...overrides,
  };
}

/** Create a record at a specific date (YYYY-MM-DD) */
function createRecordAtDate(dateStr: string, overrides: Partial<UsageAnalytics> = {}): UsageAnalytics {
  return createRecord({
    timestamp: new Date(`${dateStr}T12:00:00Z`),
    ...overrides,
  });
}

// ─── AnalyticsEngine ────────────────────────────────────────────────────────

describe('AnalyticsEngine', () => {
  let engine: AnalyticsEngine;

  beforeEach(() => {
    engine = new AnalyticsEngine();
  });

  // ── logQuery ──────────────────────────────────────────────────────────

  it('should log queries and track count', async () => {
    await engine.logQuery(createRecord());
    await engine.logQuery(createRecord());
    expect(engine.count()).toBe(2);
  });

  it('should not mutate the original record', async () => {
    const record = createRecord();
    await engine.logQuery(record);
    record.inputTokens = 99999;

    // Internal copy should be unaffected
    const stats = await engine.getDailyStats(30);
    expect(stats[0]?.totalInputTokens).not.toBe(99999);
  });

  // ── getDailyStats ─────────────────────────────────────────────────────

  it('should aggregate stats by date', async () => {
    const today = new Date().toISOString().slice(0, 10);

    await engine.logQuery(createRecord({ inputTokens: 1000, cachedTokens: 500, cacheHit: true, processingTimeMs: 100, estimatedCostUSD: 0.01 }));
    await engine.logQuery(createRecord({ inputTokens: 2000, cachedTokens: 0, cacheHit: false, processingTimeMs: 300, estimatedCostUSD: 0.02 }));

    const stats = await engine.getDailyStats();
    expect(stats).toHaveLength(1);

    const day = stats[0]!;
    expect(day.date).toBe(today);
    expect(day.totalQueries).toBe(2);
    expect(day.cacheHits).toBe(1);
    expect(day.cacheHitRate).toBeCloseTo(50);
    expect(day.totalInputTokens).toBe(3000);
    expect(day.totalCachedTokens).toBe(500);
    expect(day.avgProcessingMs).toBe(200);
  });

  it('should compute cache efficiency correctly', async () => {
    // 500 cached out of 1500 total (input + cached) = 33.3%
    await engine.logQuery(createRecord({ inputTokens: 1000, cachedTokens: 500 }));

    const stats = await engine.getDailyStats();
    expect(stats[0]!.cacheEfficiencyPct).toBeCloseTo(33.3, 0);
  });

  it('should group multiple days correctly', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);

    await engine.logQuery(createRecordAtDate(today));
    await engine.logQuery(createRecordAtDate(yesterday));
    await engine.logQuery(createRecordAtDate(yesterday));

    const stats = await engine.getDailyStats();
    expect(stats).toHaveLength(2);

    // Sorted DESC by date
    expect(stats[0]!.date).toBe(today);
    expect(stats[0]!.totalQueries).toBe(1);
    expect(stats[1]!.date).toBe(yesterday);
    expect(stats[1]!.totalQueries).toBe(2);
  });

  it('should filter by days lookback', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const oldDate = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10);

    await engine.logQuery(createRecordAtDate(today));
    await engine.logQuery(createRecordAtDate(oldDate));

    const stats = await engine.getDailyStats(30);
    expect(stats).toHaveLength(1);
    expect(stats[0]!.date).toBe(today);
  });

  it('should return empty array when no records', async () => {
    const stats = await engine.getDailyStats();
    expect(stats).toHaveLength(0);
  });

  // ── getSavingsReport ──────────────────────────────────────────────────

  it('should calculate savings correctly with default Sonnet pricing', async () => {
    // 100,000 cached tokens
    // Would have cost: 100,000 * $3.0 / 1M = $0.30
    // Actual cost:     100,000 * $0.3 / 1M = $0.03
    // Saved:           $0.27
    await engine.logQuery(createRecord({ cachedTokens: 100_000 }));

    const report = await engine.getSavingsReport();
    expect(report).toHaveLength(1);
    expect(report[0]!.tokensServedFromCache).toBe(100_000);
    expect(report[0]!.wouldHaveCostUSD).toBeCloseTo(0.3, 2);
    expect(report[0]!.actualCostUSD).toBeCloseTo(0.03, 2);
    expect(report[0]!.savedUSD).toBeCloseTo(0.27, 2);
  });

  it('should respect custom pricing', async () => {
    const customEngine = new AnalyticsEngine({
      inputTokens: 15.0,       // Opus pricing
      cachedInputTokens: 1.5,  // Opus cached
    });

    await customEngine.logQuery(createRecord({ cachedTokens: 1_000_000 }));

    const report = await customEngine.getSavingsReport();
    expect(report[0]!.wouldHaveCostUSD).toBeCloseTo(15.0, 1);
    expect(report[0]!.actualCostUSD).toBeCloseTo(1.5, 1);
    expect(report[0]!.savedUSD).toBeCloseTo(13.5, 1);
  });

  it('should return zero savings when no cached tokens', async () => {
    await engine.logQuery(createRecord({ cachedTokens: 0 }));

    const report = await engine.getSavingsReport();
    expect(report[0]!.savedUSD).toBe(0);
  });

  // ── getLayerPerformance ───────────────────────────────────────────────

  it('should break down performance by layer', async () => {
    await engine.logQuery(createRecord({
      layersUsed: ['static', 'semantic_cache'],
      cacheHit: true,
      processingTimeMs: 100,
    }));
    await engine.logQuery(createRecord({
      layersUsed: ['static', 'dynamic'],
      cacheHit: false,
      processingTimeMs: 300,
    }));

    const perf = await engine.getLayerPerformance();
    expect(perf.length).toBeGreaterThanOrEqual(3);

    const staticLayer = perf.find((p) => p.layer === 'static');
    expect(staticLayer).toBeDefined();
    expect(staticLayer!.totalInvocations).toBe(2);
    expect(staticLayer!.avgLatencyMs).toBe(200); // (100+300)/2

    const cacheLayer = perf.find((p) => p.layer === 'semantic_cache');
    expect(cacheLayer!.totalInvocations).toBe(1);
    expect(cacheLayer!.hitRate).toBe(1); // the one invocation was a cache hit
  });

  it('should return empty array when no records', async () => {
    const perf = await engine.getLayerPerformance();
    expect(perf).toHaveLength(0);
  });

  // ── getCostProjection ─────────────────────────────────────────────────

  it('should project future costs based on trends', async () => {
    const today = new Date().toISOString().slice(0, 10);

    // Simulate 3 queries today, $0.10 total cost, 50,000 cached tokens
    for (let i = 0; i < 3; i++) {
      await engine.logQuery(createRecordAtDate(today, {
        estimatedCostUSD: 0.0333,
        cachedTokens: 16_667,
      }));
    }

    const projection = await engine.getCostProjection(30);

    expect(projection.projectedDays).toBe(30);
    expect(projection.avgQueriesPerDay).toBeCloseTo(3, 0);
    expect(projection.dailyAvgCostUSD).toBeCloseTo(0.1, 1);
    expect(projection.projectedCostUSD).toBeCloseTo(3.0, 0);
    expect(projection.projectedSavingsUSD).toBeGreaterThan(0);
  });

  it('should return zeros when no data', async () => {
    const projection = await engine.getCostProjection(30);

    expect(projection.dailyAvgCostUSD).toBe(0);
    expect(projection.projectedCostUSD).toBe(0);
    expect(projection.projectedSavingsUSD).toBe(0);
    expect(projection.avgQueriesPerDay).toBe(0);
  });

  // ── clear ─────────────────────────────────────────────────────────────

  it('should clear all records', async () => {
    await engine.logQuery(createRecord());
    await engine.logQuery(createRecord());
    engine.clear();
    expect(engine.count()).toBe(0);
  });
});
