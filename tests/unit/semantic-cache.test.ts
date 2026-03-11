import { describe, it, expect, beforeEach } from 'vitest';
import { cosineSimilarity, dotProduct, euclideanDistance, normalizeVector, findTopK } from '../../src/layers/layer3-semantic-cache/similarity.js';
import { EmbeddingStore } from '../../src/layers/layer3-semantic-cache/embedding-store.js';
import { SemanticCache } from '../../src/layers/layer3-semantic-cache/semantic-cache.js';
import { createTestConfig } from '../../src/core/config.js';

// ─── Similarity Utilities ────────────────────────────────────────────────────

describe('cosineSimilarity', () => {
  it('should return 1 for identical vectors', () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1);
  });

  it('should return 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('should return -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('should throw for mismatched dimensions', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow('dimension mismatch');
  });

  it('should handle zero vectors', () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });
});

describe('dotProduct', () => {
  it('should compute dot product correctly', () => {
    expect(dotProduct([1, 2, 3], [4, 5, 6])).toBe(32); // 4+10+18
  });

  it('should return 0 for orthogonal vectors', () => {
    expect(dotProduct([1, 0], [0, 1])).toBe(0);
  });

  it('should throw for mismatched dimensions', () => {
    expect(() => dotProduct([1], [1, 2])).toThrow('dimension mismatch');
  });
});

describe('euclideanDistance', () => {
  it('should return 0 for identical vectors', () => {
    expect(euclideanDistance([1, 2, 3], [1, 2, 3])).toBe(0);
  });

  it('should compute distance correctly', () => {
    expect(euclideanDistance([0, 0], [3, 4])).toBeCloseTo(5); // 3-4-5 triangle
  });

  it('should throw for mismatched dimensions', () => {
    expect(() => euclideanDistance([1], [1, 2])).toThrow('dimension mismatch');
  });
});

describe('normalizeVector', () => {
  it('should normalize to unit length', () => {
    const normalized = normalizeVector([3, 4]);
    expect(normalized[0]).toBeCloseTo(0.6);
    expect(normalized[1]).toBeCloseTo(0.8);

    // Check magnitude is 1
    const magnitude = Math.sqrt(normalized[0]! ** 2 + normalized[1]! ** 2);
    expect(magnitude).toBeCloseTo(1);
  });

  it('should handle zero vector', () => {
    const normalized = normalizeVector([0, 0, 0]);
    expect(normalized).toEqual([0, 0, 0]);
  });

  it('should not mutate the original vector', () => {
    const original = [3, 4];
    normalizeVector(original);
    expect(original).toEqual([3, 4]);
  });
});

describe('findTopK', () => {
  it('should find the most similar vectors', () => {
    const candidates = [
      { id: 'a', embedding: [1, 0, 0] },
      { id: 'b', embedding: [0, 1, 0] },
      { id: 'c', embedding: [0.9, 0.1, 0] },
    ];

    const results = findTopK([1, 0, 0], candidates, 2);
    expect(results).toHaveLength(2);
    expect(results[0]?.id).toBe('a');
    expect(results[1]?.id).toBe('c');
  });
});

// ─── EmbeddingStore ──────────────────────────────────────────────────────────

describe('EmbeddingStore', () => {
  let store: EmbeddingStore;

  beforeEach(() => {
    store = new EmbeddingStore();
  });

  it('should add and find similar embeddings', () => {
    store.add('q1', 'What is your return policy?', [1, 0, 0]);
    store.add('q2', 'How do I return an item?', [0.9, 0.1, 0]);
    store.add('q3', 'What is your phone number?', [0, 1, 0]);

    const results = store.findSimilar([1, 0, 0], 0.8);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.entry.id).toBe('q1');
  });

  it('should respect similarity threshold', () => {
    store.add('q1', 'test', [1, 0]);
    store.add('q2', 'test2', [0, 1]);

    const results = store.findSimilar([1, 0], 0.99);
    expect(results).toHaveLength(1);
  });

  it('should delete oldest entries', () => {
    store.add('q1', 'oldest', [1, 0]);
    store.add('q2', 'middle', [0, 1]);
    store.add('q3', 'newest', [1, 1]);

    const deleted = store.deleteOldest(2);
    expect(deleted).toHaveLength(2);
    expect(store.size()).toBe(1);
    expect(store.has('q3')).toBe(true);
  });

  it('should find entries by text pattern', () => {
    store.add('q1', 'return policy', [1, 0]);
    store.add('q2', 'phone number', [0, 1]);
    store.add('q3', 'return an item', [1, 1]);

    const matches = store.findByTextPattern('return');
    expect(matches).toHaveLength(2);
    expect(matches).toContain('q1');
    expect(matches).toContain('q3');
  });

  it('should find entries older than a date', () => {
    store.add('q1', 'old', [1, 0]);
    const cutoff = new Date(Date.now() + 1000);

    const oldIds = store.findOlderThan(cutoff);
    expect(oldIds).toContain('q1');
  });

  it('should clear all entries', () => {
    store.add('q1', 'test', [1, 0]);
    store.clear();
    expect(store.size()).toBe(0);
  });

  it('should report count correctly', () => {
    expect(store.count()).toBe(0);
    store.add('q1', 'test', [1, 0]);
    expect(store.count()).toBe(1);
  });
});

// ─── SemanticCache ───────────────────────────────────────────────────────────

/**
 * Create a fake embedding function for tests.
 * Maps query strings to deterministic vectors so we can control similarity.
 */
function createFakeEmbedder(): (text: string) => Promise<number[]> {
  const knownEmbeddings: Record<string, number[]> = {
    'qual o saldo de hoje': [1, 0, 0],
    'quanto temos em caixa': [0.95, 0.05, 0],  // similar to saldo
    'como devolver um produto': [0, 1, 0],       // completely different
    'política de devolução': [0.05, 0.95, 0],    // similar to devolver
    'horário de funcionamento': [0, 0, 1],        // different topic
  };

  return async (text: string) => {
    return knownEmbeddings[text] ?? [
      // Hash-based fallback for unknown texts
      Math.sin(text.length * 1.1),
      Math.cos(text.length * 2.3),
      Math.sin(text.length * 3.7),
    ];
  };
}

describe('SemanticCache', () => {
  let cache: SemanticCache;
  let embedder: (text: string) => Promise<number[]>;

  beforeEach(() => {
    const config = createTestConfig({
      layers: {
        semanticCache: {
          similarityThreshold: 0.85,
          maxEntries: 100,
          ttl: 7200,
        },
      },
    });
    cache = new SemanticCache(config);
    embedder = createFakeEmbedder();
    cache.setEmbeddingFunction(embedder);
  });

  it('should return null on cache miss', async () => {
    const result = await cache.lookup('qual o saldo de hoje');
    expect(result).toBeNull();
  });

  it('should return cached response on cache hit (similar query)', async () => {
    await cache.store('qual o saldo de hoje', 'O saldo atual é R$ 150.000');

    // Similar query — cosine(saldo, caixa) ≈ 0.95+ (above 0.85 threshold)
    const result = await cache.lookup('quanto temos em caixa');

    expect(result).not.toBeNull();
    expect(result!.response).toBe('O saldo atual é R$ 150.000');
    expect(result!.similarity).toBeGreaterThan(0.85);
    expect(result!.hitCount).toBe(1);
  });

  it('should miss when similarity is below threshold', async () => {
    await cache.store('qual o saldo de hoje', 'O saldo é R$ 150.000');

    // Completely different topic
    const result = await cache.lookup('como devolver um produto');
    expect(result).toBeNull();
  });

  it('should increment hitCount on repeated lookups', async () => {
    await cache.store('qual o saldo de hoje', 'R$ 150.000');

    await cache.lookup('quanto temos em caixa');
    const result = await cache.lookup('quanto temos em caixa');

    expect(result).not.toBeNull();
    expect(result!.hitCount).toBe(2);
  });

  it('should track stats correctly', async () => {
    await cache.store('qual o saldo de hoje', 'R$ 150.000');

    // 1 hit + 1 miss
    await cache.lookup('quanto temos em caixa');   // hit
    await cache.lookup('como devolver um produto'); // miss

    const stats = cache.getStats();
    expect(stats.totalEntries).toBe(1);
    expect(stats.hitRate).toBeCloseTo(0.5);
    expect(stats.avgSimilarity).toBeGreaterThan(0);
    expect(stats.tokensSaved).toBeGreaterThan(0);
  });

  it('should apply LRU eviction when maxEntries is exceeded', async () => {
    const config = createTestConfig({
      layers: {
        semanticCache: {
          similarityThreshold: 0.85,
          maxEntries: 2, // Very small limit
          ttl: 7200,
        },
      },
    });
    const smallCache = new SemanticCache(config);
    smallCache.setEmbeddingFunction(embedder);

    // Store 3 entries — the oldest should be evicted
    await smallCache.store('qual o saldo de hoje', 'R$ 150.000');
    await smallCache.store('como devolver um produto', 'Envie pelo correio');
    await smallCache.store('horário de funcionamento', '9h às 18h');

    const stats = smallCache.getStats();
    expect(stats.totalEntries).toBe(2);

    // The first entry (saldo) should have been evicted
    const evicted = await smallCache.lookup('qual o saldo de hoje');
    expect(evicted).toBeNull();
  });

  it('should invalidate all entries when no pattern given', async () => {
    await cache.store('qual o saldo de hoje', 'R$ 150.000');
    await cache.store('como devolver um produto', 'Envie pelo correio');

    const removed = await cache.invalidate();
    expect(removed).toBe(2);
    expect(cache.getStats().totalEntries).toBe(0);
  });

  it('should invalidate entries matching a pattern', async () => {
    await cache.store('qual o saldo de hoje', 'R$ 150.000');
    await cache.store('como devolver um produto', 'Envie pelo correio');
    await cache.store('política de devolução', 'Até 30 dias');

    // Remove only "devol" related entries
    const removed = await cache.invalidate('devol');
    expect(removed).toBe(2); // "devolver" + "devolução"
    expect(cache.getStats().totalEntries).toBe(1);
  });

  it('should invalidate entries by age', async () => {
    await cache.store('qual o saldo de hoje', 'R$ 150.000');

    // Wait a bit for timestamp difference
    await new Promise((r) => setTimeout(r, 50));

    await cache.store('como devolver um produto', 'Envie pelo correio');

    // Remove entries older than 0.04 seconds (the first one)
    const removed = await cache.invalidateByAge(0.04);
    expect(removed).toBe(1);
    expect(cache.getStats().totalEntries).toBe(1);
  });

  it('should clear all entries and reset stats', async () => {
    await cache.store('qual o saldo de hoje', 'R$ 150.000');
    await cache.lookup('quanto temos em caixa');

    await cache.clear();

    expect(cache.getStats().totalEntries).toBe(0);
    expect(cache.getStats().hitRate).toBe(0);
    expect(cache.getStats().tokensSaved).toBe(0);
  });

  it('should expire entries past TTL', async () => {
    const config = createTestConfig({
      layers: {
        semanticCache: {
          similarityThreshold: 0.85,
          maxEntries: 100,
          ttl: 1, // 1 second TTL
        },
      },
    });
    const shortCache = new SemanticCache(config);
    shortCache.setEmbeddingFunction(embedder);

    await shortCache.store('qual o saldo de hoje', 'R$ 150.000');

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 1100));

    const result = await shortCache.lookup('quanto temos em caixa');
    expect(result).toBeNull();
  });

  it('should return null if no embedding function set', async () => {
    const config = createTestConfig();
    const noEmbedCache = new SemanticCache(config);

    const result = await noEmbedCache.lookup('test');
    expect(result).toBeNull();
  });

  it('should keep backward compat via get/set', async () => {
    await cache.set('qual o saldo de hoje', 'R$ 150.000');
    const entry = await cache.get('quanto temos em caixa');

    expect(entry).not.toBeNull();
    expect(entry!.responseText).toBe('R$ 150.000');
  });
});
