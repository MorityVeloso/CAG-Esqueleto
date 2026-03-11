/**
 * CAG-Esqueleto — Configuration system with Zod validation + DeepPartial merge
 *
 * Design:
 *  - Every field has a sensible default except `anthropic.apiKey`
 *  - createConfig({ anthropic: { apiKey: 'sk-...' } }) is sufficient
 *  - Deep merge: partial nested objects are merged with defaults, not replaced
 *  - Zod validates after merge, giving clear error messages
 */

import { z } from 'zod';
import type { CAGConfig, DeepPartial, LogEntry } from './types.js';

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const staticSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['text', 'file', 'function']),
  content: z.string().optional(),
  filePath: z.string().optional(),
  loadFn: z.function().optional(),
  category: z.string().default('general'),
  priority: z.number().min(1).max(10).default(5),
});

const layerConfigSchema = z.object({
  staticCAG: z.object({
    enabled: z.boolean().default(true),
    ttl: z.number().positive().default(3600),
    maxTokens: z.number().positive().default(50000),
    sources: z.array(staticSourceSchema).default([]),
  }).default({}),
  dynamicCAG: z.object({
    enabled: z.boolean().default(true),
    ttl: z.number().positive().default(1800),
    maxTokens: z.number().positive().default(15000),
    compressionRatio: z.number().min(0).max(1).default(0.45),
    updateInterval: z.number().positive().default(60),
    snapshotFn: z.function().optional(),
  }).default({}),
  semanticCache: z.object({
    enabled: z.boolean().default(true),
    ttl: z.number().positive().default(7200),
    similarityThreshold: z.number().min(0).max(1).default(0.85),
    maxEntries: z.number().positive().default(1000),
    embeddingModel: z.string().default('voyage-3-large'),
  }).default({}),
  thinkTool: z.object({
    enabled: z.boolean().default(true),
    triggerPatterns: z.array(z.string()).default([
      'calculate', 'step.by.step', 'analyze', 'compare',
      'trade.?off', 'pros.and.cons', 'plan.*implement',
    ]),
    maxBudgetTokens: z.number().positive().default(10000),
  }).default({}),
  curatedKnowledge: z.object({
    enabled: z.boolean().default(true),
    maxEntries: z.number().positive().default(500),
    decayFactor: z.number().min(0).max(1).default(0.95),
    minPriority: z.number().min(0).max(1).default(0.1),
  }).default({}),
});

const loggingConfigSchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  destination: z.enum(['console', 'file', 'custom']).default('console'),
  customFn: z.function().args(z.unknown()).optional(),
});

const cagConfigSchema = z.object({
  anthropic: z.object({
    apiKey: z.string().min(1, 'anthropic.apiKey is required'),
    model: z.string().default('claude-sonnet-4-20250514'),
    maxTokens: z.number().positive().default(8192),
    temperature: z.number().min(0).max(1).default(0.3),
  }),
  storage: z.object({
    type: z.enum(['supabase', 'redis', 'memory']).default('memory'),
    supabase: z.object({
      url: z.string().url(),
      serviceKey: z.string().min(1),
    }).optional(),
    redis: z.object({
      url: z.string().min(1),
    }).optional(),
  }).default({}),
  layers: layerConfigSchema.default({}),
  logging: loggingConfigSchema.default({}),
});

// ─── Deep Merge ──────────────────────────────────────────────────────────────

/**
 * Deep merges source into target. Arrays and functions are replaced, not merged.
 * Only plain objects are recursively merged.
 */
function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
): T {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = (result as Record<string, unknown>)[key];

    if (
      sourceVal !== undefined &&
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      typeof sourceVal !== 'function' &&
      typeof targetVal === 'object' &&
      targetVal !== null &&
      !Array.isArray(targetVal) &&
      typeof targetVal !== 'function'
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else if (sourceVal !== undefined) {
      (result as Record<string, unknown>)[key] = sourceVal;
    }
  }

  return result;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

/**
 * Complete defaults for CAGConfig.
 * Only anthropic.apiKey has no default — it must be provided.
 */
const DEFAULTS: Omit<CAGConfig, 'anthropic'> & { anthropic: Omit<CAGConfig['anthropic'], 'apiKey'> } = {
  anthropic: {
    model: 'claude-sonnet-4-20250514',
    maxTokens: 8192,
    temperature: 0.3,
  },
  storage: {
    type: 'memory',
  },
  layers: {
    staticCAG: {
      enabled: true,
      ttl: 3600,
      maxTokens: 50000,
      sources: [],
    },
    dynamicCAG: {
      enabled: true,
      ttl: 1800,
      maxTokens: 15000,
      compressionRatio: 0.45,
      updateInterval: 60,
    },
    semanticCache: {
      enabled: true,
      ttl: 7200,
      similarityThreshold: 0.85,
      maxEntries: 1000,
      embeddingModel: 'voyage-3-large',
    },
    thinkTool: {
      enabled: true,
      triggerPatterns: [
        'calculate', 'step.by.step', 'analyze', 'compare',
        'trade.?off', 'pros.and.cons', 'plan.*implement',
      ],
      maxBudgetTokens: 10000,
    },
    curatedKnowledge: {
      enabled: true,
      maxEntries: 500,
      decayFactor: 0.95,
      minPriority: 0.1,
    },
  },
  logging: {
    level: 'info',
    destination: 'console',
  },
};

// ─── Factory Functions ───────────────────────────────────────────────────────

/**
 * Creates a fully validated CAGConfig from a partial input.
 *
 * Deep merges the input with defaults, then validates with Zod.
 * Only `anthropic.apiKey` is required — everything else has defaults.
 *
 * @example
 * ```ts
 * const config = createConfig({
 *   anthropic: { apiKey: 'sk-ant-...' }
 * });
 * ```
 */
export function createConfig(input: DeepPartial<CAGConfig> & { anthropic: { apiKey: string } }): CAGConfig {
  const merged = deepMerge(DEFAULTS as Record<string, unknown>, input as Record<string, unknown>);
  return cagConfigSchema.parse(merged) as CAGConfig;
}

/**
 * Creates a CAGConfig from environment variables.
 *
 * Env var mapping:
 *  - ANTHROPIC_API_KEY → anthropic.apiKey
 *  - CAG_MODEL → anthropic.model
 *  - CAG_MAX_TOKENS → anthropic.maxTokens
 *  - CAG_TEMPERATURE → anthropic.temperature
 *  - SUPABASE_URL + SUPABASE_SERVICE_KEY → storage.supabase
 *  - REDIS_URL → storage.redis
 *  - CAG_STATIC_TTL → layers.staticCAG.ttl
 *  - CAG_DYNAMIC_TTL → layers.dynamicCAG.ttl
 *  - CAG_SEMANTIC_THRESHOLD → layers.semanticCache.similarityThreshold
 *  - CAG_LOG_LEVEL → logging.level
 */
export function createConfigFromEnv(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): CAGConfig {
  const partial: Record<string, unknown> = {
    anthropic: {
      apiKey: env['ANTHROPIC_API_KEY'] ?? '',
      ...(env['CAG_MODEL'] ? { model: env['CAG_MODEL'] } : {}),
      ...(env['CAG_MAX_TOKENS'] ? { maxTokens: Number(env['CAG_MAX_TOKENS']) } : {}),
      ...(env['CAG_TEMPERATURE'] ? { temperature: Number(env['CAG_TEMPERATURE']) } : {}),
    },
    logging: {
      ...(env['CAG_LOG_LEVEL'] ? { level: env['CAG_LOG_LEVEL'] } : {}),
    },
    layers: {
      staticCAG: {
        ...(env['CAG_STATIC_TTL'] ? { ttl: Number(env['CAG_STATIC_TTL']) } : {}),
      },
      dynamicCAG: {
        ...(env['CAG_DYNAMIC_TTL'] ? { ttl: Number(env['CAG_DYNAMIC_TTL']) } : {}),
      },
      semanticCache: {
        ...(env['CAG_SEMANTIC_THRESHOLD'] ? { similarityThreshold: Number(env['CAG_SEMANTIC_THRESHOLD']) } : {}),
      },
    },
  };

  // Determine storage type from available env vars
  if (env['SUPABASE_URL'] && env['SUPABASE_SERVICE_KEY']) {
    partial['storage'] = {
      type: 'supabase',
      supabase: {
        url: env['SUPABASE_URL'],
        serviceKey: env['SUPABASE_SERVICE_KEY'],
      },
    };
  } else if (env['REDIS_URL']) {
    partial['storage'] = {
      type: 'redis',
      redis: { url: env['REDIS_URL'] },
    };
  }

  return createConfig(partial as DeepPartial<CAGConfig> & { anthropic: { apiKey: string } });
}

/**
 * Creates a config suitable for testing.
 * Uses 'memory' storage and 'silent' logging by default.
 */
export function createTestConfig(
  overrides: DeepPartial<CAGConfig> = {},
): CAGConfig {
  const testDefaults: DeepPartial<CAGConfig> & { anthropic: { apiKey: string } } = {
    anthropic: { apiKey: 'sk-ant-test-key' },
    storage: { type: 'memory' },
    logging: { level: 'error' },
  };

  const merged = deepMerge(testDefaults as Record<string, unknown>, overrides as Record<string, unknown>);
  return createConfig(merged as DeepPartial<CAGConfig> & { anthropic: { apiKey: string } });
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export { cagConfigSchema, deepMerge, DEFAULTS };
