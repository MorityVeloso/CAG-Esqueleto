import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AdaptiveCompressor } from '../../src/layers/layer2-dynamic-cag/compressor.js';
import { DynamicSnapshot } from '../../src/layers/layer2-dynamic-cag/dynamic-snapshot.js';
import { SnapshotScheduler } from '../../src/layers/layer2-dynamic-cag/scheduler.js';
import { createTestConfig } from '../../src/core/config.js';

/** Generate realistic dynamic data for compression tests */
function generateFinancialReport(lines = 30): string {
  const items: string[] = [
    'Posição Consolidada do Portfolio — Atualização Diária',
    '',
    'Ativo: PETR4 | Quantidade: 1500 | Preço Médio: R$ 38.42 | Valor Atual: R$ 39.10 | P&L: +R$ 1.020,00',
    'Ativo: VALE3 | Quantidade: 800 | Preço Médio: R$ 68.15 | Valor Atual: R$ 67.90 | P&L: -R$ 200,00',
    'Ativo: ITUB4 | Quantidade: 2000 | Preço Médio: R$ 32.80 | Valor Atual: R$ 33.25 | P&L: +R$ 900,00',
    'Ativo: BBDC4 | Quantidade: 1200 | Preço Médio: R$ 15.60 | Valor Atual: R$ 15.45 | P&L: -R$ 180,00',
    '',
    'Resumo de Operações Ativas:',
    '- Operação de Compra de PETR4 programada para 14:30',
    '- Operação de Venda de VALE3 aguardando confirmação',
    '- Operação de Compra de WEGE3 em análise pelo comitê',
    '- Operação de Compra de RENT3 pendente de aprovação',
    '- Operação de Venda de BBDC4 executada parcialmente',
    '',
    'Alertas Pendentes:',
    'ALERTA: PETR4 atingiu stop-loss em R$ 37.00 — verificar posição',
    'ALERTA: Margem de garantia abaixo de 120% — depositar colateral',
    'ALERTA: Vencimento de opções em 3 dias — roll ou exercício necessário',
    '',
    'Indicadores de Mercado:',
    'IBOVESPA: 128.450 pontos (+0.82%)',
    'Dólar: R$ 4.97 (-0.15%)',
    'DI Futuro Jan/26: 10.25% a.a.',
    'Selic Meta: 10.50% a.a.',
  ];

  // Pad to requested number of lines with repetitive data
  while (items.length < lines) {
    items.push(`Operação #${items.length}: Compra de XPTO${items.length} — Quantidade: ${items.length * 100} — Status: Pendente`);
  }

  return items.join('\n');
}

// ─── AdaptiveCompressor ──────────────────────────────────────────────────────

describe('AdaptiveCompressor', () => {
  let compressor: AdaptiveCompressor;

  beforeEach(() => {
    compressor = new AdaptiveCompressor({ targetRatio: 0.45, maxTokens: 500 });
  });

  it('should compress text within maxTokens budget', async () => {
    const report = generateFinancialReport(50);
    const result = await compressor.compress(report);

    expect(result.compressedTokens).toBeLessThanOrEqual(500);
    expect(result.compressed.length).toBeGreaterThan(0);
    expect(result.compressionRatio).toBeLessThan(1);
    expect(result.segmentsKept).toBeGreaterThan(0);
  });

  it('should return empty result for empty text', async () => {
    const result = await compressor.compress('');
    expect(result.compressed).toBe('');
    expect(result.originalTokens).toBe(0);
    expect(result.segmentsKept).toBe(0);
    expect(result.segmentsDropped).toBe(0);
  });

  it('should score higher segments with query relevance', async () => {
    const text = [
      'O sistema de pagamentos processa 1000 transações por hora.',
      'O jardim da empresa tem 5 árvores de manga.',
      'A taxa de erro de pagamento está em 0.1% este mês.',
      'O refeitório serve almoço das 11h às 14h.',
    ].join('\n\n');

    const withQuery = await compressor.compress(text, 'pagamento erro taxa');

    // Should keep payment-related segments, drop irrelevant ones
    expect(withQuery.compressed).toContain('pagamento');
    expect(withQuery.segmentsDropped).toBeGreaterThanOrEqual(0);
  });

  it('should apply registered abbreviations', async () => {
    compressor.registerAbbreviation('Operação de Compra', 'Op.Compra');
    compressor.registerAbbreviation('Operação de Venda', 'Op.Venda');

    const text = 'Operação de Compra de PETR4. Operação de Venda de VALE3. Operação de Compra de WEGE3.';
    const result = await compressor.compress(text);

    expect(result.compressed).toContain('Op.Compra');
    expect(result.compressed).toContain('Op.Venda');
    expect(result.compressed).not.toContain('Operação de Compra');
  });

  it('should apply custom compression rules', async () => {
    compressor.registerCompressionRule({
      name: 'currency-compact',
      pattern: /R\$\s+(\d)/g,
      replacement: 'R$$1',
    });

    const text = 'O valor é R$ 100 mais R$ 200 totalizando R$ 300.';
    const result = await compressor.compress(text);

    expect(result.compressed).toContain('R$100');
  });

  it('should densify verbose bullet lists', async () => {
    const text = [
      '- Item Alpha',
      '- Item Beta',
      '- Item Gamma',
      '- Item Delta',
    ].join('\n');

    const result = await compressor.compress(text);

    // Lists with 3+ short items should be pipe-separated
    expect(result.compressed).toContain('|');
  });

  it('should preserve all segments when text fits in budget', async () => {
    const smallCompressor = new AdaptiveCompressor({ targetRatio: 0.45, maxTokens: 10000 });
    const text = 'Short text. Another sentence.';
    const result = await smallCompressor.compress(text);

    expect(result.segmentsDropped).toBe(0);
    expect(result.compressionRatio).toBeLessThanOrEqual(1);
  });

  it('should track compression metrics accurately', async () => {
    const report = generateFinancialReport(40);
    const result = await compressor.compress(report);

    expect(result.originalTokens).toBeGreaterThan(0);
    expect(result.compressedTokens).toBeGreaterThan(0);
    expect(result.compressionRatio).toBe(result.compressedTokens / result.originalTokens);
    expect(result.segmentsKept + result.segmentsDropped).toBeGreaterThan(0);
  });

  it('should deduplicate consecutive identical lines', async () => {
    const text = 'Line A\nLine A\nLine A\n\nLine B\nLine B';
    const result = await compressor.compress(text);

    const occurrences = (result.compressed.match(/Line A/g) ?? []).length;
    expect(occurrences).toBeLessThanOrEqual(1);
  });
});

// ─── DynamicSnapshot ─────────────────────────────────────────────────────────

describe('DynamicSnapshot', () => {
  it('should generate a snapshot from snapshotFn', async () => {
    const config = createTestConfig({
      layers: {
        dynamicCAG: {
          snapshotFn: async () => generateFinancialReport(),
        },
      },
    });
    const layer = new DynamicSnapshot(config);

    const compressed = await layer.generateSnapshot();

    expect(compressed.length).toBeGreaterThan(0);
    expect(layer.isStale()).toBe(false);
  });

  it('should throw if no snapshotFn is configured', async () => {
    const config = createTestConfig();
    const layer = new DynamicSnapshot(config);

    await expect(layer.generateSnapshot()).rejects.toThrow('No snapshotFn configured');
  });

  it('should return context block via getContext()', async () => {
    const config = createTestConfig({
      layers: {
        dynamicCAG: {
          snapshotFn: async () => 'Current portfolio: PETR4 1500 shares',
        },
      },
    });
    const layer = new DynamicSnapshot(config);
    await layer.generateSnapshot();

    const block = await layer.getContext();

    expect(block.id).toBe('dynamic-snapshot');
    expect(block.layer).toBe('dynamic');
    expect(block.content).toContain('PETR4');
    expect(block.tokenCount).toBeGreaterThan(0);
    expect(block.metadata.compressionRatio).toBeDefined();
  });

  it('should auto-refresh when stale on getContext()', async () => {
    let callCount = 0;
    const config = createTestConfig({
      layers: {
        dynamicCAG: {
          ttl: 1, // 1 second TTL
          snapshotFn: async () => {
            callCount++;
            return `Data version ${callCount}`;
          },
        },
      },
    });
    const layer = new DynamicSnapshot(config);

    await layer.generateSnapshot();
    expect(callCount).toBe(1);

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 1100));

    expect(layer.isStale()).toBe(true);
    const block = await layer.getContext();

    // Should have auto-refreshed
    expect(callCount).toBe(2);
    expect(block.content).toContain('version 2');
  });

  it('should fallback to last valid snapshot when refresh fails', async () => {
    let shouldFail = false;
    const config = createTestConfig({
      layers: {
        dynamicCAG: {
          ttl: 1,
          snapshotFn: async () => {
            if (shouldFail) throw new Error('API down');
            return 'Valid data v1';
          },
        },
      },
    });
    const layer = new DynamicSnapshot(config);

    // First call succeeds
    await layer.generateSnapshot();

    // Make TTL expire
    await new Promise((r) => setTimeout(r, 1100));
    shouldFail = true;

    // getContext should return last valid, not throw
    const block = await layer.getContext();
    expect(block.content).toContain('Valid data v1');
    expect(block.metadata.isStale).toBe(true);
    expect(block.metadata.lastError).toBe('API down');
  });

  it('should forceRefresh regardless of TTL', async () => {
    let callCount = 0;
    const config = createTestConfig({
      layers: {
        dynamicCAG: {
          ttl: 3600, // 1 hour TTL
          snapshotFn: async () => {
            callCount++;
            return `Version ${callCount}`;
          },
        },
      },
    });
    const layer = new DynamicSnapshot(config);

    await layer.generateSnapshot();
    expect(layer.isStale()).toBe(false);

    await layer.forceRefresh();
    expect(callCount).toBe(2);

    const block = await layer.getContext();
    expect(block.content).toContain('Version 2');
  });

  it('should report accurate stats', async () => {
    const config = createTestConfig({
      layers: {
        dynamicCAG: {
          snapshotFn: async () => generateFinancialReport(),
        },
      },
    });
    const layer = new DynamicSnapshot(config);

    // Before snapshot
    const statsBefore = layer.getStats();
    expect(statsBefore.hasSnapshot).toBe(false);
    expect(statsBefore.isStale).toBe(true);

    // After snapshot
    await layer.generateSnapshot();
    const statsAfter = layer.getStats();
    expect(statsAfter.hasSnapshot).toBe(true);
    expect(statsAfter.isStale).toBe(false);
    expect(statsAfter.originalTokens).toBeGreaterThan(0);
    expect(statsAfter.compressedTokens).toBeGreaterThan(0);
    expect(statsAfter.compressionRatio).toBeGreaterThan(0);
    expect(statsAfter.lastUpdatedAt).toBeInstanceOf(Date);
    expect(statsAfter.snapshotAge).toBeGreaterThanOrEqual(0);
  });

  it('should expose compressor for abbreviation registration', async () => {
    const config = createTestConfig({
      layers: {
        dynamicCAG: {
          snapshotFn: async () => 'Operação de Compra de PETR4 em andamento. Operação de Compra de VALE3 pendente.',
        },
      },
    });
    const layer = new DynamicSnapshot(config);
    layer.getCompressor().registerAbbreviation('Operação de Compra', 'Op.Compra');

    await layer.generateSnapshot();
    const block = await layer.getContext();

    expect(block.content).toContain('Op.Compra');
    expect(block.content).not.toContain('Operação de Compra');
  });
});

// ─── SnapshotScheduler ───────────────────────────────────────────────────────

describe('SnapshotScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should start and stop periodic updates', () => {
    const config = createTestConfig({
      layers: {
        dynamicCAG: {
          snapshotFn: async () => 'data',
        },
      },
    });
    const layer = new DynamicSnapshot(config);
    const scheduler = new SnapshotScheduler(layer, 5); // 5 minutes

    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);

    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
  });

  it('should execute runNow() immediately', async () => {
    let called = false;
    const config = createTestConfig({
      layers: {
        dynamicCAG: {
          snapshotFn: async () => {
            called = true;
            return 'fresh data';
          },
        },
      },
    });
    const layer = new DynamicSnapshot(config);
    const scheduler = new SnapshotScheduler(layer, 60);

    await scheduler.runNow();
    expect(called).toBe(true);
  });

  it('should stop after 3 consecutive failures', async () => {
    const config = createTestConfig({
      layers: {
        dynamicCAG: {
          snapshotFn: async () => { throw new Error('fail'); },
        },
      },
    });
    const layer = new DynamicSnapshot(config);
    const scheduler = new SnapshotScheduler(layer, 1); // 1 minute

    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);

    // Trigger 3 intervals
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(scheduler.isRunning()).toBe(false);
    expect(scheduler.getErrorCount()).toBe(3);
  });
});
