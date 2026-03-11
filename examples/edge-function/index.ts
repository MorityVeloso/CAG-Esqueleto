/**
 * CAG-Esqueleto — Supabase Edge Function Example
 *
 * Deploy as a Supabase Edge Function for serverless CAG.
 *
 * Deploy: supabase functions deploy cag-query
 */

import {
  CAGEngine,
  createConfig,
  StaticCagCache,
  SemanticCache,
  ThinkEngine,
} from 'cag-esqueleto';

// Edge Function handler (Deno runtime)
// @ts-expect-error Deno.serve is available in Supabase Edge Functions
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { query } = (await req.json()) as { query: string };

    if (!query) {
      return new Response(JSON.stringify({ error: 'Missing query parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Create config from Deno env
    const config = createConfig({
      // @ts-expect-error Deno.env is available in Edge Functions
      anthropicApiKey: Deno.env.get('ANTHROPIC_API_KEY'),
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
    });

    // Setup layers
    const staticCag = new StaticCagCache(config);
    const thinkTool = new ThinkEngine(config);

    await staticCag.loadKnowledge([
      {
        id: 'system',
        type: 'text',
        content: 'You are a helpful assistant.',
      },
    ]);

    const engine = new CAGEngine(config);
    engine.registerStaticCag(staticCag);
    engine.registerThinkTool(thinkTool);
    await engine.initialize();

    const response = await engine.query(query);

    await engine.shutdown();

    return new Response(
      JSON.stringify({
        content: response.content,
        cached: response.cacheHit,
        latency_ms: response.latencyMs,
        layers: response.layersUsed,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Internal error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
});
