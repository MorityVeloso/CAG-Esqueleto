/**
 * CAG-Esqueleto — Supabase Integration Example
 *
 * Full setup with persistent storage via Supabase (pgvector).
 *
 * Setup:
 *  1. Run sql/*.sql migrations on your Supabase project
 *  2. Set ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY in .env
 *
 * Run: npx tsx examples/supabase-integration/index.ts
 */

import { createCAG } from 'cag-esqueleto';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const cag = await createCAG({
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
          { id: 'rules', name: 'Rules', type: 'file', filePath: './knowledge/rules.md', category: 'rules', priority: 10 },
          { id: 'formulas', name: 'Formulas', type: 'file', filePath: './knowledge/formulas.md', category: 'formulas', priority: 9 },
          { id: 'params', name: 'Parameters', type: 'file', filePath: './knowledge/params.json', category: 'parameters', priority: 8 },
        ],
      },
      dynamicCAG: {
        updateInterval: 30, // A cada 30 minutos
        snapshotFn: async () => {
          const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
          const { data: ops, error: opsError } = await supabase.from('operations').select('*').eq('status', 'active');
          if (opsError) throw opsError;

          const { data: financeiro, error: finError } = await supabase.rpc('get_financial_position');
          if (finError) throw finError;

          return `
            OPERAÇÕES ATIVAS: ${ops?.length ?? 0}
            ${ops?.map((o) => `- ${o.type} ${o.product} ${o.quantity}t @ R$${o.price}`).join('\n')}
            POSIÇÃO FINANCEIRA:
            ${JSON.stringify(financeiro, null, 2)}
          `;
        },
      },
      semanticCache: {
        similarityThreshold: 0.87,
        ttl: 3600, // 1 hora
      },
      thinkTool: {
        triggerPatterns: ['calcul', 'concili', 'simul', 'compar', 'analise'],
      },
    },
  });

  // ── Query com Think Tool (detecta "calcule") ──────────────────────────

  const resp = await cag.query({
    message: 'Calcule a margem líquida da operação 547 considerando ICMS, PIS/COFINS e frete',
  });

  if (resp.thinkingProcess) {
    console.log('Raciocínio:', resp.thinkingProcess);
  }
  console.log('Resposta:', resp.answer);

  // ── Stats ─────────────────────────────────────────────────────────────

  const stats = await cag.getStats();
  console.log('Cache hit rate:', stats.layerStats.semanticCache.hitRate);
  console.log('Total cost:', stats.tokenUsage.totalCostUSD);

  await cag.shutdown();
}

main().catch(console.error);
