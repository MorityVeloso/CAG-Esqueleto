/**
 * CAG-Esqueleto — Basic Setup Example
 *
 * Minimal example: static knowledge + query.
 * No external dependencies (Supabase/Redis) needed.
 */

import {
  CAGEngine,
  createConfigFromEnv,
  StaticCagCache,
  ThinkEngine,
} from 'cag-esqueleto';

async function main() {
  // 1. Create config from environment variables
  const config = createConfigFromEnv();

  // 2. Initialize layers
  const staticCag = new StaticCagCache(config);
  const thinkTool = new ThinkEngine(config);

  // 3. Load your knowledge
  await staticCag.loadKnowledge([
    {
      id: 'faq',
      type: 'markdown',
      content: `
# Company FAQ

## What is our return policy?
30-day full refund, no questions asked.

## What payment methods do we accept?
Credit cards (Visa, Mastercard), PIX, and bank transfer.

## What are our business hours?
Monday to Friday, 9am to 6pm BRT.
      `.trim(),
    },
  ]);

  // 4. Wire up the engine
  const engine = new CAGEngine(config);
  engine.registerStaticCag(staticCag);
  engine.registerThinkTool(thinkTool);

  // 5. Listen to events (optional)
  engine.on((event) => {
    console.log(`[CAG Event] ${event.type}`, event);
  });

  // 6. Initialize and query
  await engine.initialize();

  const response = await engine.query('What is your return policy?');
  console.log('Response:', response.content);
  console.log('Layers used:', response.layersUsed);
  console.log('Latency:', response.latencyMs, 'ms');

  await engine.shutdown();
}

main().catch(console.error);
