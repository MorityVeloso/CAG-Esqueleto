import { describe, it, expect, beforeEach } from 'vitest';
import { ACEEngine } from '../../src/layers/layer5-curated-knowledge/ace-engine.js';
import { PrioritySystem } from '../../src/layers/layer5-curated-knowledge/priority-system.js';
import { KnowledgeStore } from '../../src/layers/layer5-curated-knowledge/knowledge-store.js';
import { createTestConfig } from '../../src/core/config.js';
import type { CuratedKnowledgeEntry } from '../../src/core/types.js';

function createEntry(overrides: Partial<CuratedKnowledgeEntry> = {}): CuratedKnowledgeEntry {
  return {
    id: `entry-${Math.random().toString(36).slice(2)}`,
    content: 'Test knowledge content',
    source: 'user_taught',
    category: 'general',
    priority: 0.5,
    usageCount: 0,
    lastUsedAt: new Date(),
    createdAt: new Date(),
    tags: [],
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

  it('should add an entry with auto-generated id and timestamps', async () => {
    const entry = await ace.addEntry({
      content: 'Our return policy allows 30 day returns',
      source: 'user_taught',
      category: 'faq',
      priority: 0.8,
      tags: ['returns', 'policy'],
    });

    expect(entry.id).toBeDefined();
    expect(entry.id.startsWith('ck_')).toBe(true);
    expect(entry.usageCount).toBe(0);
    expect(entry.createdAt).toBeInstanceOf(Date);
  });

  it('should retrieve relevant knowledge by keyword match', async () => {
    await ace.addEntry({
      content: 'Our return policy allows 30 day returns',
      source: 'user_taught',
      category: 'faq',
      priority: 0.8,
      tags: ['returns'],
    });

    const results = await ace.getRelevant('return policy');
    expect(results).toHaveLength(1);
    expect(results[0]?.content).toContain('return policy');
  });

  it('should return empty for unrelated queries', async () => {
    await ace.addEntry({
      content: 'Technical documentation about APIs',
      source: 'auto_extracted',
      category: 'docs',
      priority: 0.5,
      tags: ['api'],
    });

    const results = await ace.getRelevant('pizza recipe');
    expect(results).toHaveLength(0);
  });

  it('should decay priorities', async () => {
    const entry = await ace.addEntry({
      content: 'Test content for decay',
      source: 'user_taught',
      category: 'general',
      priority: 1.0,
      tags: [],
    });

    await ace.decayPriorities();

    const stored = ace.getStore().get(entry.id);
    expect(stored!.priority).toBeLessThan(1.0);
    expect(stored!.priority).toBeCloseTo(0.95); // decayFactor default = 0.95
  });

  it('should filter by minimum priority', async () => {
    // Add entry with priority below minPriority (default 0.1)
    await ace.addEntry({
      content: 'Low priority content with keyword match test',
      source: 'user_taught',
      category: 'general',
      priority: 0.05,
      tags: [],
    });

    const results = await ace.getRelevant('keyword match test');
    expect(results).toHaveLength(0);
  });
});
