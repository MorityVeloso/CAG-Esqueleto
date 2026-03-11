import { describe, it, expect, beforeEach } from 'vitest';
import { ACEEngine } from '../../src/layers/layer5-curated-knowledge/ace-engine.js';
import { PrioritySystem } from '../../src/layers/layer5-curated-knowledge/priority-system.js';
import { KnowledgeStore } from '../../src/layers/layer5-curated-knowledge/knowledge-store.js';
import { createTestConfig } from '../../src/core/config.js';
import type { CuratedKnowledgeEntry, Message } from '../../src/core/types.js';

// ─── Helper ─────────────────────────────────────────────────────────────────

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

// ─── PrioritySystem ─────────────────────────────────────────────────────────

describe('PrioritySystem', () => {
  let ps: PrioritySystem;

  beforeEach(() => {
    ps = new PrioritySystem();
  });

  it('should return correct initial priorities by source', () => {
    expect(ps.calculateInitialPriority('user_taught')).toBe(0.7);
    expect(ps.calculateInitialPriority('auto_extracted')).toBe(0.5);
    expect(ps.calculateInitialPriority('feedback_loop')).toBe(0.6);
  });

  it('should boost priority for usage (+0.02)', () => {
    expect(ps.boostPriority(0.5, 'usage')).toBeCloseTo(0.52);
  });

  it('should boost priority for positive feedback (+0.10)', () => {
    expect(ps.boostPriority(0.5, 'positive_feedback')).toBeCloseTo(0.6);
  });

  it('should cap boost at 1.0', () => {
    expect(ps.boostPriority(0.95, 'positive_feedback')).toBe(1.0);
  });

  it('should penalize for negative feedback (-0.15)', () => {
    expect(ps.penalizePriority(0.5, 'negative_feedback')).toBeCloseTo(0.35);
  });

  it('should floor penalize at 0.0', () => {
    expect(ps.penalizePriority(0.1, 'negative_feedback')).toBe(0);
  });

  it('should apply multiplicative decay', () => {
    expect(ps.penalizePriority(1.0, 'decay', 0.95)).toBeCloseTo(0.95);
    expect(ps.penalizePriority(0.5, 'decay', 0.95)).toBeCloseTo(0.475);
  });

  it('should determine inclusion correctly', () => {
    expect(ps.shouldInclude(0.5, 0.1)).toBe(true);
    expect(ps.shouldInclude(0.05, 0.1)).toBe(false);
    expect(ps.shouldInclude(0.1, 0.1)).toBe(true);
  });

  it('should determine prune correctly (threshold = 0.05)', () => {
    expect(ps.shouldPrune(0.04)).toBe(true);
    expect(ps.shouldPrune(0.05)).toBe(false);
    expect(ps.shouldPrune(0.5)).toBe(false);
  });
});

// ─── KnowledgeStore ─────────────────────────────────────────────────────────

describe('KnowledgeStore', () => {
  let store: KnowledgeStore;

  beforeEach(() => {
    store = new KnowledgeStore();
  });

  it('should save and retrieve by ID', () => {
    const entry = createEntry({ id: 'test-1' });
    store.save(entry);
    expect(store.getById('test-1')).toEqual(entry);
  });

  it('should return null for unknown ID', () => {
    expect(store.getById('nonexistent')).toBeNull();
  });

  it('should filter by category', () => {
    store.save(createEntry({ id: '1', category: 'faq' }));
    store.save(createEntry({ id: '2', category: 'faq' }));
    store.save(createEntry({ id: '3', category: 'docs' }));
    expect(store.getByCategory('faq')).toHaveLength(2);
  });

  it('should get by priority (sorted DESC)', () => {
    store.save(createEntry({ id: 'low', priority: 0.2 }));
    store.save(createEntry({ id: 'high', priority: 0.9 }));
    store.save(createEntry({ id: 'mid', priority: 0.5 }));

    const results = store.getByPriority(0.3);
    expect(results).toHaveLength(2);
    expect(results[0]?.id).toBe('high');
    expect(results[1]?.id).toBe('mid');
  });

  it('should search by keyword in content and tags', () => {
    store.save(createEntry({ id: '1', content: 'return policy allows 30 days', tags: ['returns'] }));
    store.save(createEntry({ id: '2', content: 'phone number is 555-1234', tags: ['contact'] }));

    const results = store.search('return policy');
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('1');
  });

  it('should return empty for search with no matches', () => {
    store.save(createEntry({ id: '1', content: 'unrelated content' }));
    expect(store.search('pizza recipe')).toHaveLength(0);
  });

  it('should update partial fields', () => {
    store.save(createEntry({ id: 'u1', priority: 0.5 }));
    store.update('u1', { priority: 0.8 });
    expect(store.getById('u1')?.priority).toBe(0.8);
  });

  it('should record usage (increment + timestamp)', () => {
    store.save(createEntry({ id: 'u1', usageCount: 0 }));
    store.recordUsage('u1');
    expect(store.getById('u1')?.usageCount).toBe(1);
  });

  it('should delete by ID', () => {
    store.save(createEntry({ id: 'd1' }));
    expect(store.delete('d1')).toBe(true);
    expect(store.getById('d1')).toBeNull();
  });

  it('should delete by priority threshold', () => {
    store.save(createEntry({ id: 'low', priority: 0.03 }));
    store.save(createEntry({ id: 'mid', priority: 0.2 }));
    store.save(createEntry({ id: 'high', priority: 0.8 }));

    const removed = store.deleteByPriority(0.1);
    expect(removed).toBe(1);
    expect(store.count()).toBe(2);
  });

  it('should count and clear', () => {
    store.save(createEntry({ id: '1' }));
    store.save(createEntry({ id: '2' }));
    expect(store.count()).toBe(2);

    store.clear();
    expect(store.count()).toBe(0);
  });
});

// ─── ACEEngine ──────────────────────────────────────────────────────────────

describe('ACEEngine', () => {
  let ace: ACEEngine;

  beforeEach(() => {
    const config = createTestConfig();
    ace = new ACEEngine(config);
  });

  // ── teach ───────────────────────────────────────────────────────────

  it('should teach with correct source and priority', async () => {
    const entry = await ace.teach(
      'Our return policy allows 30 day returns',
      'faq',
      ['returns', 'policy'],
      'admin',
    );

    expect(entry.id).toMatch(/^ck_/);
    expect(entry.source).toBe('user_taught');
    expect(entry.priority).toBe(0.7);
    expect(entry.category).toBe('faq');
    expect(entry.tags).toEqual(['returns', 'policy']);
    expect(entry.createdBy).toBe('admin');
    expect(entry.usageCount).toBe(0);
    expect(entry.createdAt).toBeInstanceOf(Date);
  });

  // ── autoExtract ─────────────────────────────────────────────────────

  it('should detect user correction and auto-extract', async () => {
    const conversation: Message[] = [
      { role: 'user', content: 'Qual o prazo de devolução?' },
      { role: 'assistant', content: 'O prazo é de 15 dias.' },
      { role: 'user', content: 'Não, na verdade é 30 dias.' },
    ];

    const entry = await ace.autoExtract(conversation, 'OK, corrigido para 30 dias.');

    expect(entry).not.toBeNull();
    expect(entry!.source).toBe('auto_extracted');
    expect(entry!.category).toBe('correction');
    expect(entry!.priority).toBe(0.5);
    expect(entry!.tags).toContain('correction');
  });

  it('should detect teaching pattern and auto-extract', async () => {
    const conversation: Message[] = [
      { role: 'user', content: 'Lembre-se que a política de frete grátis é acima de R$200' },
    ];

    const entry = await ace.autoExtract(conversation, 'Entendido, anotado.');

    expect(entry).not.toBeNull();
    expect(entry!.source).toBe('auto_extracted');
    expect(entry!.category).toBe('learned');
    expect(entry!.tags).toContain('learned');
  });

  it('should return null when no pattern detected', async () => {
    const conversation: Message[] = [
      { role: 'user', content: 'Qual o horário de funcionamento?' },
    ];

    const entry = await ace.autoExtract(conversation, '9h às 18h.');
    expect(entry).toBeNull();
  });

  it('should return null for empty conversation', async () => {
    const entry = await ace.autoExtract([], 'response');
    expect(entry).toBeNull();
  });

  // ── getRelevantKnowledge ────────────────────────────────────────────

  it('should return relevant knowledge as formatted context block', async () => {
    await ace.teach('Return policy allows 30 day returns for refund', 'faq', ['returns']);
    await ace.teach('Phone number is 555-1234', 'contact', ['phone']);

    const block = await ace.getRelevantKnowledge('return policy', 5000);

    expect(block.layer).toBe('curated');
    expect(block.content).toContain('[CONHECIMENTO CURADO]');
    expect(block.content).toContain('[faq]');
    expect(block.content).toContain('return');
    expect(block.content).not.toContain('555-1234');
    expect(block.tokenCount).toBeGreaterThan(0);
  });

  it('should return empty content when no relevant entries', async () => {
    await ace.teach('Technical documentation about APIs', 'docs', ['api']);

    const block = await ace.getRelevantKnowledge('pizza recipe', 5000);
    expect(block.content).toBe('');
  });

  it('should respect maxTokens budget', async () => {
    // Add many entries
    for (let i = 0; i < 20; i++) {
      await ace.teach(
        `Knowledge entry number ${i} about return policy and refund procedures`,
        'faq',
        ['returns'],
      );
    }

    // Very small token budget
    const block = await ace.getRelevantKnowledge('return policy', 50);
    const lines = block.content.split('\n').filter((l) => l.startsWith('- '));
    expect(lines.length).toBeLessThan(20);
  });

  // ── recordUsage ─────────────────────────────────────────────────────

  it('should boost priority on usage', async () => {
    const entry = await ace.teach('Test content', 'general');
    const originalPriority = entry.priority; // 0.7

    await ace.recordUsage(entry.id);

    const updated = ace.getStore().getById(entry.id);
    expect(updated!.priority).toBeCloseTo(originalPriority + 0.02);
    expect(updated!.usageCount).toBe(1);
  });

  // ── decayPriorities ─────────────────────────────────────────────────

  it('should decay all priorities by factor', async () => {
    const entry = await ace.teach('Test content for decay', 'general');
    expect(entry.priority).toBe(0.7);

    await ace.decayPriorities();

    const updated = ace.getStore().getById(entry.id);
    expect(updated!.priority).toBeCloseTo(0.7 * 0.95); // decayFactor default = 0.95
  });

  it('should prune entries below 0.05 after decay', async () => {
    // Create an entry with very low priority
    const entry = await ace.teach('Almost dead content', 'general');
    // Manually set priority to just above prune threshold
    ace.getStore().update(entry.id, { priority: 0.04 });

    await ace.decayPriorities();

    // After decay: 0.04 * 0.95 = 0.038 < 0.05 → pruned
    expect(ace.getStore().getById(entry.id)).toBeNull();
  });

  it('should NOT prune entries above 0.05 after decay', async () => {
    const entry = await ace.teach('Surviving content', 'general');
    // Priority 0.7 * 0.95 = 0.665 → well above 0.05
    await ace.decayPriorities();
    expect(ace.getStore().getById(entry.id)).not.toBeNull();
  });

  // ── feedback ────────────────────────────────────────────────────────

  it('should boost priority on positive feedback (+0.10)', async () => {
    const entry = await ace.teach('Helpful knowledge', 'faq');
    const originalPriority = entry.priority; // 0.7

    await ace.feedback(entry.id, true);

    const updated = ace.getStore().getById(entry.id);
    expect(updated!.priority).toBeCloseTo(originalPriority + 0.1);
  });

  it('should penalize priority on negative feedback (-0.15)', async () => {
    const entry = await ace.teach('Unhelpful knowledge', 'faq');
    const originalPriority = entry.priority; // 0.7

    await ace.feedback(entry.id, false);

    const updated = ace.getStore().getById(entry.id);
    expect(updated!.priority).toBeCloseTo(originalPriority - 0.15);
  });

  it('should cap positive feedback at 1.0', async () => {
    const entry = await ace.teach('Very helpful', 'faq');
    ace.getStore().update(entry.id, { priority: 0.95 });

    await ace.feedback(entry.id, true);

    const updated = ace.getStore().getById(entry.id);
    expect(updated!.priority).toBe(1.0);
  });

  it('should floor negative feedback at 0.0', async () => {
    const entry = await ace.teach('Very unhelpful', 'faq');
    ace.getStore().update(entry.id, { priority: 0.1 });

    await ace.feedback(entry.id, false);

    const updated = ace.getStore().getById(entry.id);
    expect(updated!.priority).toBe(0);
  });

  // ── filtering by minPriority ────────────────────────────────────────

  it('should filter out entries below minPriority from relevantKnowledge', async () => {
    const entry = await ace.teach(
      'Low priority content with keyword match return policy',
      'faq',
      ['returns'],
    );
    // Set below minPriority (default 0.1)
    ace.getStore().update(entry.id, { priority: 0.05 });

    const block = await ace.getRelevantKnowledge('return policy', 5000);
    expect(block.content).toBe('');
  });

  // ── eviction ────────────────────────────────────────────────────────

  it('should evict lowest priority entries when exceeding maxEntries', async () => {
    const config = createTestConfig({
      layers: {
        curatedKnowledge: {
          maxEntries: 2,
          decayFactor: 0.95,
          minPriority: 0.1,
        },
      },
    });
    const smallAce = new ACEEngine(config);

    await smallAce.teach('First entry', 'faq');
    await smallAce.teach('Second entry', 'faq');

    // Override first entry to low priority so it gets evicted
    const allBefore = smallAce.getStore().getAll();
    smallAce.getStore().update(allBefore[0]!.id, { priority: 0.1 });

    // Third entry triggers eviction
    await smallAce.teach('Third entry', 'faq');

    expect(smallAce.getStore().count()).toBe(2);
  });

  // ── getStats ────────────────────────────────────────────────────────

  it('should return accurate stats', async () => {
    await ace.teach('FAQ content', 'faq', ['help']);
    await ace.teach('Docs content', 'docs', ['technical']);

    const conversation: Message[] = [
      { role: 'user', content: 'Não, na verdade é diferente' },
    ];
    await ace.autoExtract(conversation, 'OK');

    const stats = ace.getStats();
    expect(stats.totalEntries).toBe(3);
    expect(stats.avgPriority).toBeGreaterThan(0);
    expect(stats.categoryCounts['faq']).toBe(1);
    expect(stats.categoryCounts['docs']).toBe(1);
    expect(stats.categoryCounts['correction']).toBe(1);
    expect(stats.sourceCounts['user_taught']).toBe(2);
    expect(stats.sourceCounts['auto_extracted']).toBe(1);
  });

  // ── ordering by priority ────────────────────────────────────────────

  it('should order relevant knowledge by combined score (relevance + priority)', async () => {
    // Both match "return policy" but one has higher priority
    const low = await ace.teach('Return policy basic info', 'faq');
    const high = await ace.teach('Return policy detailed with refund', 'faq');

    // Boost the second entry
    ace.getStore().update(high.id, { priority: 1.0 });
    ace.getStore().update(low.id, { priority: 0.3 });

    const block = await ace.getRelevantKnowledge('return policy', 5000);
    const lines = block.content.split('\n').filter((l) => l.startsWith('- '));

    // Higher priority entry should come first
    expect(lines[0]).toContain('detailed');
  });
});
