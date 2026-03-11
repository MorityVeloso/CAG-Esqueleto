/**
 * CAG-Esqueleto — Main engine orchestrating the 5-layer architecture
 *
 * Pipeline (query):
 *  1. CHECK SEMANTIC CACHE (L3) — fast path if similar query exists
 *  2. ASSEMBLE CONTEXT — Static (L1) + Dynamic (L2) + Curated (L5)
 *  3. DETECT COMPLEXITY (L4) — activate Think Tool if needed
 *  4. CALL CLAUDE API — with prompt caching + optional thinking
 *  5. POST-PROCESS — cache response, update analytics & priorities
 *
 * Fallback strategy:
 *  - L3 fails → skip, go to assembly
 *  - L2 fails → use last valid snapshot
 *  - L5 fails → context without curated knowledge
 *  - API fails → retry with exponential backoff (configurable)
 */

import type {
  CAGConfig,
  CAGQuery,
  CAGResponse,
  CAGEvent,
  CAGEventType,
  CAGEventHandler,
  EmbeddingFunction,
  EngineStats,
  CacheStats,
  AssembledContext,
  ContextBlock,
  CuratedKnowledgeEntry,
  PricingConfig,
} from './types.js';
import { StaticCagCache } from '../layers/layer1-static-cag/static-cache.js';
import { DynamicSnapshot } from '../layers/layer2-dynamic-cag/dynamic-snapshot.js';
import { SemanticCache } from '../layers/layer3-semantic-cache/semantic-cache.js';
import { ThinkEngine } from '../layers/layer4-think-tool/think-engine.js';
import { ACEEngine } from '../layers/layer5-curated-knowledge/ace-engine.js';
import { AnthropicAdapter } from '../adapters/anthropic-adapter.js';
import { countTokens, initTokenCounter } from '../utils/token-counter.js';
import { Logger } from '../utils/logger.js';

export class CAGEngine {
  private readonly config: CAGConfig;
  private readonly logger: Logger;

  // Layers — created internally
  private readonly staticCag: StaticCagCache;
  private readonly dynamicCag: DynamicSnapshot;
  private readonly semanticCache: SemanticCache;
  private readonly thinkTool: ThinkEngine;
  private readonly curatedKnowledge: ACEEngine;

  // Adapter
  private adapter: AnthropicAdapter | null = null;

  // Event system
  private readonly eventHandlers: Map<CAGEventType, CAGEventHandler[]> = new Map();
  private readonly globalHandlers: CAGEventHandler[] = [];

  // Analytics
  private totalQueries = 0;
  private totalCacheHits = 0;
  private totalResponseTimeMs = 0;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCachedTokens = 0;
  private totalCostUSD = 0;
  private thinkActivationCount = 0;
  private startedAt: Date | null = null;

  private initialized = false;

  constructor(config: CAGConfig) {
    this.config = config;
    this.logger = new Logger(config.logging.level, 'CAGEngine');

    // Create all layers internally
    this.staticCag = new StaticCagCache(config);
    this.dynamicCag = new DynamicSnapshot(config);
    this.semanticCache = new SemanticCache(config);
    this.thinkTool = new ThinkEngine(config);
    this.curatedKnowledge = new ACEEngine(config);
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  /**
   * Initialize all layers, token counter, and adapter.
   * Must be called before query().
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing CAG engine');

    // Init tiktoken for accurate token counts
    await initTokenCounter();

    // Create API adapter
    this.adapter = new AnthropicAdapter(this.config);

    // Initialize layers (order matters)
    await this.staticCag.initialize();
    await this.dynamicCag.initialize();

    // SemanticCache requires embedding function — skip init if not set
    if (this.semanticCache['embedFn']) {
      await this.semanticCache.initialize();
    } else {
      this.logger.warn('SemanticCache: no embedding function set — cache disabled');
    }

    await this.thinkTool.initialize();
    await this.curatedKnowledge.initialize();

    // Dynamic update scheduling is handled externally via SnapshotScheduler
    // or by calling engine.refreshDynamicContext() from a cron job

    this.initialized = true;
    this.startedAt = new Date();
    this.logger.info('CAG engine initialized');
  }

  /**
   * Gracefully shutdown all layers and cleanup.
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down CAG engine');

    await this.curatedKnowledge.shutdown();
    await this.thinkTool.shutdown();
    await this.semanticCache.shutdown();
    await this.dynamicCag.shutdown();
    await this.staticCag.shutdown();

    this.adapter = null;
    this.initialized = false;
    this.logger.info('CAG engine shut down');
  }

  // ─── Embedding Injection ────────────────────────────────────────────────

  /**
   * Set the embedding function used by the Semantic Cache (L3).
   * Must be called before initialize() for cache to work.
   */
  setEmbeddingFunction(fn: EmbeddingFunction): void {
    this.semanticCache.setEmbeddingFunction(fn);
  }

  // ─── Main Query Pipeline ───────────────────────────────────────────────

  /**
   * Execute the 5-layer CAG pipeline.
   *
   * Flow: Cache Check → Context Assembly → Complexity Detection → API Call → Post-Process
   */
  async query(input: string | CAGQuery): Promise<CAGResponse> {
    if (!this.initialized) {
      throw new Error('CAGEngine not initialized. Call initialize() first.');
    }

    const cagQuery: CAGQuery = typeof input === 'string'
      ? { message: input }
      : input;

    this.emit({ type: 'beforeQuery', query: cagQuery });

    const startTime = Date.now();
    const layersUsed: string[] = [];
    let cacheCheckMs = 0;
    let contextAssemblyMs = 0;

    // ── Step A: CHECK SEMANTIC CACHE (L3) ──────────────────────────────
    if (this.config.layers.semanticCache.enabled && !cagQuery.forceRefresh) {
      try {
        const cacheStart = Date.now();
        const cached = await this.semanticCache.get(cagQuery.message);
        cacheCheckMs = Date.now() - cacheStart;

        if (cached) {
          this.emit({ type: 'cacheHit', query: cagQuery.message, similarity: 1 });
          layersUsed.push('semantic_cache');
          this.totalQueries++;
          this.totalCacheHits++;
          this.totalResponseTimeMs += Date.now() - startTime;

          const response: CAGResponse = {
            answer: cached.responseText,
            context: this.emptyContext(),
            cacheHit: true,
            semanticCacheKey: cached.id,
            processingTime: { total: Date.now() - startTime, contextAssembly: 0, llmCall: 0, cacheCheck: cacheCheckMs },
            usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, estimatedCost: 0 },
          };

          this.emit({ type: 'afterQuery', query: cagQuery, response });
          return response;
        }

        this.emit({ type: 'cacheMiss', query: cagQuery.message });
      } catch (error) {
        // Fallback: L3 fails → skip cache, proceed to assembly
        this.logger.warn('Semantic cache check failed, skipping', { error: String(error) });
        this.emit({ type: 'layerError', layer: 'semantic_cache', error: error instanceof Error ? error : new Error(String(error)) });
      }
    }

    // ── Step B: ASSEMBLE CONTEXT (L1, L2, L5) ─────────────────────────
    const assemblyStart = Date.now();
    const contextBlocks: ContextBlock[] = [];

    // L1 — Static CAG
    if (this.config.layers.staticCAG.enabled) {
      const blocks = this.staticCag.getContextBlocks();
      contextBlocks.push(...blocks);
      if (blocks.length > 0) layersUsed.push('static');
    }

    // L2 — Dynamic CAG (with fallback — getContext handles auto-refresh + fallback internally)
    if (this.config.layers.dynamicCAG.enabled) {
      try {
        const snapshot = await this.dynamicCag.getContext();
        if (snapshot.content) {
          contextBlocks.push(snapshot);
          layersUsed.push('dynamic');
        }
      } catch (error) {
        this.logger.warn('Dynamic snapshot failed, continuing without', { error: String(error) });
        this.emit({ type: 'layerError', layer: 'dynamic', error: error instanceof Error ? error : new Error(String(error)) });
      }
    }

    // L5 — Curated Knowledge (with fallback)
    if (this.config.layers.curatedKnowledge.enabled) {
      try {
        const relevant = await this.curatedKnowledge.getRelevant(cagQuery.message, 5);
        if (relevant.length > 0) {
          const curatedContent = relevant.map((k) => k.content).join('\n\n');
          const block: ContextBlock = {
            id: 'curated-knowledge',
            layer: 'curated',
            content: curatedContent,
            tokenCount: countTokens(curatedContent),
            cachedAt: new Date(),
            expiresAt: new Date(Date.now() + 3600_000),
            metadata: { entryCount: relevant.length },
          };
          contextBlocks.push(block);
          layersUsed.push('curated');
        }
      } catch (error) {
        // Fallback: L5 fails → context without curated knowledge
        this.logger.warn('Curated knowledge failed, continuing without', { error: String(error) });
        this.emit({ type: 'layerError', layer: 'curated', error: error instanceof Error ? error : new Error(String(error)) });
      }
    }

    contextAssemblyMs = Date.now() - assemblyStart;
    const assembledContext = this.assembleContext(contextBlocks);
    this.emit({ type: 'contextAssembled', context: assembledContext, layersUsed });

    // ── Step C: DETECT COMPLEXITY (L4) ─────────────────────────────────
    let useThinking = false;
    let thinkingBudget = 0;
    if (this.config.layers.thinkTool.enabled) {
      useThinking = this.thinkTool.shouldActivate(cagQuery.message, contextBlocks);
      if (useThinking) {
        thinkingBudget = this.thinkTool.getThinkingBudget();
        this.thinkActivationCount++;
        this.emit({ type: 'thinkingActivated', query: cagQuery.message, budgetTokens: thinkingBudget });
        layersUsed.push('think');
      }
    }

    // ── Step D: CALL CLAUDE API (with retry) ───────────────────────────
    const systemPrompt = this.buildSystemPrompt(contextBlocks);
    const messages = cagQuery.conversationHistory ?? [];
    const userMessage = { role: 'user' as const, content: cagQuery.message };

    const llmStart = Date.now();
    const apiResult = await this.callWithRetry({
      systemPrompt,
      messages: [...messages, userMessage],
      useThinking,
      thinkingBudget,
    });
    const llmMs = Date.now() - llmStart;

    // ── Step E: POST-PROCESS ───────────────────────────────────────────

    // Save to semantic cache
    if (this.config.layers.semanticCache.enabled && apiResult.content) {
      try {
        await this.semanticCache.set(cagQuery.message, apiResult.content);
      } catch (error) {
        this.logger.warn('Failed to cache response', { error: String(error) });
      }
    }

    // Update analytics
    this.totalQueries++;
    this.totalResponseTimeMs += Date.now() - startTime;
    this.totalInputTokens += apiResult.usage.inputTokens;
    this.totalOutputTokens += apiResult.usage.outputTokens;
    this.totalCachedTokens += apiResult.usage.cachedInputTokens;
    this.totalCostUSD += apiResult.usage.estimatedCost;

    // Decay curated knowledge priorities periodically
    if (this.config.layers.curatedKnowledge.enabled && this.totalQueries % 100 === 0) {
      try {
        await this.curatedKnowledge.decayPriorities();
      } catch {
        // Non-critical — swallow
      }
    }

    const response: CAGResponse = {
      answer: apiResult.content,
      thinkingProcess: apiResult.thinkingProcess,
      context: assembledContext,
      cacheHit: false,
      processingTime: {
        total: Date.now() - startTime,
        contextAssembly: contextAssemblyMs,
        llmCall: llmMs,
        cacheCheck: cacheCheckMs,
      },
      usage: apiResult.usage,
    };

    this.emit({ type: 'afterQuery', query: cagQuery, response });
    return response;
  }

  // ─── Convenience Methods ────────────────────────────────────────────────

  /**
   * Teach the engine new knowledge (delegates to Layer 5 — ACE).
   */
  async teach(content: string, category: string, tags: string[] = []): Promise<CuratedKnowledgeEntry> {
    if (!this.initialized) throw new Error('CAGEngine not initialized.');

    const entry = await this.curatedKnowledge.addEntry({
      content,
      source: 'user_taught',
      category,
      priority: 0.7,
      tags,
    });

    this.emit({ type: 'knowledgeAdded', id: entry.id, category });
    this.logger.info('Knowledge taught', { id: entry.id, category });
    return entry;
  }

  /**
   * Get aggregated engine statistics.
   */
  async getStats(): Promise<EngineStats> {
    const cacheStats: CacheStats = this.semanticCache.getStats();

    return {
      totalQueries: this.totalQueries,
      cacheHitRate: this.totalQueries > 0 ? this.totalCacheHits / this.totalQueries : 0,
      avgResponseTimeMs: this.totalQueries > 0 ? this.totalResponseTimeMs / this.totalQueries : 0,
      tokenUsage: {
        totalInput: this.totalInputTokens,
        totalOutput: this.totalOutputTokens,
        totalCached: this.totalCachedTokens,
        totalCostUSD: this.totalCostUSD,
      },
      layerStats: {
        staticCag: {
          loaded: this.staticCag.getSystemPrompt().length > 0,
          sourceCount: this.staticCag.getContextBlocks().length > 0 ? (this.staticCag.getContextBlocks()[0]?.metadata['sourceCount'] as number ?? 0) : 0,
          tokenCount: this.staticCag.getEstimatedTokens(),
        },
        dynamicCag: {
          snapshotCount: this.dynamicCag.getStats().hasSnapshot ? 1 : 0,
          lastUpdated: this.dynamicCag.getStats().lastUpdatedAt,
        },
        semanticCache: cacheStats,
        thinkTool: { activationCount: this.thinkActivationCount },
        curatedKnowledge: { entryCount: this.curatedKnowledge.getStore().size() },
      },
      uptimeMs: this.startedAt ? Date.now() - this.startedAt.getTime() : 0,
    };
  }

  /**
   * Force refresh of the dynamic snapshot (Layer 2).
   */
  async refreshDynamicContext(): Promise<void> {
    if (!this.initialized) throw new Error('CAGEngine not initialized.');

    if (!this.config.layers.dynamicCAG.snapshotFn) {
      this.logger.warn('No snapshotFn configured — cannot refresh dynamic context');
      return;
    }

    await this.dynamicCag.forceRefresh();
    this.emit({ type: 'snapshotUpdated', key: 'default' });
    this.logger.info('Dynamic context refreshed');
  }

  /**
   * Clear the semantic cache (Layer 3).
   */
  async clearSemanticCache(): Promise<void> {
    await this.semanticCache.clear();
    this.logger.info('Semantic cache cleared');
  }

  // ─── Event System ───────────────────────────────────────────────────────

  /**
   * Register an event handler.
   * - on('cacheHit', handler) — typed event
   * - on(handler) — global handler for all events
   */
  on(eventOrHandler: CAGEventType | CAGEventHandler, handler?: CAGEventHandler): void {
    if (typeof eventOrHandler === 'function') {
      // Global handler
      this.globalHandlers.push(eventOrHandler);
    } else if (handler) {
      // Typed event handler
      const handlers = this.eventHandlers.get(eventOrHandler) ?? [];
      handlers.push(handler);
      this.eventHandlers.set(eventOrHandler, handlers);
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private emit(event: CAGEvent): void {
    // Typed handlers
    const handlers = this.eventHandlers.get(event.type) ?? [];
    for (const handler of handlers) {
      try { handler(event); } catch { /* swallow */ }
    }

    // Global handlers
    for (const handler of this.globalHandlers) {
      try { handler(event); } catch { /* swallow */ }
    }
  }

  /**
   * Build system prompt from context blocks.
   * Static blocks go first (for prompt caching benefit).
   */
  private buildSystemPrompt(blocks: ContextBlock[]): string {
    if (blocks.length === 0) return '';

    // Static blocks first (prompt caching works on prefix)
    const sorted = [...blocks].sort((a, b) => {
      const order: Record<string, number> = { static: 0, dynamic: 1, curated: 2 };
      return (order[a.layer] ?? 3) - (order[b.layer] ?? 3);
    });

    return sorted.map((b) => b.content).join('\n\n');
  }

  /**
   * Call the Anthropic API with exponential backoff retry.
   */
  private async callWithRetry(params: {
    systemPrompt: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    useThinking: boolean;
    thinkingBudget: number;
  }): Promise<{ content: string; thinkingProcess?: string; usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number; estimatedCost: number } }> {
    if (!this.adapter) {
      throw new Error('AnthropicAdapter not initialized.');
    }

    const maxRetries = this.config.anthropic.maxRetries;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.adapter.createMessage(params);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(`API call failed (attempt ${attempt + 1}/${maxRetries + 1})`, {
          error: lastError.message,
        });

        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s, ...
          const delayMs = Math.pow(2, attempt) * 1000;
          await this.sleep(delayMs);
        }
      }
    }

    throw lastError ?? new Error('API call failed after retries');
  }

  private assembleContext(blocks: ContextBlock[]): AssembledContext {
    const totalTokens = blocks.reduce((sum, b) => sum + b.tokenCount, 0);
    const pricing = this.config.anthropic.pricing;

    // Static blocks are likely to be cached by Anthropic
    const staticTokens = blocks
      .filter((b) => b.layer === 'static')
      .reduce((sum, b) => sum + b.tokenCount, 0);
    const freshTokens = totalTokens - staticTokens;

    const cachedInputCost = (staticTokens / 1_000_000) * pricing.cachedInputTokens;
    const freshInputCost = (freshTokens / 1_000_000) * pricing.inputTokens;

    return {
      blocks,
      totalTokens,
      cachedTokens: staticTokens,
      freshTokens,
      costEstimate: {
        cachedInputCost,
        freshInputCost,
        totalEstimatedCost: cachedInputCost + freshInputCost,
      },
      layerStats: blocks.map((b) => ({ layer: b.layer, tokens: b.tokenCount })),
    };
  }

  private emptyContext(): AssembledContext {
    return {
      blocks: [],
      totalTokens: 0,
      cachedTokens: 0,
      freshTokens: 0,
      costEstimate: { cachedInputCost: 0, freshInputCost: 0, totalEstimatedCost: 0 },
      layerStats: [],
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
