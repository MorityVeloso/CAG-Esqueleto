/**
 * Layer 2 — Update Scheduler
 *
 * Manages periodic refresh of dynamic data snapshots.
 * Each data source can have its own update interval.
 */

import type { DataFetcher } from '@core/types.js';

interface ScheduledTask {
  key: string;
  fetcher: DataFetcher;
  intervalMs: number;
  timer: ReturnType<typeof setInterval> | null;
  lastRun: Date | null;
  lastResult: string | null;
  errorCount: number;
}

export class Scheduler {
  private tasks: Map<string, ScheduledTask> = new Map();

  /**
   * Schedule a data fetcher to run at a fixed interval.
   * Replaces any existing schedule for the same key.
   */
  schedule(
    key: string,
    fetcher: DataFetcher,
    intervalMs: number,
    onUpdate: (key: string, data: string) => void,
  ): void {
    this.cancel(key);

    const task: ScheduledTask = {
      key,
      fetcher,
      intervalMs,
      timer: null,
      lastRun: null,
      lastResult: null,
      errorCount: 0,
    };

    task.timer = setInterval(async () => {
      try {
        const result = await fetcher();
        task.lastResult = result;
        task.lastRun = new Date();
        task.errorCount = 0;
        onUpdate(key, result);
      } catch {
        task.errorCount++;
        // Back off after repeated failures
        if (task.errorCount >= 3) {
          this.cancel(key);
        }
      }
    }, intervalMs);

    this.tasks.set(key, task);
  }

  cancel(key: string): void {
    const task = this.tasks.get(key);
    if (task?.timer) {
      clearInterval(task.timer);
      task.timer = null;
    }
    this.tasks.delete(key);
  }

  cancelAll(): void {
    for (const key of this.tasks.keys()) {
      this.cancel(key);
    }
  }

  getActiveKeys(): string[] {
    return Array.from(this.tasks.keys());
  }

  getTaskStatus(key: string): { lastRun: Date | null; errorCount: number } | null {
    const task = this.tasks.get(key);
    if (!task) return null;
    return { lastRun: task.lastRun, errorCount: task.errorCount };
  }
}
