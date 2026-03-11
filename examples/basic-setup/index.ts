/**
 * CAG-Esqueleto — Basic Setup Example
 *
 * Minimal configuration: only anthropic.apiKey is required.
 * Everything else has sensible defaults via Zod.
 *
 * Run: npx tsx examples/basic-setup/index.ts
 */

import { createCAG } from 'cag-esqueleto';

async function main() {
  // ── 1. Create engine with minimal config ──────────────────────────────

  const cag = await createCAG({
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY! },
    layers: {
      staticCAG: {
        sources: [
          {
            id: 'rules',
            name: 'Business Rules',
            type: 'text',
            content: `
              Nossa empresa vende grãos (soja, milho, sorgo).
              Margem mínima por operação: 2%.
              ICMS interestadual: 12% (com crédito) ou 7% (sem crédito).
              Prazo padrão de pagamento: 30 dias.
            `,
            category: 'business_rules',
            priority: 10,
          },
        ],
      },
      dynamicCAG: {
        snapshotFn: async () => {
          return `
            Posição atual: 15 operações ativas, R$ 2.3M em aberto.
            Saldo caixa: R$ 450.000.
            Alertas: 3 NFes pendentes de emissão.
          `;
        },
      },
    },
  });

  // ── 2. Query ──────────────────────────────────────────────────────────

  const response = await cag.query({
    message: 'Qual nossa posição financeira atual?',
  });

  console.log(response.answer);
  console.log(`Custo: $${response.usage.estimatedCost.toFixed(4)}`);
  console.log(`Cache hit: ${response.cacheHit}`);

  // ── 3. Teach something new (Layer 5 — ACE) ───────────────────────────

  await cag.teach(
    'O cliente João Silva sempre pede desconto de 5% e aceita prazo de 45 dias',
    'client_preferences',
    ['joao_silva', 'desconto', 'prazo'],
  );

  // ── 4. Similar query → Semantic Cache hit ─────────────────────────────

  const response2 = await cag.query({
    message: 'Como está nosso caixa agora?',
  });

  console.log(`Cache hit: ${response2.cacheHit}`); // true!

  // ── 5. Cleanup ────────────────────────────────────────────────────────

  await cag.shutdown();
}

main().catch(console.error);
