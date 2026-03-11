/**
 * Layer 2 — Dynamic CAG Snapshots
 *
 * Manages compressed snapshots of frequently-changing data.
 * Unlike static cache (L1), this data has a short TTL and
 * is periodically refreshed via snapshotFn.
 */

import type {
  IDynamicCagLayer,
  ContextBlock,
  CompressedSnapshot,
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
    this.cleanExpired();
  }

  async shutdown(): Promise<void> {
    this.scheduler.cancelAll();
    this.snapshots.clear();
  }

  async createSnapshot(content: string, key = 'default'): Promise<ContextBlock> {
    const maxTokens = this.config.layers.dynamicCAG.maxTokens;
    const result = this.compressor.extractive(content, maxTokens);

    const ttlMs = this.config.layers.dynamicCAG.ttl * 1000;
    const snapshot: CompressedSnapshot = {
      key,
      original: content,
      compressed: result.compressed,
      compressionRatio: result.ratio,
      tokenCount: result.compressedTokens,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + ttlMs),
    };

    this.snapshots.set(key, snapshot);

    return {
      id: `dynamic-${key}`,
      layer: 'dynamic',
      content: snapshot.compressed,
      tokenCount: snapshot.tokenCount,
      cachedAt: snapshot.createdAt,
      expiresAt: snapshot.expiresAt,
      metadata: { compressionRatio: snapshot.compressionRatio, key },
    };
  }

  async getLatestSnapshot(key = 'default'): Promise<ContextBlock | null> {
    const snapshot = this.snapshots.get(key);
    if (!snapshot) return null;

    if (new Date() > snapshot.expiresAt) {
      this.snapshots.delete(key);
      return null;
    }

    return {
      id: `dynamic-${key}`,
      layer: 'dynamic',
      content: snapshot.compressed,
      tokenCount: snapshot.tokenCount,
      cachedAt: snapshot.createdAt,
      expiresAt: snapshot.expiresAt,
      metadata: { compressionRatio: snapshot.compressionRatio, key },
    };
  }

  scheduleUpdates(): void {
    const snapshotFn = this.config.layers.dynamicCAG.snapshotFn;
    if (!snapshotFn) return;

    const intervalMs = this.config.layers.dynamicCAG.updateInterval * 60 * 1000;
    this.scheduler.schedule('default', snapshotFn, intervalMs, (_key, data) => {
      void this.createSnapshot(data);
    });
  }

  cancelUpdates(): void {
    this.scheduler.cancelAll();
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
