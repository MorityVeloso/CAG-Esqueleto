/**
 * CAG-Esqueleto — Telegram Bot Example
 *
 * Shows how to integrate CAG with a Telegram bot using Telegraf.
 *
 * Install: npm install telegraf
 * Run: npx tsx examples/telegram-bot/index.ts
 */

import { createCAG, type CAGEngine } from 'cag-esqueleto';
import { Telegraf } from 'telegraf';

let cag: CAGEngine;

const bot = new Telegraf(process.env.TELEGRAM_TOKEN!);

// ── Initialize CAG once ─────────────────────────────────────────────────

async function init() {
  cag = await createCAG({
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY! },
    storage: {
      type: 'supabase',
      supabase: {
        url: process.env.SUPABASE_URL!,
        serviceKey: process.env.SUPABASE_SERVICE_KEY!,
      },
    },
    layers: {
      staticCAG: {
        sources: [
          {
            id: 'bot-instructions',
            name: 'Bot Instructions',
            type: 'text',
            content: 'You are a helpful customer support bot. Be concise and friendly.',
            category: 'instructions',
            priority: 10,
          },
        ],
      },
    },
  });
}

// ── Handle incoming messages ────────────────────────────────────────────

bot.on('text', async (ctx) => {
  const userId = ctx.from.id.toString();

  try {
    const response = await cag.query({
      message: ctx.message.text,
      userId,
      sessionId: `telegram_${userId}`,
    });

    await ctx.reply(response.answer);

    // Log
    console.log(
      `[${userId}] Cache: ${response.cacheHit}, ` +
      `Cost: $${response.usage.estimatedCost.toFixed(4)}, ` +
      `Time: ${response.processingTime.total}ms`,
    );
  } catch (error) {
    console.error('CAG error:', error);
    await ctx.reply('Sorry, I encountered an error. Please try again.');
  }
});

// ── Start ───────────────────────────────────────────────────────────────

init().then(() => {
  bot.launch();
  console.log('Bot started!');
});

// Graceful shutdown
process.once('SIGINT', () => { bot.stop('SIGINT'); cag?.shutdown(); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); cag?.shutdown(); });
