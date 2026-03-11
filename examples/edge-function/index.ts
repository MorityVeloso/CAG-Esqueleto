/**
 * CAG-Esqueleto — Supabase Edge Function Example
 *
 * Singleton pattern: initialize once, reuse across requests.
 *
 * Deploy: supabase functions deploy cag-query
 */

import { createCAG } from 'cag-esqueleto';

// Singleton — initialized on first request, reused across invocations
let cag: Awaited<ReturnType<typeof createCAG>> | null = null;

async function getEngine() {
  if (!cag) {
    cag = await createCAG({
      anthropic: {
        // @ts-expect-error Deno.env is available in Edge Functions
        apiKey: Deno.env.get('ANTHROPIC_API_KEY')!,
      },
      storage: {
        type: 'supabase',
        supabase: {
          // @ts-expect-error Deno.env is available in Edge Functions
          url: Deno.env.get('SUPABASE_URL')!,
          // @ts-expect-error Deno.env is available in Edge Functions
          serviceKey: Deno.env.get('SUPABASE_SERVICE_KEY')!,
        },
      },
      layers: {
        staticCAG: {
          sources: [
            {
              id: 'system',
              name: 'System Instructions',
              type: 'text',
              content: 'You are a helpful assistant for our grain trading company.',
              category: 'instructions',
              priority: 10,
            },
          ],
        },
      },
    });
  }
  return cag;
}

// @ts-expect-error Deno.serve is available in Supabase Edge Functions
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { message, userId } = (await req.json()) as {
      message: string;
      userId?: string;
    };

    if (!message) {
      return new Response(JSON.stringify({ error: 'Missing message' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const engine = await getEngine();
    const response = await engine.query({ message, userId });

    return new Response(
      JSON.stringify({
        answer: response.answer,
        cacheHit: response.cacheHit,
        cost: response.usage.estimatedCost,
        processingTime: response.processingTime.total,
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
