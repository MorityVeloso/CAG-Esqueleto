import { describe, it, expect, beforeEach } from 'vitest';
import { ThinkEngine } from '../../src/layers/layer4-think-tool/think-engine.js';
import { ComplexTaskRegistry } from '../../src/layers/layer4-think-tool/complex-tasks.js';
import { createTestConfig } from '../../src/core/config.js';
import type { ContextBlock, AnthropicToolResponse } from '../../src/core/types.js';

// ─── ThinkEngine ─────────────────────────────────────────────────────────────

describe('ThinkEngine', () => {
  let engine: ThinkEngine;
  const emptyContext: ContextBlock[] = [];

  beforeEach(() => {
    const config = createTestConfig();
    engine = new ThinkEngine(config);
  });

  // ─── Pattern Detection ──────────────────────────────────────────────

  it('should activate for "calculate" queries', () => {
    expect(engine.shouldActivate('Calculate the total cost', emptyContext)).toBe(true);
  });

  it('should activate for "compare" queries', () => {
    expect(engine.shouldActivate('Compare plan A and plan B', emptyContext)).toBe(true);
  });

  it('should activate for "conciliação" queries', () => {
    expect(engine.shouldActivate('Faça a conciliação bancária', emptyContext)).toBe(true);
  });

  it('should activate for "simulate" queries', () => {
    expect(engine.shouldActivate('Simule o cenário com 10% de aumento', emptyContext)).toBe(true);
  });

  it('should activate for "analyze/analisar" queries', () => {
    expect(engine.shouldActivate('Analyze the sales data', emptyContext)).toBe(true);
    expect(engine.shouldActivate('Analise os dados de vendas', emptyContext)).toBe(true);
  });

  it('should activate for "optimize" queries', () => {
    expect(engine.shouldActivate('Optimize the delivery routes', emptyContext)).toBe(true);
  });

  it('should activate for "which is best" / "qual o melhor" queries', () => {
    expect(engine.shouldActivate('Which plan is best for us?', emptyContext)).toBe(true);
    expect(engine.shouldActivate('Qual o melhor fornecedor?', emptyContext)).toBe(true);
  });

  it('should activate for "step by step" / "passo a passo" queries', () => {
    expect(engine.shouldActivate('Explain step by step how to do this', emptyContext)).toBe(true);
    expect(engine.shouldActivate('Mostre passo a passo', emptyContext)).toBe(true);
  });

  it('should activate for "explain why" / "explique por que" queries', () => {
    expect(engine.shouldActivate('Explain why this happened', emptyContext)).toBe(true);
    expect(engine.shouldActivate('Explique por que o valor divergiu', emptyContext)).toBe(true);
  });

  it('should NOT activate for simple queries', () => {
    expect(engine.shouldActivate('What is your phone number?', emptyContext)).toBe(false);
    expect(engine.shouldActivate('Hello', emptyContext)).toBe(false);
    expect(engine.shouldActivate('Obrigado pela ajuda', emptyContext)).toBe(false);
  });

  it('should activate for very long queries (>500 chars)', () => {
    const longQuery = 'a'.repeat(501);
    expect(engine.shouldActivate(longQuery, emptyContext)).toBe(true);
  });

  it('should respect disabled config', () => {
    const config = createTestConfig({
      layers: { thinkTool: { enabled: false } },
    });
    const disabled = new ThinkEngine(config);
    expect(disabled.shouldActivate('Calculate step by step', emptyContext)).toBe(false);
  });

  it('should activate via ComplexTaskRegistry matches', () => {
    // "reconciliação" matches the built-in 'subset-sum-reconciliation' task
    expect(engine.shouldActivate('Faça a reconciliação dos pagamentos', emptyContext)).toBe(true);
  });

  // ─── Budget ─────────────────────────────────────────────────────────

  it('should return configured budget tokens', () => {
    const config = createTestConfig({
      layers: { thinkTool: { maxBudgetTokens: 20000 } },
    });
    const customEngine = new ThinkEngine(config);
    expect(customEngine.getThinkingBudget()).toBe(20000);
  });

  // ─── Tool Definition ────────────────────────────────────────────────

  it('should return valid Anthropic tool definition', () => {
    const def = engine.getToolDefinition();

    expect(def.name).toBe('think');
    expect(def.description).toContain('step-by-step');
    expect(def.input_schema.type).toBe('object');
    expect(def.input_schema.properties.reasoning.type).toBe('string');
    expect(def.input_schema.properties.conclusion.type).toBe('string');
    expect(def.input_schema.required).toContain('reasoning');
    expect(def.input_schema.required).not.toContain('conclusion'); // optional
  });

  // ─── Build Tool Config ──────────────────────────────────────────────

  it('should build tool config with auto choice', () => {
    const config = engine.buildToolConfig();

    expect(config.tools).toHaveLength(1);
    expect(config.tools[0]?.name).toBe('think');
    expect(config.tool_choice.type).toBe('auto');
  });

  // ─── Extract Thinking ──────────────────────────────────────────────

  it('should extract thinking from API response with tool_use', () => {
    const response: AnthropicToolResponse = {
      content: [
        {
          type: 'tool_use',
          id: 'tu_123',
          name: 'think',
          input: {
            reasoning: 'Step 1: Gather data. Step 2: Calculate total. Step 3: Apply tax.',
            conclusion: 'The total with tax is R$ 1.150,00',
          },
        },
        {
          type: 'text',
          text: 'The total with tax is R$ 1.150,00',
        },
      ],
      usage: { input_tokens: 500, output_tokens: 200 },
    };

    const result = engine.extractThinking(response);

    expect(result).not.toBeNull();
    expect(result!.reasoning).toContain('Step 1');
    expect(result!.conclusion).toContain('R$ 1.150,00');
    expect(result!.tokensUsed).toBe(200);
  });

  it('should return null when Think Tool was not used', () => {
    const response: AnthropicToolResponse = {
      content: [
        { type: 'text', text: 'Simple answer without thinking.' },
      ],
    };

    expect(engine.extractThinking(response)).toBeNull();
  });

  it('should return null for non-think tool uses', () => {
    const response: AnthropicToolResponse = {
      content: [
        {
          type: 'tool_use',
          id: 'tu_456',
          name: 'search',
          input: { query: 'something' },
        },
      ],
    };

    expect(engine.extractThinking(response)).toBeNull();
  });

  it('should handle missing conclusion gracefully', () => {
    const response: AnthropicToolResponse = {
      content: [
        {
          type: 'tool_use',
          id: 'tu_789',
          name: 'think',
          input: { reasoning: 'Just reasoning, no conclusion' },
        },
      ],
    };

    const result = engine.extractThinking(response);
    expect(result).not.toBeNull();
    expect(result!.reasoning).toBe('Just reasoning, no conclusion');
    expect(result!.conclusion).toBe('');
  });

  // ─── Task Prompt Addition ──────────────────────────────────────────

  it('should return system prompt addition for matched task', () => {
    const addition = engine.getTaskPromptAddition('Faça a reconciliação bancária');
    expect(addition).not.toBeNull();
    expect(addition).toContain('reconciliação');
    expect(addition).toContain('Think Tool');
  });

  it('should return null for unmatched queries', () => {
    expect(engine.getTaskPromptAddition('Hello world')).toBeNull();
  });
});

// ─── ComplexTaskRegistry ─────────────────────────────────────────────────────

describe('ComplexTaskRegistry', () => {
  let registry: ComplexTaskRegistry;

  beforeEach(() => {
    registry = new ComplexTaskRegistry();
  });

  it('should come with 4 pre-registered tasks', () => {
    const all = registry.getAll();
    expect(all).toHaveLength(4);

    const ids = all.map((t) => t.id);
    expect(ids).toContain('subset-sum-reconciliation');
    expect(ids).toContain('multi-variable-simulation');
    expect(ids).toContain('comparative-analysis');
    expect(ids).toContain('financial-calculation');
  });

  it('should match reconciliation queries', () => {
    const match = registry.matchQuery('Faça o batimento dos pagamentos');
    expect(match).not.toBeNull();
    expect(match!.id).toBe('subset-sum-reconciliation');
  });

  it('should match simulation queries', () => {
    const match = registry.matchQuery('Simule um cenário com juros de 12%');
    expect(match).not.toBeNull();
    expect(match!.id).toBe('multi-variable-simulation');
  });

  it('should match comparison queries', () => {
    const match = registry.matchQuery('Compare fornecedor A versus fornecedor B');
    expect(match).not.toBeNull();
    expect(match!.id).toBe('comparative-analysis');
  });

  it('should match financial calculation queries', () => {
    const match = registry.matchQuery('Calcule os juros compostos para 12 meses');
    expect(match).not.toBeNull();
    expect(match!.id).toBe('financial-calculation');
  });

  it('should match "what if" simulation queries', () => {
    const match = registry.matchQuery('What if we increase the price by 10%?');
    expect(match).not.toBeNull();
    expect(match!.id).toBe('multi-variable-simulation');
  });

  it('should match "e se" simulation queries', () => {
    const match = registry.matchQuery('E se aumentarmos o preço?');
    expect(match).not.toBeNull();
    expect(match!.id).toBe('multi-variable-simulation');
  });

  it('should match "break even" financial queries', () => {
    const match = registry.matchQuery('Calculate the break-even point');
    expect(match).not.toBeNull();
    expect(match!.id).toBe('financial-calculation');
  });

  it('should match "markup" financial queries', () => {
    const match = registry.matchQuery('Qual o markup ideal para margem de 30%?');
    expect(match).not.toBeNull();
    expect(match!.id).toBe('financial-calculation');
  });

  it('should return null when no match', () => {
    expect(registry.matchQuery('Hello world')).toBeNull();
    expect(registry.matchQuery('Obrigado pela ajuda')).toBeNull();
  });

  it('should allow registering custom tasks', () => {
    registry.register({
      id: 'custom-audit',
      name: 'Auditoria',
      patterns: [/audit|auditoria/i],
      systemPromptAddition: 'Para auditoria, verifique todos os registros.',
    });

    const match = registry.matchQuery('Realize a auditoria do mês');
    expect(match).not.toBeNull();
    expect(match!.id).toBe('custom-audit');
  });

  it('should allow unregistering tasks', () => {
    registry.unregister('comparative-analysis');

    const all = registry.getAll();
    expect(all).toHaveLength(3);
    expect(registry.get('comparative-analysis')).toBeUndefined();
  });

  it('should get task by ID', () => {
    const task = registry.get('subset-sum-reconciliation');
    expect(task).toBeDefined();
    expect(task!.name).toContain('Reconciliação');
  });

  it('should include requiredContext for tasks that need specific data', () => {
    const reconciliation = registry.get('subset-sum-reconciliation');
    expect(reconciliation!.requiredContext).toContain('parameters');
    expect(reconciliation!.requiredContext).toContain('reference_data');

    const financial = registry.get('financial-calculation');
    expect(financial!.requiredContext).toContain('rules_formulas');
  });
});
