/**
 * CAG-Esqueleto — Centralized configuration with Zod validation
 */

import { z } from 'zod';
import type { CAGConfig, LogLevel } from './types.js';

// ─── Schema ──────────────────────────────────────────────────────────────────

const layerConfigSchema = z.object({
  staticCag: z.object({
    ttl: z.number().positive().default(3600),
    usePromptCaching: z.boolean().default(true),
  }).default({}),
  dynamicCag: z.object({
    ttl: z.number().positive().default(1800),
    maxCompressedTokens: z.number().positive().default(2000),
    updateInterval: z.number().positive().default(300),
  }).default({}),
  semanticCache: z.object({
    similarityThreshold: z.number().min(0).max(1).default(0.85),
    maxEntries: z.number().positive().default(1000),
  }).default({}),
  thinkTool: z.object({
    enabled: z.boolean().default(true),
    budgetTokens: z.number().positive().default(10000),
  }).default({}),
  curatedKnowledge: z.object({
    autoPrioritize: z.boolean().default(true),
    maxEntries: z.number().positive().default(500),
  }).default({}),
});

const cagConfigSchema = z.object({
  anthropicApiKey: z.string().min(1, 'Anthropic API key is required'),
  model: z.string().default('claude-sonnet-4-20250514'),
  maxTokens: z.number().positive().default(8192),
  supabase: z
    .object({
      url: z.string().url(),
      serviceKey: z.string().min(1),
    })
    .optional(),
  redis: z
    .object({
      url: z.string().min(1),
    })
    .optional(),
  layers: layerConfigSchema.default({}),
  logLevel: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
});

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Creates a validated CAGConfig from partial input.
 * Applies defaults for all optional fields.
 */
export function createConfig(input: Record<string, unknown>): CAGConfig {
  return cagConfigSchema.parse(input) as CAGConfig;
}

/**
 * Creates a CAGConfig from environment variables.
 * Maps env vars to config structure.
 */
export function createConfigFromEnv(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): CAGConfig {
  const raw: Record<string, unknown> = {
    anthropicApiKey: env['ANTHROPIC_API_KEY'] ?? '',
    model: env['CAG_MODEL'],
    maxTokens: env['CAG_MAX_TOKENS'] ? Number(env['CAG_MAX_TOKENS']) : undefined,
    logLevel: env['CAG_LOG_LEVEL'] as LogLevel | undefined,
    layers: {
      staticCag: {
        ttl: env['CAG_STATIC_TTL'] ? Number(env['CAG_STATIC_TTL']) : undefined,
        usePromptCaching: true,
      },
      dynamicCag: {
        ttl: env['CAG_DYNAMIC_TTL'] ? Number(env['CAG_DYNAMIC_TTL']) : undefined,
      },
      semanticCache: {
        similarityThreshold: env['CAG_SEMANTIC_THRESHOLD']
          ? Number(env['CAG_SEMANTIC_THRESHOLD'])
          : undefined,
      },
      thinkTool: {},
      curatedKnowledge: {},
    },
  };

  if (env['SUPABASE_URL'] && env['SUPABASE_SERVICE_KEY']) {
    raw['supabase'] = {
      url: env['SUPABASE_URL'],
      serviceKey: env['SUPABASE_SERVICE_KEY'],
    };
  }

  if (env['REDIS_URL']) {
    raw['redis'] = { url: env['REDIS_URL'] };
  }

  return createConfig(raw);
}

/**
 * Returns a default config suitable for testing.
 */
export function createTestConfig(overrides: Partial<CAGConfig> = {}): CAGConfig {
  return createConfig({
    anthropicApiKey: 'sk-ant-test-key',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 1024,
    logLevel: 'silent',
    ...overrides,
  });
}

export { cagConfigSchema };
