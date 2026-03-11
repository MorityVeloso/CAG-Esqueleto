import { describe, it, expect, beforeEach } from 'vitest';
import { ACEEngine } from '../../src/layers/layer5-curated-knowledge/ace-engine.js';
import { PrioritySystem } from '../../src/layers/layer5-curated-knowledge/priority-system.js';
import { KnowledgeStore } from '../../src/layers/layer5-curated-knowledge/knowledge-store.js';
import { createTestConfig } from '../../src/core/config.js';
import type { KnowledgeEntry } from '../../src/core/types.js';

function createEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: `entry-${Math.random().toString(36).slice(2)}`,
    content: 'Test knowledge content',
    category: 'general',
    priority: 0.5,
    usageCount: 0,
    lastUsedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

describe('KnowledgeStore', () => {
  let store: KnowledgeStore;

  beforeEach(() => {
    store = new KnowledgeStore();
  });

  it('should add and retrieve entries', () => {
    const entry = createEntry({ id: 'test-1' });
    store.add(entry);
    expect(store.get('test-1')).toEqual(entry);
  });

  it('should record usage', () => {
    const entry = createEntry({ id: 'test-1', usageCount: 0 });
    store.add(entry);
    store.recordUsage('test-1');
    expect(store.get('test-1')?.usageCount).toBe(1);
  });

  it('should filter by category', () => {
    store.add(createEntry({ category: 'faq' }));
    store.add(createEntry({ category: 'faq' }));
    store.add(createEntry({ category: 'docs' }));
    expect(store.getByCategory('faq')).toHaveLength(2);
  });

  it('should remove stale entries', () => {
    const old = createEntry({
      id: 'old',
      lastUsedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // 60 days ago
    });
    const recent = createEntry({ id: 'recent' });
    store.add(old);
    store.add(recent);
    const removed = store.removeStale(30);
    expect(removed).toBe(1);
    expect(store.size()).toBe(1);
  });
});

describe('PrioritySystem', () => {
  it('should score entries by recency and frequency', () => {
    const system = new PrioritySystem();
    const entries = [
      createEntry({ id: 'recent', usageCount: 10, lastUsedAt: new Date() }),
      createEntry({
        id: 'old',
        usageCount: 1,
        lastUsedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      }),
    ];

    const scores = system.score(entries);
    const recentScore = scores.find((s) => s.entryId === 'recent');
    const oldScore = scores.find((s) => s.entryId === 'old');
    expect(recentScore!.score).toBeGreaterThan(oldScore!.score);
  });

  it('should respect category weights', () => {
    const system = new PrioritySystem();
    system.setCategoryWeight('critical', 1.0);
    system.setCategoryWeight('optional', 0.1);

    const entries = [
      createEntry({ id: 'critical', category: 'critical', usageCount: 1 }),
      createEntry({ id: 'optional', category: 'optional', usageCount: 1 }),
    ];

    const scores = system.score(entries);
    const critical = scores.find((s) => s.entryId === 'critical');
    const optional = scores.find((s) => s.entryId === 'optional');
    expect(critical!.score).toBeGreaterThan(optional!.score);
  });
});

describe('ACEEngine', () => {
  let ace: ACEEngine;

  beforeEach(() => {
    const config = createTestConfig();
    ace = new ACEEngine(config);
  });

  it('should add and retrieve relevant knowledge', async () => {
    await ace.addKnowledge(createEntry({
      id: 'return-policy',
      content: 'Our return policy allows 30 day returns',
      category: 'faq',
    }));

    const results = await ace.getRelevantKnowledge('return policy');
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('return-policy');
  });

  it('should return empty for unrelated queries', async () => {
    await ace.addKnowledge(createEntry({
      content: 'Technical documentation about APIs',
      category: 'docs',
    }));

    const results = await ace.getRelevantKnowledge('pizza recipe');
    expect(results).toHaveLength(0);
  });

  it('should prioritize entries', async () => {
    await ace.addKnowledge(createEntry({ id: 'a', usageCount: 10 }));
    await ace.addKnowledge(createEntry({ id: 'b', usageCount: 1 }));
    await ace.prioritize();

    const a = ace.getStore().get('a');
    const b = ace.getStore().get('b');
    expect(a!.priority).toBeGreaterThan(b!.priority);
  });
});
