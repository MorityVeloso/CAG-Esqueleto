/**
 * Analytics Engine — In-memory query analytics aggregator
 *
 * Tracks every query's cost, latency, cache performance, and layer usage.
 * Provides daily stats, savings reports, layer performance, and cost projections.
 *
 * For production: query the SQL views (cag_daily_stats, cag_savings_report)
 * instead of this in-memory implementation.
 */

import type {
  UsageAnalytics,
  DailyStats,
  SavingsReport,
  LayerPerformance,
  CostProjection,
  PricingConfig,
} from '@core/types.js';

/** Default Sonnet pricing per 1M tokens */
const DEFAULT_PRICING: PricingConfig = {
  inputTokens: 3.0,
  cachedInputTokens: 0.3,
  outputTokens: 15.0,
};

export class AnalyticsEngine {
  private records: UsageAnalytics[] = [];
  private readonly pricing: PricingConfig;

  constructor(pricing?: Partial<PricingConfig>) {
    this.pricing = { ...DEFAULT_PRICING, ...pricing };
  }

  /**
   * Log a query's analytics data.
   */
  async logQuery(data: UsageAnalytics): Promise<void> {
    this.records.push({ ...data });
  }

  /**
   * Get aggregated daily statistics.
   * Mirrors the cag_daily_stats SQL view.
   *
   * @param days Number of days to look back (default: 30)
   */
  async getDailyStats(days = 30): Promise<DailyStats[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const filtered = this.records.filter((r) => r.timestamp >= cutoff);
    const grouped = this.groupByDate(filtered);

    return Array.from(grouped.entries())
      .map(([date, records]) => {
        const totalQueries = records.length;
        const cacheHits = records.filter((r) => r.cacheHit).length;
        const totalInputTokens = this.sum(records, 'inputTokens');
        const totalOutputTokens = this.sum(records, 'outputTokens');
        const totalCachedTokens = this.sum(records, 'cachedTokens');
        const totalCostUSD = this.sum(records, 'estimatedCostUSD');
        const avgProcessingMs =
          totalQueries > 0 ? this.sum(records, 'processingTimeMs') / totalQueries : 0;

        const totalTokenPool = totalInputTokens + totalCachedTokens;
        const cacheEfficiencyPct =
          totalTokenPool > 0 ? (totalCachedTokens / totalTokenPool) * 100 : 0;

        return {
          date,
          totalQueries,
          cacheHits,
          cacheHitRate: totalQueries > 0 ? (cacheHits / totalQueries) * 100 : 0,
          totalInputTokens,
          totalOutputTokens,
          totalCachedTokens,
          totalCostUSD: Math.round(totalCostUSD * 10000) / 10000,
          avgProcessingMs: Math.round(avgProcessingMs),
          cacheEfficiencyPct: Math.round(cacheEfficiencyPct * 10) / 10,
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  /**
   * Get daily savings report.
   * Compares actual cached cost vs. what full-price input would have cost.
   * Mirrors the cag_savings_report SQL view.
   */
  async getSavingsReport(days = 30): Promise<SavingsReport[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const filtered = this.records.filter((r) => r.timestamp >= cutoff);
    const grouped = this.groupByDate(filtered);

    return Array.from(grouped.entries())
      .map(([date, records]) => {
        const tokensServedFromCache = this.sum(records, 'cachedTokens');
        const wouldHaveCostUSD =
          (tokensServedFromCache * this.pricing.inputTokens) / 1_000_000;
        const actualCostUSD =
          (tokensServedFromCache * this.pricing.cachedInputTokens) / 1_000_000;

        return {
          date,
          tokensServedFromCache,
          wouldHaveCostUSD: Math.round(wouldHaveCostUSD * 10000) / 10000,
          actualCostUSD: Math.round(actualCostUSD * 10000) / 10000,
          savedUSD: Math.round((wouldHaveCostUSD - actualCostUSD) * 10000) / 10000,
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  /**
   * Get per-layer performance breakdown.
   * Computes average latency and hit rate for each layer.
   */
  async getLayerPerformance(): Promise<LayerPerformance[]> {
    // Build a map of layer → { invocations, totalLatency, hits }
    const layerMap = new Map<string, { invocations: number; totalLatency: number; hits: number }>();

    for (const record of this.records) {
      for (const layer of record.layersUsed) {
        const existing = layerMap.get(layer) ?? { invocations: 0, totalLatency: 0, hits: 0 };
        existing.invocations++;
        existing.totalLatency += record.processingTimeMs;
        if (record.cacheHit) existing.hits++;
        layerMap.set(layer, existing);
      }
    }

    return Array.from(layerMap.entries()).map(([layer, data]) => ({
      layer,
      avgLatencyMs: data.invocations > 0 ? Math.round(data.totalLatency / data.invocations) : 0,
      hitRate: data.invocations > 0 ? data.hits / data.invocations : 0,
      totalInvocations: data.invocations,
    }));
  }

  /**
   * Project future costs based on recent usage trends.
   *
   * @param days Number of days to project forward
   */
  async getCostProjection(days: number): Promise<CostProjection> {
    const dailyStats = await this.getDailyStats(30);

    if (dailyStats.length === 0) {
      return {
        dailyAvgCostUSD: 0,
        projectedDays: days,
        projectedCostUSD: 0,
        projectedSavingsUSD: 0,
        avgQueriesPerDay: 0,
      };
    }

    const totalCost = dailyStats.reduce((sum, d) => sum + d.totalCostUSD, 0);
    const totalQueries = dailyStats.reduce((sum, d) => sum + d.totalQueries, 0);
    const totalCachedTokens = dailyStats.reduce((sum, d) => sum + d.totalCachedTokens, 0);
    const numDays = dailyStats.length;

    const dailyAvgCostUSD = totalCost / numDays;
    const avgQueriesPerDay = totalQueries / numDays;
    const dailyAvgCachedTokens = totalCachedTokens / numDays;

    // Savings: difference between full-price and cached-price for cached tokens
    const dailySavings =
      (dailyAvgCachedTokens * (this.pricing.inputTokens - this.pricing.cachedInputTokens)) /
      1_000_000;

    return {
      dailyAvgCostUSD: Math.round(dailyAvgCostUSD * 10000) / 10000,
      projectedDays: days,
      projectedCostUSD: Math.round(dailyAvgCostUSD * days * 10000) / 10000,
      projectedSavingsUSD: Math.round(dailySavings * days * 10000) / 10000,
      avgQueriesPerDay: Math.round(avgQueriesPerDay * 10) / 10,
    };
  }

  /**
   * Get total number of logged records.
   */
  count(): number {
    return this.records.length;
  }

  /**
   * Clear all records.
   */
  clear(): void {
    this.records = [];
  }

  // ─── Private ──────────────────────────────────────────────────────────

  private groupByDate(records: UsageAnalytics[]): Map<string, UsageAnalytics[]> {
    const map = new Map<string, UsageAnalytics[]>();
    for (const record of records) {
      const date = record.timestamp.toISOString().slice(0, 10);
      const existing = map.get(date) ?? [];
      existing.push(record);
      map.set(date, existing);
    }
    return map;
  }

  private sum(records: UsageAnalytics[], field: keyof UsageAnalytics): number {
    return records.reduce((total, r) => total + (r[field] as number), 0);
  }
}
