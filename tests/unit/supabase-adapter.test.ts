import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFrom, mockRpc, mockSupabaseClient, mockCreateClient } = vi.hoisted(() => {
  const mockFrom = vi.fn();
  const mockRpc = vi.fn();
  const mockSupabaseClient = { from: mockFrom, rpc: mockRpc };
  return {
    mockFrom,
    mockRpc,
    mockSupabaseClient,
    mockCreateClient: vi.fn(() => mockSupabaseClient),
  };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: mockCreateClient,
}));

import { SupabaseAdapter } from '../../src/adapters/supabase-adapter.js';
import type { CAGConfig, SemanticCacheEntry, CuratedKnowledgeEntry, CompressedSnapshot } from '../../src/core/types.js';

function createSupabaseConfig(): CAGConfig {
  return {
    storage: {
      type: 'supabase',
      supabase: { url: 'https://test.supabase.co', serviceKey: 'test-service-key' },
    },
  } as CAGConfig;
}

function mockChain(result: { data?: unknown; error?: unknown }) {
  return {
    upsert: vi.fn().mockResolvedValue(result),
    insert: vi.fn().mockResolvedValue(result),
    select: vi.fn().mockReturnValue({
      order: vi.fn().mockResolvedValue(result),
    }),
  };
}

const NOW = new Date('2026-01-01T00:00:00Z');
const LATER = new Date('2026-01-02T00:00:00Z');

function createCacheEntry(overrides?: Partial<SemanticCacheEntry>): SemanticCacheEntry {
  return {
    id: 'entry-1',
    queryEmbedding: [0.1, 0.2, 0.3],
    queryText: 'test query',
    responseText: 'test response',
    hitCount: 0,
    createdAt: NOW,
    expiresAt: LATER,
    metadata: {},
    ...overrides,
  };
}

function createKnowledgeEntry(overrides?: Partial<CuratedKnowledgeEntry>): CuratedKnowledgeEntry {
  return {
    id: 'k-1',
    content: 'Knowledge content',
    source: 'user_taught',
    category: 'general',
    priority: 0.7,
    usageCount: 0,
    lastUsedAt: NOW,
    createdAt: NOW,
    tags: ['test'],
    ...overrides,
  };
}

function createSnapshot(overrides?: Partial<CompressedSnapshot>): CompressedSnapshot {
  return {
    key: 'snapshot-1',
    original: 'Original long text',
    compressed: 'Compressed text',
    compressionRatio: 0.45,
    tokenCount: 100,
    createdAt: NOW,
    expiresAt: LATER,
    ...overrides,
  };
}

describe('SupabaseAdapter', () => {
  let adapter: SupabaseAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new SupabaseAdapter(createSupabaseConfig());
  });

  // ─── Constructor ─────────────────────────────────────────────────────

  it('should throw if supabase config is missing', () => {
    const config = { storage: { type: 'supabase' } } as CAGConfig;
    expect(() => new SupabaseAdapter(config)).toThrow('storage.supabase configuration is required');
  });

  it('should create client with provided credentials', () => {
    expect(mockCreateClient).toHaveBeenCalledWith('https://test.supabase.co', 'test-service-key');
  });

  // ─── Semantic Cache ──────────────────────────────────────────────────

  it('should save a cache entry via upsert', async () => {
    const chain = mockChain({ error: null });
    mockFrom.mockReturnValue(chain);

    const entry = createCacheEntry();
    await adapter.saveCacheEntry(entry);

    expect(mockFrom).toHaveBeenCalledWith('cag_semantic_cache');
    expect(chain.upsert).toHaveBeenCalledWith({
      id: 'entry-1',
      query: 'test query',
      response: 'test response',
      embedding: [0.1, 0.2, 0.3],
      hit_count: 0,
      metadata: {},
      created_at: NOW.toISOString(),
      expires_at: LATER.toISOString(),
    });
  });

  it('should throw on save cache entry error', async () => {
    const chain = mockChain({ error: { message: 'DB error' } });
    mockFrom.mockReturnValue(chain);

    await expect(adapter.saveCacheEntry(createCacheEntry())).rejects.toEqual({ message: 'DB error' });
  });

  it('should find similar cache entries via RPC', async () => {
    const entries = [{ id: 'hit-1' }];
    mockRpc.mockResolvedValue({ data: entries, error: null });

    const result = await adapter.findSimilarCacheEntries([0.1, 0.2], 0.85, 5);

    expect(mockRpc).toHaveBeenCalledWith('match_semantic_cache', {
      query_embedding: [0.1, 0.2],
      similarity_threshold: 0.85,
      match_count: 5,
    });
    expect(result).toEqual(entries);
  });

  it('should return empty array when no similar entries found', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const result = await adapter.findSimilarCacheEntries([0.1], 0.9, 3);
    expect(result).toEqual([]);
  });

  it('should throw on RPC error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'RPC failed' } });
    await expect(adapter.findSimilarCacheEntries([0.1], 0.9, 3)).rejects.toEqual({ message: 'RPC failed' });
  });

  // ─── Knowledge ───────────────────────────────────────────────────────

  it('should save knowledge entry via upsert', async () => {
    const chain = mockChain({ error: null });
    mockFrom.mockReturnValue(chain);

    const entry = createKnowledgeEntry({ createdBy: 'user-1' });
    await adapter.saveKnowledge(entry);

    expect(mockFrom).toHaveBeenCalledWith('cag_curated_knowledge');
    expect(chain.upsert).toHaveBeenCalledWith({
      id: 'k-1',
      content: 'Knowledge content',
      source: 'user_taught',
      category: 'general',
      priority: 0.7,
      usage_count: 0,
      tags: ['test'],
      created_by: 'user-1',
      last_used_at: NOW.toISOString(),
      created_at: NOW.toISOString(),
    });
  });

  it('should throw on save knowledge error', async () => {
    const chain = mockChain({ error: { message: 'insert failed' } });
    mockFrom.mockReturnValue(chain);
    await expect(adapter.saveKnowledge(createKnowledgeEntry())).rejects.toEqual({ message: 'insert failed' });
  });

  it('should load all knowledge sorted by priority desc', async () => {
    const rows = [
      {
        id: 'k-1',
        content: 'Content',
        source: 'user_taught',
        category: 'general',
        priority: 0.9,
        usage_count: 5,
        last_used_at: NOW.toISOString(),
        created_at: NOW.toISOString(),
        created_by: 'user-1',
        tags: ['tag1'],
      },
    ];
    const chain = mockChain({ data: rows, error: null });
    mockFrom.mockReturnValue(chain);

    const result = await adapter.loadAllKnowledge();

    expect(mockFrom).toHaveBeenCalledWith('cag_curated_knowledge');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'k-1',
      content: 'Content',
      source: 'user_taught',
      category: 'general',
      priority: 0.9,
      usageCount: 5,
      lastUsedAt: new Date(NOW.toISOString()),
      createdAt: new Date(NOW.toISOString()),
      createdBy: 'user-1',
      tags: ['tag1'],
    });
  });

  it('should return empty array when no knowledge exists', async () => {
    const chain = mockChain({ data: null, error: null });
    mockFrom.mockReturnValue(chain);
    const result = await adapter.loadAllKnowledge();
    expect(result).toEqual([]);
  });

  it('should throw on load knowledge error', async () => {
    const chain = mockChain({ data: null, error: { message: 'select failed' } });
    mockFrom.mockReturnValue(chain);
    await expect(adapter.loadAllKnowledge()).rejects.toEqual({ message: 'select failed' });
  });

  // ─── Snapshots ───────────────────────────────────────────────────────

  it('should save a snapshot via upsert', async () => {
    const chain = mockChain({ error: null });
    mockFrom.mockReturnValue(chain);

    const snapshot = createSnapshot();
    await adapter.saveSnapshot(snapshot);

    expect(mockFrom).toHaveBeenCalledWith('cag_dynamic_snapshots');
    expect(chain.upsert).toHaveBeenCalledWith({
      key: 'snapshot-1',
      original: 'Original long text',
      compressed: 'Compressed text',
      compression_ratio: 0.45,
      token_count: 100,
      created_at: NOW.toISOString(),
      expires_at: LATER.toISOString(),
    });
  });

  it('should throw on save snapshot error', async () => {
    const chain = mockChain({ error: { message: 'upsert failed' } });
    mockFrom.mockReturnValue(chain);
    await expect(adapter.saveSnapshot(createSnapshot())).rejects.toEqual({ message: 'upsert failed' });
  });

  // ─── Analytics ───────────────────────────────────────────────────────

  it('should track usage event', async () => {
    const chain = mockChain({ error: null });
    mockFrom.mockReturnValue(chain);

    await adapter.trackUsage({
      eventType: 'query',
      layerName: 'static',
      tokensUsed: 500,
      latencyMs: 42,
      cacheHit: true,
      metadata: { model: 'sonnet' },
    });

    expect(mockFrom).toHaveBeenCalledWith('cag_usage_analytics');
    expect(chain.insert).toHaveBeenCalledWith({
      event_type: 'query',
      layer_name: 'static',
      tokens_used: 500,
      latency_ms: 42,
      cache_hit: true,
      metadata: { model: 'sonnet' },
    });
  });

  it('should use empty metadata when not provided', async () => {
    const chain = mockChain({ error: null });
    mockFrom.mockReturnValue(chain);

    await adapter.trackUsage({
      eventType: 'query',
      layerName: 'dynamic',
      tokensUsed: 100,
      latencyMs: 10,
      cacheHit: false,
    });

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: {} }),
    );
  });

  it('should throw on track usage error', async () => {
    const chain = mockChain({ error: { message: 'insert failed' } });
    mockFrom.mockReturnValue(chain);

    await expect(
      adapter.trackUsage({
        eventType: 'query',
        layerName: 'static',
        tokensUsed: 100,
        latencyMs: 10,
        cacheHit: false,
      }),
    ).rejects.toEqual({ message: 'insert failed' });
  });

  // ─── getClient ───────────────────────────────────────────────────────

  it('should expose the underlying Supabase client', () => {
    const client = adapter.getClient();
    expect(client).toBe(mockSupabaseClient);
  });
});
