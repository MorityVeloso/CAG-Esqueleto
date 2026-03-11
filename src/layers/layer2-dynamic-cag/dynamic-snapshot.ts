/**
 * Layer 2 — Dynamic CAG Snapshots
 *
 * Maintains a compressed "portrait" of dynamic system data
 * (financial position, active operations, pending alerts).
 *
 * Key behaviors:
 *  - snapshotFn (user-provided) fetches raw data
 *  - AdaptiveCompressor compresses it to fit token budget
 *  - Auto-refreshes when stale (TTL expired)
 *  - Falls back to last valid snapshot on failure
 */

import type {
  IDynamicCagLayer,
  ContextBlock,
  CompressedResult,
  DynamicLayerStats,
  CAGConfig,
} from '@core/types.js';
import { AdaptiveCompressor } from './compressor.js';
import { countTokens } from '../../utils/token-counter.js';

export class DynamicSnapshot implements IDynamicCagLayer {
  readonly name = 'dynamic-cag';
  readonly order = 2;

  private readonly config: CAGConfig;
  private readonly compressor: AdaptiveCompressor;
  private readonly snapshotFn?: () => Promise<string>;

  private currentSnapshot: string | null = null;
  private lastResult: CompressedResult | null = null;
  private lastUpdatedAt: Date | null = null;
  private lastError: Error | null = null;

  constructor(config: CAGConfig) {
    this.config = config;
    this.snapshotFn = config.layers.dynamicCAG.snapshotFn;

    this.compressor = new AdaptiveCompressor({
      targetRatio: config.layers.dynamicCAG.compressionRatio,
      maxTokens: config.layers.dynamicCAG.maxTokens,
    });
  }

  async initialize(): Promise<void> {
    // Generate initial snapshot if snapshotFn is configured
    if (this.snapshotFn) {
      try {
        await this.generateSnapshot();
      } catch {
        // Non-fatal — getContext will retry later
      }
    }
  }

  async shutdown(): Promise<void> {
    this.currentSnapshot = null;
    this.lastResult = null;
    this.lastUpdatedAt = null;
  }

  /**
   * Generate a new compressed snapshot by calling snapshotFn.
   * Returns the compressed text.
   */
  async generateSnapshot(): Promise<string> {
    if (!this.snapshotFn) {
      throw new Error('No snapshotFn configured for DynamicCAGLayer');
    }

    const raw = await this.snapshotFn();
    const result = await this.compressor.compress(raw);

    this.currentSnapshot = result.compressed;
    this.lastResult = result;
    this.lastUpdatedAt = new Date();
    this.lastError = null;

    return result.compressed;
  }

  /**
   * Get the current snapshot as a ContextBlock.
   *
   * - If within TTL: returns current snapshot
   * - If stale: auto-refreshes, then returns
   * - If refresh fails: returns last valid snapshot with warning
   */
  async getContext(): Promise<ContextBlock> {
    if (this.isStale() && this.snapshotFn) {
      try {
        await this.generateSnapshot();
      } catch (error) {
        this.lastError = error instanceof Error ? error : new Error(String(error));
        // Fall through to return last valid snapshot
      }
    }

    const content = this.currentSnapshot ?? '';
    const tokens = content ? countTokens(content) : 0;
    const ttlMs = this.config.layers.dynamicCAG.ttl * 1000;

    return {
      id: 'dynamic-snapshot',
      layer: 'dynamic',
      content,
      tokenCount: tokens,
      cachedAt: this.lastUpdatedAt ?? new Date(),
      expiresAt: new Date((this.lastUpdatedAt?.getTime() ?? Date.now()) + ttlMs),
      metadata: {
        compressionRatio: this.lastResult?.compressionRatio ?? 0,
        segmentsKept: this.lastResult?.segmentsKept ?? 0,
        segmentsDropped: this.lastResult?.segmentsDropped ?? 0,
        isStale: this.isStale(),
        lastError: this.lastError?.message ?? null,
      },
    };
  }

  /**
   * Force immediate refresh, regardless of TTL.
   */
  async forceRefresh(): Promise<void> {
    await this.generateSnapshot();
  }

  /**
   * Check if the current snapshot has expired.
   */
  isStale(): boolean {
    if (!this.lastUpdatedAt) return true;

    const ttlMs = this.config.layers.dynamicCAG.ttl * 1000;
    return Date.now() > this.lastUpdatedAt.getTime() + ttlMs;
  }

  /**
   * Get layer statistics.
   */
  getStats(): DynamicLayerStats {
    return {
      hasSnapshot: this.currentSnapshot !== null,
      isStale: this.isStale(),
      originalTokens: this.lastResult?.originalTokens ?? 0,
      compressedTokens: this.lastResult?.compressedTokens ?? 0,
      compressionRatio: this.lastResult?.compressionRatio ?? 0,
      lastUpdatedAt: this.lastUpdatedAt,
      snapshotAge: this.lastUpdatedAt
        ? Date.now() - this.lastUpdatedAt.getTime()
        : null,
    };
  }

  /**
   * Access the compressor for registering abbreviations/rules.
   */
  getCompressor(): AdaptiveCompressor {
    return this.compressor;
  }
}
