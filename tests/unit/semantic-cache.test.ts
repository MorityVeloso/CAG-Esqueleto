import { describe, it, expect } from 'vitest';
import { cosineSimilarity, findTopK } from '../../src/layers/layer3-semantic-cache/similarity.js';
import { EmbeddingStore } from '../../src/layers/layer3-semantic-cache/embedding-store.js';

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

describe('EmbeddingStore', () => {
  it('should add and find similar embeddings', () => {
    const store = new EmbeddingStore();
    store.add('q1', 'What is your return policy?', [1, 0, 0]);
    store.add('q2', 'How do I return an item?', [0.9, 0.1, 0]);
    store.add('q3', 'What is your phone number?', [0, 1, 0]);

    const results = store.findSimilar([1, 0, 0], 0.8);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.entry.id).toBe('q1');
  });

  it('should respect similarity threshold', () => {
    const store = new EmbeddingStore();
    store.add('q1', 'test', [1, 0]);
    store.add('q2', 'test2', [0, 1]);

    const results = store.findSimilar([1, 0], 0.99);
    expect(results).toHaveLength(1);
  });

  it('should clear all entries', () => {
    const store = new EmbeddingStore();
    store.add('q1', 'test', [1, 0]);
    store.clear();
    expect(store.size()).toBe(0);
  });
});
