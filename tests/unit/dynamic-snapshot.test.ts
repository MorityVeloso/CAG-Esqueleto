import { describe, it, expect, beforeEach } from 'vitest';
import { Compressor } from '../../src/layers/layer2-dynamic-cag/compressor.js';
import { DynamicSnapshot } from '../../src/layers/layer2-dynamic-cag/dynamic-snapshot.js';
import { createTestConfig } from '../../src/core/config.js';

describe('Compressor', () => {
  let compressor: Compressor;

  beforeEach(() => {
    compressor = new Compressor();
  });

  it('should compress structurally by removing whitespace', () => {
    const result = compressor.structural('Hello\n\n\n\nWorld\n\n\n\nTest');
    expect(result.compressed).toBe('Hello\n\nWorld\n\nTest');
    expect(result.ratio).toBeLessThanOrEqual(1);
  });

  it('should deduplicate consecutive lines', () => {
    const result = compressor.structural('Line A\nLine A\nLine B');
    expect(result.compressed).toBe('Line A\nLine B');
  });

  it('should extract top sentences by keyword frequency', () => {
    const text = 'The product costs $50. We ship worldwide. The product is available in 3 colors. Shipping takes 5 days.';
    const result = compressor.extractive(text, 50);
    expect(result.compressedTokens).toBeLessThanOrEqual(50);
    expect(result.compressed.length).toBeGreaterThan(0);
  });

  it('should handle empty text', () => {
    const result = compressor.extractive('', 100);
    expect(result.compressed).toBe('');
  });
});

describe('DynamicSnapshot', () => {
  let snapshot: DynamicSnapshot;

  beforeEach(() => {
    const config = createTestConfig();
    snapshot = new DynamicSnapshot(config);
  });

  it('should create a compressed snapshot returning a ContextBlock', async () => {
    const result = await snapshot.createSnapshot(
      'Product A: $10. Product B: $20. Product C: $30.',
      'prices',
    );

    expect(result.id).toBe('dynamic-prices');
    expect(result.layer).toBe('dynamic');
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('should retrieve a stored snapshot', async () => {
    await snapshot.createSnapshot(
      'Item 1: 50 units. Item 2: 100 units.',
      'inventory',
    );

    const result = await snapshot.getLatestSnapshot('inventory');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('dynamic-inventory');
    expect(result?.layer).toBe('dynamic');
  });

  it('should return null for non-existent key', async () => {
    const result = await snapshot.getLatestSnapshot('nonexistent');
    expect(result).toBeNull();
  });

  it('should use "default" key when not specified', async () => {
    await snapshot.createSnapshot('Some content');

    const result = await snapshot.getLatestSnapshot();
    expect(result).not.toBeNull();
    expect(result?.id).toBe('dynamic-default');
  });
});
