/**
 * CAG-Esqueleto — Telegram Bot Example
 *
 * Shows how to integrate CAG with a Telegram bot.
 * Requires: node-telegram-bot-api (not included in dependencies).
 *
 * Install: npm install node-telegram-bot-api
 */

import {
  CAGEngine,
  createConfigFromEnv,
  StaticCagCache,
  SemanticCache,
  ThinkEngine,
} from 'cag-esqueleto';

// Pseudo-code — replace with actual Telegram bot setup
interface TelegramMessage {
  chat: { id: number };
  text?: string;
}

async function main() {
  const config = createConfigFromEnv();

  // Setup CAG layers
  const staticCag = new StaticCagCache(config);
  const semanticCache = new SemanticCache(config);
  const thinkTool = new ThinkEngine(config);

  await staticCag.loadKnowledge([
    {
      id: 'bot-instructions',
      type: 'text',
      content: 'You are a helpful customer support bot. Be concise and friendly.',
    },
  ]);

  // Wire up engine
  const engine = new CAGEngine(config);
  engine.registerStaticCag(staticCag);
  engine.registerSemanticCache(semanticCache);
  engine.registerThinkTool(thinkTool);
  await engine.initialize();

  // Handle incoming messages
  async function handleMessage(msg: TelegramMessage): Promise<string> {
    if (!msg.text) return 'Please send a text message.';

    try {
      const response = await engine.query(msg.text);

      const stats = response.cacheHit
        ? `(cached, ${response.latencyMs}ms)`
        : `(${response.layersUsed.join('+')}, ${response.latencyMs}ms)`;

      console.log(`Chat ${msg.chat.id}: ${stats}`);
      return response.content;
    } catch (error) {
      console.error('CAG error:', error);
      return 'Sorry, I encountered an error. Please try again.';
    }
  }

  // Example usage
  const reply = await handleMessage({ chat: { id: 123 }, text: 'What is your return policy?' });
  console.log('Bot reply:', reply);

  await engine.shutdown();
}

main().catch(console.error);
