/**
 * Layer 2 — Dynamic CAG Snapshots
 *
 * Manages compressed snapshots of frequently-changing data.
 * Unlike static cache (L1), this data has a short TTL and
 * is periodically refreshed.
 *
 * Use case: product prices, inventory, live status, external API data.
 */

import type {
  IDynamicCagLayer,
  DynamicData,
  CompressedSnapshot,
  DataFetcher,
  CAGConfig,
} from '@core/types.js';
import { Compressor } from './compressor.js';
import { Scheduler } from './scheduler.js';

export class DynamicSnapshot implements IDynamicCagLayer {
  readonly name = 'dynamic-cag';
  readonly order = 2;

  private readonly config: CAGConfig;
  private readonly compressor = new Compressor();
  private readonly scheduler = new Scheduler();
  private snapshots: Map<string, CompressedSnapshot> = new Map();

  constructor(config: CAGConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    // Clean expired snapshots on init
    this.cleanExpired();
  }

  async shutdown(): Promise<void> {
    this.scheduler.cancelAll();
    this.snapshots.clear();
  }

  /**
   * Create a compressed snapshot from dynamic data.
   */
  async createSnapshot(data: DynamicData): Promise<CompressedSnapshot> {
    const maxTokens = this.config.layers.dynamicCag.maxCompressedTokens;
    const result = this.compressor.extractive(data.content, maxTokens);

    const ttlMs = this.config.layers.dynamicCag.ttl * 1000;
    const snapshot: CompressedSnapshot = {
      key: data.key,
      original: data.content,
      compressed: result.compressed,
      compressionRatio: result.ratio,
      tokenCount: result.compressedTokens,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + ttlMs),
    };

    this.snapshots.set(data.key, snapshot);
    return snapshot;
  }

  /**
   * Get the latest non-expired snapshot for a key.
   */
  async getLatestSnapshot(key: string): Promise<CompressedSnapshot | null> {
    const snapshot = this.snapshots.get(key);
    if (!snapshot) return null;

    if (new Date() > snapshot.expiresAt) {
      this.snapshots.delete(key);
      return null;
    }

    return snapshot;
  }

  /**
   * Schedule automatic updates for a data source.
   */
  scheduleUpdate(key: string, fetcher: DataFetcher, intervalMs: number): void {
    this.scheduler.schedule(key, fetcher, intervalMs, (k, data) => {
      void this.createSnapshot({ key: k, content: data, source: 'scheduled', fetchedAt: new Date() });
    });
  }

  cancelUpdate(key: string): void {
    this.scheduler.cancel(key);
  }

  private cleanExpired(): void {
    const now = new Date();
    for (const [key, snapshot] of this.snapshots) {
      if (now > snapshot.expiresAt) {
        this.snapshots.delete(key);
      }
    }
  }
}
