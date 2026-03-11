/**
 * CAG-Esqueleto — Shared TypeScript types for the 5-Layer Context Engineering Module
 */

// ─── Configuration ───────────────────────────────────────────────────────────

export interface CAGConfig {
  /** Anthropic API key */
  anthropicApiKey: string;
  /** Claude model to use */
  model: string;
  /** Maximum tokens for generation */
  maxTokens: number;

  /** Supabase configuration (optional — for persistent storage) */
  supabase?: {
    url: string;
    serviceKey: string;
  };

  /** Redis configuration (optional — for caching) */
  redis?: {
    url: string;
  };

  /** Layer-specific settings */
  layers: LayerConfig;

  /** Logging level */
  logLevel: LogLevel;
}

export interface LayerConfig {
  staticCag: {
    /** TTL for static cache in seconds */
    ttl: number;
    /** Whether to use Anthropic Prompt Caching */
    usePromptCaching: boolean;
  };
  dynamicCag: {
    /** TTL for dynamic snapshots in seconds */
    ttl: number;
    /** Maximum compressed size in tokens */
    maxCompressedTokens: number;
    /** Update interval in seconds */
    updateInterval: number;
  };
  semanticCache: {
    /** Cosine similarity threshold (0-1) for cache hits */
    similarityThreshold: number;
    /** Maximum number of cached entries */
    maxEntries: number;
  };
  thinkTool: {
    /** Whether to enable extended thinking */
    enabled: boolean;
    /** Budget tokens for thinking */
    budgetTokens: number;
  };
  curatedKnowledge: {
    /** Whether to enable auto-prioritization */
    autoPrioritize: boolean;
    /** Maximum knowledge entries */
    maxEntries: number;
  };
}

// ─── Layer Interfaces ────────────────────────────────────────────────────────

export interface ILayer {
  readonly name: string;
  readonly order: number;
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
}

export interface IStaticCagLayer extends ILayer {
  loadKnowledge(sources: KnowledgeSource[]): Promise<void>;
  getSystemPrompt(): string;
  getCacheBreakpoints(): CacheBreakpoint[];
  invalidate(): void;
}

export interface IDynamicCagLayer extends ILayer {
  createSnapshot(data: DynamicData): Promise<CompressedSnapshot>;
  getLatestSnapshot(key: string): Promise<CompressedSnapshot | null>;
  scheduleUpdate(key: string, fetcher: DataFetcher, intervalMs: number): void;
  cancelUpdate(key: string): void;
}

export interface ISemanticCacheLayer extends ILayer {
  get(query: string): Promise<CacheEntry | null>;
  set(query: string, response: string, metadata?: Record<string, unknown>): Promise<void>;
  invalidate(query: string): Promise<void>;
  clear(): Promise<void>;
  getStats(): CacheStats;
}

export interface IThinkToolLayer extends ILayer {
  shouldUseThinking(query: string, context: QueryContext): boolean;
  wrapWithThinking(messages: Message[]): Message[];
}

export interface ICuratedKnowledgeLayer extends ILayer {
  addKnowledge(entry: KnowledgeEntry): Promise<void>;
  getRelevantKnowledge(query: string, limit?: number): Promise<KnowledgeEntry[]>;
  prioritize(): Promise<void>;
  removeStale(): Promise<number>;
}

// ─── Domain Types ────────────────────────────────────────────────────────────

export interface KnowledgeSource {
  id: string;
  type: 'text' | 'markdown' | 'json' | 'url';
  content: string;
  metadata?: Record<string, unknown>;
}

export interface CacheBreakpoint {
  type: 'ephemeral';
  position: number;
}

export interface DynamicData {
  key: string;
  content: string;
  source: string;
  fetchedAt: Date;
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

export type DataFetcher = () => Promise<string>;

export interface CacheEntry {
  query: string;
  response: string;
  embedding: number[];
  similarity: number;
  hitCount: number;
  createdAt: Date;
  lastAccessedAt: Date;
  metadata?: Record<string, unknown>;
}

export interface CacheStats {
  totalEntries: number;
  hitRate: number;
  avgSimilarity: number;
  tokensSaved: number;
}

export interface KnowledgeEntry {
  id: string;
  content: string;
  category: string;
  priority: number;
  embedding?: number[];
  usageCount: number;
  lastUsedAt: Date;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

export interface QueryContext {
  query: string;
  conversationHistory: Message[];
  activeKnowledge: string[];
  complexity: QueryComplexity;
}

export type QueryComplexity = 'simple' | 'moderate' | 'complex' | 'multi_step';

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | MessageContent[];
}

export interface MessageContent {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking';
  text?: string;
  [key: string]: unknown;
}

// ─── Engine Types ────────────────────────────────────────────────────────────

export interface CAGResponse {
  content: string;
  layersUsed: string[];
  tokenUsage: TokenUsage;
  cacheHit: boolean;
  thinkingUsed: boolean;
  latencyMs: number;
  metadata: Record<string, unknown>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  thinkingTokens: number;
  totalCost: number;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

// ─── Events ──────────────────────────────────────────────────────────────────

export type CAGEvent =
  | { type: 'cache_hit'; query: string; similarity: number }
  | { type: 'cache_miss'; query: string }
  | { type: 'snapshot_updated'; key: string }
  | { type: 'knowledge_added'; id: string; category: string }
  | { type: 'thinking_activated'; query: string }
  | { type: 'layer_error'; layer: string; error: Error };

export type CAGEventHandler = (event: CAGEvent) => void;
