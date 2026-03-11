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
  invalidate(): void;
}

export interface IDynamicCagLayer extends ILayer {
  createSnapshot(content: string, key?: string): Promise<ContextBlock>;
  getLatestSnapshot(key?: string): Promise<ContextBlock | null>;
  scheduleUpdates(): void;
  cancelUpdates(): void;
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

// ─── Events ──────────────────────────────────────────────────────────────────

export type CAGEvent =
  | { type: 'cache_hit'; query: string; similarity: number }
  | { type: 'cache_miss'; query: string }
  | { type: 'snapshot_updated'; key: string }
  | { type: 'knowledge_added'; id: string; category: string }
  | { type: 'thinking_activated'; query: string; budgetTokens: number }
  | { type: 'layer_error'; layer: string; error: Error }
  | { type: 'query_complete'; queryId: string; analytics: UsageAnalytics };

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
