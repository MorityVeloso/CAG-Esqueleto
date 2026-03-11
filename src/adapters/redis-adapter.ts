/**
 * Adapter — Redis
 *
 * Fast key-value cache for:
 *  - Short-lived dynamic snapshots
 *  - Rate limiting
 *  - Session state
 */

import Redis from 'ioredis';
import type { CAGConfig } from '@core/types.js';

export class RedisAdapter {
  private client: Redis;

  constructor(config: CAGConfig) {
    if (!config.storage.redis) {
      throw new Error('storage.redis configuration is required for RedisAdapter');
    }
    this.client = new Redis(config.storage.redis.url);
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, value);
    } else {
      await this.client.set(key, value);
    }
  }

  async getJSON<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  }

  async setJSON(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
  }

  getClient(): Redis {
    return this.client;
  }
}
