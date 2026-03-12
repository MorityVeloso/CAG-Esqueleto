import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRedisInstance, MockRedis } = vi.hoisted(() => {
  const mockRedisInstance = {
    get: vi.fn(),
    set: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    exists: vi.fn(),
    quit: vi.fn(),
  };
  return { mockRedisInstance, MockRedis: vi.fn(() => mockRedisInstance) };
});

vi.mock('ioredis', () => ({
  default: MockRedis,
}));

import { RedisAdapter } from '../../src/adapters/redis-adapter.js';
import type { CAGConfig } from '../../src/core/types.js';

function createRedisConfig(overrides?: Partial<CAGConfig['storage']>): CAGConfig {
  return {
    storage: {
      type: 'redis',
      redis: { url: 'redis://localhost:6379' },
      ...overrides,
    },
  } as CAGConfig;
}

describe('RedisAdapter', () => {
  let adapter: RedisAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new RedisAdapter(createRedisConfig());
  });

  // ─── Constructor ─────────────────────────────────────────────────────

  it('should throw if redis config is missing', () => {
    const config = { storage: { type: 'redis' } } as CAGConfig;
    expect(() => new RedisAdapter(config)).toThrow('storage.redis configuration is required');
  });

  it('should create Redis client with provided URL', () => {
    expect(MockRedis).toHaveBeenCalledWith('redis://localhost:6379');
  });

  // ─── get / set ───────────────────────────────────────────────────────

  it('should get a value by key', async () => {
    mockRedisInstance.get.mockResolvedValue('cached-value');
    const result = await adapter.get('test-key');
    expect(result).toBe('cached-value');
    expect(mockRedisInstance.get).toHaveBeenCalledWith('test-key');
  });

  it('should return null for missing key', async () => {
    mockRedisInstance.get.mockResolvedValue(null);
    const result = await adapter.get('missing');
    expect(result).toBeNull();
  });

  it('should set a value without TTL', async () => {
    mockRedisInstance.set.mockResolvedValue('OK');
    await adapter.set('key', 'value');
    expect(mockRedisInstance.set).toHaveBeenCalledWith('key', 'value');
    expect(mockRedisInstance.setex).not.toHaveBeenCalled();
  });

  it('should set a value with TTL using setex', async () => {
    mockRedisInstance.setex.mockResolvedValue('OK');
    await adapter.set('key', 'value', 300);
    expect(mockRedisInstance.setex).toHaveBeenCalledWith('key', 300, 'value');
    expect(mockRedisInstance.set).not.toHaveBeenCalled();
  });

  // ─── getJSON / setJSON ───────────────────────────────────────────────

  it('should parse JSON from stored string', async () => {
    const data = { name: 'test', count: 42 };
    mockRedisInstance.get.mockResolvedValue(JSON.stringify(data));
    const result = await adapter.getJSON<typeof data>('json-key');
    expect(result).toEqual(data);
  });

  it('should return null when JSON key is missing', async () => {
    mockRedisInstance.get.mockResolvedValue(null);
    const result = await adapter.getJSON('missing');
    expect(result).toBeNull();
  });

  it('should serialize object to JSON when setting', async () => {
    mockRedisInstance.set.mockResolvedValue('OK');
    await adapter.setJSON('key', { a: 1 });
    expect(mockRedisInstance.set).toHaveBeenCalledWith('key', '{"a":1}');
  });

  it('should setJSON with TTL', async () => {
    mockRedisInstance.setex.mockResolvedValue('OK');
    await adapter.setJSON('key', { a: 1 }, 60);
    expect(mockRedisInstance.setex).toHaveBeenCalledWith('key', 60, '{"a":1}');
  });

  // ─── delete / exists ─────────────────────────────────────────────────

  it('should delete a key', async () => {
    mockRedisInstance.del.mockResolvedValue(1);
    await adapter.delete('key');
    expect(mockRedisInstance.del).toHaveBeenCalledWith('key');
  });

  it('should return true when key exists', async () => {
    mockRedisInstance.exists.mockResolvedValue(1);
    const result = await adapter.exists('key');
    expect(result).toBe(true);
  });

  it('should return false when key does not exist', async () => {
    mockRedisInstance.exists.mockResolvedValue(0);
    const result = await adapter.exists('missing');
    expect(result).toBe(false);
  });

  // ─── disconnect / getClient ──────────────────────────────────────────

  it('should call quit on disconnect', async () => {
    mockRedisInstance.quit.mockResolvedValue('OK');
    await adapter.disconnect();
    expect(mockRedisInstance.quit).toHaveBeenCalled();
  });

  it('should expose the underlying Redis client', () => {
    const client = adapter.getClient();
    expect(client).toBe(mockRedisInstance);
  });
});
