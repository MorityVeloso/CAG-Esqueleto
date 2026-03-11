/**
 * CAG-Esqueleto — 5-Layer Context Engineering Module
 *
 * Quick start:
 * ```ts
 * import { createCAG } from 'cag-esqueleto';
 *
 * const cag = await createCAG({
 *   anthropic: { apiKey: process.env.ANTHROPIC_API_KEY! },
 * });
 *
 * const response = await cag.query({ message: 'Hello!' });
 * ```
 *
 * @packageDocumentation
 */

import type { CAGConfig, DeepPartial } from './core/types.js';
import { CAGEngine } from './core/cag-engine.js';
import { createConfig } from './core/config.js';

// ─── Convenience Factory ────────────────────────────────────────────────────

/**
 * Create and initialize a CAGEngine in one call.
 *
 * Only `anthropic.apiKey` is required — all other settings have sensible defaults.
 *
 * @example
 * ```ts
 * const cag = await createCAG({
 *   anthropic: { apiKey: 'sk-ant-...' },
 *   layers: {
 *     staticCAG: {
 *       sources: [{ id: 'rules', name: 'Rules', type: 'text', content: '...', category: 'rules', priority: 10 }]
 *     }
 *   }
 * });
 * ```
 */
export async function createCAG(
  config: DeepPartial<CAGConfig> & { anthropic: { apiKey: string } },
): Promise<CAGEngine> {
  const fullConfig = createConfig(config);
  const engine = new CAGEngine(fullConfig);
  await engine.initialize();
  return engine;
}

// ─── Core ───────────────────────────────────────────────────────────────────

export { CAGEngine } from './core/cag-engine.js';
export { createConfig, createConfigFromEnv, createTestConfig } from './core/config.js';
export type * from './core/types.js';

// ─── Layers (for advanced usage / customization) ────────────────────────────

export { StaticCagCache, KnowledgeLoader } from './layers/layer1-static-cag/index.js';
export { DynamicSnapshot, AdaptiveCompressor, SnapshotScheduler } from './layers/layer2-dynamic-cag/index.js';
export { SemanticCache, EmbeddingStore, cosineSimilarity, dotProduct, euclideanDistance, normalizeVector, findTopK } from './layers/layer3-semantic-cache/index.js';
export { ThinkEngine, ComplexTaskRegistry } from './layers/layer4-think-tool/index.js';
export { ACEEngine, KnowledgeStore, PrioritySystem } from './layers/layer5-curated-knowledge/index.js';

// ─── Analytics ──────────────────────────────────────────────────────────────

export { AnalyticsEngine } from './analytics/index.js';

// ─── Adapters ───────────────────────────────────────────────────────────────

export { AnthropicAdapter } from './adapters/anthropic-adapter.js';
export { SupabaseAdapter } from './adapters/supabase-adapter.js';
export { RedisAdapter } from './adapters/redis-adapter.js';

// ─── Utils ──────────────────────────────────────────────────────────────────

export { countTokens, estimateTokens, fitsInBudget, initTokenCounter } from './utils/token-counter.js';
export { splitText } from './utils/text-splitter.js';
export { Logger } from './utils/logger.js';
