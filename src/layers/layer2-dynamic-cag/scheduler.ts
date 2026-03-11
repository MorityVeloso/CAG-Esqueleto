/**
 * Layer 2 — Snapshot Scheduler
 *
 * Manages periodic refresh of DynamicCAGLayer snapshots.
 * Uses setInterval for Node.js environments.
 * For serverless (Edge Functions): call runNow() from external cron.
 */

import type { DynamicSnapshot } from './dynamic-snapshot.js';

export class SnapshotScheduler {
  private readonly layer: DynamicSnapshot;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private errorCount = 0;

  constructor(layer: DynamicSnapshot, intervalMinutes: number) {
    this.layer = layer;
    this.intervalMs = intervalMinutes * 60 * 1000;
  }

  /**
   * Start periodic snapshot updates.
   * Replaces any existing schedule.
   */
  start(): void {
    this.stop();
    this.running = true;
    this.errorCount = 0;

    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  /**
   * Stop periodic updates.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
  }

  /**
   * Execute a snapshot refresh immediately.
   * Useful for serverless environments where cron triggers this externally.
   */
  async runNow(): Promise<void> {
    await this.layer.forceRefresh();
    this.errorCount = 0;
  }

  isRunning(): boolean {
    return this.running;
  }

  getErrorCount(): number {
    return this.errorCount;
  }

  private async tick(): Promise<void> {
    try {
      await this.layer.generateSnapshot();
      this.errorCount = 0;
    } catch {
      this.errorCount++;
      // Stop after 3 consecutive failures to avoid hammering
      if (this.errorCount >= 3) {
        this.stop();
      }
    }
  }
}
