/**
 * CAG-Esqueleto — Supabase Integration Example
 *
 * Full setup with persistent semantic cache and knowledge store.
 * Requires: Supabase project with pgvector extension.
 *
 * Setup:
 *  1. Run sql/*.sql migrations on your Supabase project
 *  2. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env
 */

import {
  CAGEngine,
  createConfigFromEnv,
  StaticCagCache,
  SemanticCache,
  ACEEngine,
  ThinkEngine,
  AnthropicAdapter,
} from 'cag-esqueleto';

async function main() {
  const config = createConfigFromEnv();

  // Initialize all 5 layers
  const staticCag = new StaticCagCache(config);
  const semanticCache = new SemanticCache(config);
  const thinkTool = new ThinkEngine(config);
  const ace = new ACEEngine(config);
  const anthropic = new AnthropicAdapter(config);

  // Inject embedding function
  // TODO: Replace with actual embedding API call
  const mockEmbedding = async (_text: string): Promise<number[]> => {
    return new Array(1536).fill(0).map(() => Math.random());
  };

  semanticCache.setEmbeddingFunction(mockEmbedding);
  ace.setEmbeddingFunction(mockEmbedding);

  // Load static knowledge
  await staticCag.loadKnowledge([
    {
      id: 'product-docs',
      type: 'markdown',
      content: '# Product Documentation\n\nYour product docs here...',
    },
  ]);

  // Add curated knowledge
  await ace.addKnowledge({
    id: 'pricing-strategy',
    content: 'Our pricing follows a value-based model...',
    category: 'business',
    priority: 0.9,
    usageCount: 0,
    lastUsedAt: new Date(),
    createdAt: new Date(),
  });

  // Wire up engine
  const engine = new CAGEngine(config);
  engine.registerStaticCag(staticCag);
  engine.registerSemanticCache(semanticCache);
  engine.registerThinkTool(thinkTool);
  engine.registerCuratedKnowledge(ace);

  engine.on((event) => {
    console.log(`[${event.type}]`, event);
  });

  await engine.initialize();

  // First query — cache miss, calls API
  const r1 = await engine.query('How does your pricing work?');
  console.log('First query:', r1.cacheHit ? 'CACHE HIT' : 'CACHE MISS');

  // Similar query — should hit semantic cache
  const r2 = await engine.query('What is your pricing model?');
  console.log('Similar query:', r2.cacheHit ? 'CACHE HIT' : 'CACHE MISS');

  await engine.shutdown();
}

main().catch(console.error);
