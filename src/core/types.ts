/**
 * CAG-Esqueleto — Complete type system for the 5-Layer Context Engineering Module
 */

// ─── Configuration ───────────────────────────────────────────────────────────

export interface CAGConfig {
  anthropic: {
    apiKey: string;
    /** @default 'claude-sonnet-4-20250514' */
    model: string;
    /** @default 8192 */
    maxTokens: number;
    /** @default 0.3 */
    temperature: number;
    /** Pricing per 1M tokens (defaults to Sonnet pricing) */
    pricing: PricingConfig;
    /** Max API retries with exponential backoff @default 3 */
    maxRetries: number;
  };
  storage: {
    /** 'memory' for tests, 'supabase' or 'redis' for production */
    type: 'supabase' | 'redis' | 'memory';
    supabase?: { url: string; serviceKey: string };
    redis?: { url: string };
  };
  layers: LayerConfig;
  logging: LoggingConfig;
}

export interface PricingConfig {
  /** Price per 1M input tokens @default 3.00 (Sonnet) */
  inputTokens: number;
  /** Price per 1M cached input tokens @default 0.30 (90% discount) */
  cachedInputTokens: number;
  /** Price per 1M output tokens @default 15.00 (Sonnet) */
  outputTokens: number;
}

export interface LayerConfig {
  staticCAG: {
    enabled: boolean;
    /** TTL in seconds @default 3600 */
    ttl: number;
    /** Max tokens for static cache @default 50000 */
    maxTokens: number;
    /** Static knowledge sources */
    sources: StaticSource[];
  };
  dynamicCAG: {
    enabled: boolean;
    /** TTL in seconds @default 1800 */
    ttl: number;
    /** Max compressed tokens @default 15000 */
    maxTokens: number;
    /** Target compression ratio @default 0.45 */
    compressionRatio: number;
    /** Update interval in minutes @default 60 */
    updateInterval: number;
    /** Function that generates a fresh snapshot */
    snapshotFn?: () => Promise<string>;
  };
  semanticCache: {
    enabled: boolean;
    /** TTL in seconds @default 7200 */
    ttl: number;
    /** Cosine similarity threshold 0-1 @default 0.85 */
    similarityThreshold: number;
    /** Max cached entries @default 1000 */
    maxEntries: number;
    /** Embedding model @default 'voyage-3-large' */
    embeddingModel: string;
  };
  thinkTool: {
    enabled: boolean;
    /** Regex patterns that trigger extended thinking */
    triggerPatterns: string[];
    /** Max budget tokens for thinking @default 10000 */
    maxBudgetTokens: number;
  };
  curatedKnowledge: {
    enabled: boolean;
    /** Max knowledge entries @default 500 */
    maxEntries: number;
    /** Priority decay factor per cycle @default 0.95 */
    decayFactor: number;
    /** Minimum priority to include in context @default 0.1 */
    minPriority: number;
  };
}

export interface LoggingConfig {
  level: LogLevel;
  destination: 'console' | 'file' | 'custom';
  customFn?: (entry: LogEntry) => void;
}

// ─── Sources ─────────────────────────────────────────────────────────────────

export interface StaticSource {
  id: string;
  name: string;
  type: 'text' | 'file' | 'function';
  /** Content string (for type='text') */
  content?: string;
  /** File path (for type='file') */
  filePath?: string;
  /** Async loader (for type='function') */
  loadFn?: () => Promise<string>;
  /** Category: 'business_rules', 'formulas', 'parameters', etc. */
  category: string;
  /** Priority 1-10, higher = more important */
  priority: number;
}

// ─── Context ─────────────────────────────────────────────────────────────────

export type ContextLayerName = 'static' | 'dynamic' | 'semantic_cache' | 'think' | 'curated';

export interface ContextBlock {
  id: string;
  layer: ContextLayerName;
  content: string;
  tokenCount: number;
  cachedAt: Date;
  expiresAt: Date;
  metadata: Record<string, unknown>;
}

export interface AssembledContext {
  blocks: ContextBlock[];
  totalTokens: number;
  cachedTokens: number;
  freshTokens: number;
  costEstimate: {
    cachedInputCost: number;
    freshInputCost: number;
    totalEstimatedCost: number;
  };
  layerStats: LayerStat[];
}

export interface LayerStat {
  layer: string;
  tokens: number;
  hitRate?: number;
  latencyMs?: number;
}

// ─── Query & Response ────────────────────────────────────────────────────────

export interface CAGQuery {
  message: string;
  userId?: string;
  sessionId?: string;
  conversationHistory?: Message[];
  metadata?: Record<string, unknown>;
  /** Bypass all caches */
  forceRefresh?: boolean;
  /** Override layer config per-query */
  layerOverrides?: DeepPartial<LayerConfig>;
}

export interface CAGResponse {
  answer: string;
  context: AssembledContext;
  /** Present if Think Tool was used */
  thinkingProcess?: string;
  cacheHit: boolean;
  semanticCacheKey?: string;
  processingTime: {
    total: number;
    contextAssembly: number;
    llmCall: number;
    cacheCheck: number;
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    estimatedCost: number;
  };
}

// ─── Messages ────────────────────────────────────────────────────────────────

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: Date;
}

// ─── Semantic Cache ──────────────────────────────────────────────────────────

export interface SemanticCacheEntry {
  id: string;
  queryEmbedding: number[];
  queryText: string;
  responseText: string;
  hitCount: number;
  createdAt: Date;
  expiresAt: Date;
  metadata: Record<string, unknown>;
}

// ─── Curated Knowledge ───────────────────────────────────────────────────────

export type KnowledgeSource = 'user_taught' | 'auto_extracted' | 'feedback_loop';

export interface CuratedKnowledgeEntry {
  id: string;
  content: string;
  source: KnowledgeSource;
  category: string;
  /** Auto-adjusted priority 0.0 to 1.0 */
  priority: number;
  usageCount: number;
  lastUsedAt: Date;
  createdAt: Date;
  createdBy?: string;
  tags: string[];
}

// ─── Analytics ───────────────────────────────────────────────────────────────

export interface UsageAnalytics {
  queryId: string;
  timestamp: Date;
  layersUsed: string[];
  cacheHit: boolean;
  processingTimeMs: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  estimatedCostUSD: number;
  userId?: string;
}

// ─── Logging ─────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  layer?: string;
  message: string;
  data?: Record<string, unknown>;
}

// ─── Layer Interfaces ────────────────────────────────────────────────────────

export interface ILayer {
  readonly name: string;
  readonly order: number;
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
}

export interface IStaticCagLayer extends ILayer {
  loadSources(sources: StaticSource[]): Promise<void>;
  getSystemPrompt(): string;
  getContextBlocks(): ContextBlock[];
  /** Build Anthropic API formatted blocks with cache_control */
  buildCacheBlocks(): CacheBlock[];
  /** Reload all sources from config */
  refresh(): Promise<void>;
  /** Get layer-specific stats */
  getLayerStats(): StaticLayerStats;
  invalidate(): void;
}

export interface IDynamicCagLayer extends ILayer {
  /** Generate a new compressed snapshot from snapshotFn */
  generateSnapshot(): Promise<string>;
  /** Get context block (auto-refreshes if stale) */
  getContext(): Promise<ContextBlock>;
  /** Force immediate refresh */
  forceRefresh(): Promise<void>;
  /** Check if current snapshot is expired */
  isStale(): boolean;
  /** Get layer statistics */
  getStats(): DynamicLayerStats;
}

export interface ISemanticCacheLayer extends ILayer {
  get(query: string): Promise<SemanticCacheEntry | null>;
  set(query: string, response: string, metadata?: Record<string, unknown>): Promise<void>;
  invalidate(query: string): Promise<void>;
  clear(): Promise<void>;
  getStats(): CacheStats;
}

export interface IThinkToolLayer extends ILayer {
  shouldActivate(query: string, context: ContextBlock[]): boolean;
  getThinkingBudget(): number;
}

export interface ICuratedKnowledgeLayer extends ILayer {
  addEntry(entry: Omit<CuratedKnowledgeEntry, 'id' | 'usageCount' | 'lastUsedAt' | 'createdAt'>): Promise<CuratedKnowledgeEntry>;
  getRelevant(query: string, limit?: number): Promise<CuratedKnowledgeEntry[]>;
  decayPriorities(): Promise<void>;
  removeStale(): Promise<number>;
}

// ─── Engine Stats ───────────────────────────────────────────────────────────

export interface EngineStats {
  totalQueries: number;
  cacheHitRate: number;
  avgResponseTimeMs: number;
  tokenUsage: {
    totalInput: number;
    totalOutput: number;
    totalCached: number;
    totalCostUSD: number;
  };
  layerStats: {
    staticCag: { loaded: boolean; sourceCount: number; tokenCount: number };
    dynamicCag: { snapshotCount: number; lastUpdated: Date | null };
    semanticCache: CacheStats;
    thinkTool: { activationCount: number };
    curatedKnowledge: { entryCount: number };
  };
  uptimeMs: number;
}

// ─── Functions ──────────────────────────────────────────────────────────────

/** Async function that generates an embedding vector from text */
export type EmbeddingFunction = (text: string) => Promise<number[]>;

/** Async function that fetches fresh data for dynamic snapshots */
export type DataFetcher = () => Promise<string>;

// ─── Anthropic API Types ─────────────────────────────────────────────────────

/** A text block formatted for the Anthropic Messages API system prompt */
export interface CacheBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export interface StaticLayerStats {
  totalTokens: number;
  sourceCount: number;
  cacheBlockCount: number;
  categories: string[];
  lastLoadedAt: Date | null;
}

/** Standard category groups for Prompt Caching block organization */
export type CategoryGroup = 'rules_formulas' | 'parameters' | 'reference_data' | 'instructions';

// ─── Supporting Types ────────────────────────────────────────────────────────

export interface CacheStats {
  totalEntries: number;
  hitRate: number;
  avgSimilarity: number;
  tokensSaved: number;
}

export interface CompressedSnapshot {
  key: string;
  original: string;
  compressed: string;
  compressionRatio: number;
  tokenCount: number;
  createdAt: Date;
  expiresAt: Date;
}

/** Result from the AdaptiveCompressor pipeline */
export interface CompressedResult {
  compressed: string;
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
  segmentsKept: number;
  segmentsDropped: number;
}

/** Custom compression rule for domain-specific patterns */
export interface CompressionRule {
  name: string;
  /** Regex pattern to match */
  pattern: RegExp;
  /** Replacement string or function */
  replacement: string | ((match: string, ...groups: string[]) => string);
}

export interface DynamicLayerStats {
  hasSnapshot: boolean;
  isStale: boolean;
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
  lastUpdatedAt: Date | null;
  snapshotAge: number | null;
}

// ─── Events ──────────────────────────────────────────────────────────────────

export type CAGEvent =
  | { type: 'beforeQuery'; query: CAGQuery }
  | { type: 'afterQuery'; query: CAGQuery; response: CAGResponse }
  | { type: 'cacheHit'; query: string; similarity: number }
  | { type: 'cacheMiss'; query: string }
  | { type: 'contextAssembled'; context: AssembledContext; layersUsed: string[] }
  | { type: 'thinkingActivated'; query: string; budgetTokens: number }
  | { type: 'layerError'; layer: string; error: Error }
  | { type: 'snapshotUpdated'; key: string }
  | { type: 'knowledgeAdded'; id: string; category: string };

export type CAGEventType = CAGEvent['type'];

export type CAGEventHandler = (event: CAGEvent) => void;

// ─── Utility Types ───────────────────────────────────────────────────────────

/** Recursively makes all properties optional */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? DeepPartial<U>[]
    : T[P] extends object
      ? DeepPartial<T[P]>
      : T[P];
};
