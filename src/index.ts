/**
 * CAG-Esqueleto — 5-Layer Context Engineering Module
 *
 * @packageDocumentation
 */

// Core
export { CAGEngine } from './core/cag-engine.js';
export { createConfig, createConfigFromEnv, createTestConfig } from './core/config.js';
export type * from './core/types.js';

// Layers
export { StaticCagCache, KnowledgeLoader } from './layers/layer1-static-cag/index.js';
export { DynamicSnapshot, AdaptiveCompressor, SnapshotScheduler } from './layers/layer2-dynamic-cag/index.js';
export { SemanticCache, EmbeddingStore, cosineSimilarity, dotProduct, euclideanDistance, normalizeVector, findTopK } from './layers/layer3-semantic-cache/index.js';
export { ThinkEngine, ComplexTaskRegistry } from './layers/layer4-think-tool/index.js';
export { ACEEngine, KnowledgeStore, PrioritySystem } from './layers/layer5-curated-knowledge/index.js';

// Analytics
export { AnalyticsEngine } from './analytics/index.js';

// Adapters
export { AnthropicAdapter } from './adapters/anthropic-adapter.js';
export { SupabaseAdapter } from './adapters/supabase-adapter.js';
export { RedisAdapter } from './adapters/redis-adapter.js';

// Utils
export { countTokens, estimateTokens, fitsInBudget, initTokenCounter } from './utils/token-counter.js';
export { splitText } from './utils/text-splitter.js';
export { Logger } from './utils/logger.js';
