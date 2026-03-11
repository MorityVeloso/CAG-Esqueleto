import { describe, it, expect, beforeEach } from 'vitest';
import { ThinkEngine } from '../../src/layers/layer4-think-tool/think-engine.js';
import { ComplexTaskRegistry } from '../../src/layers/layer4-think-tool/complex-tasks.js';
import { createTestConfig } from '../../src/core/config.js';
import type { ContextBlock } from '../../src/core/types.js';

describe('ThinkEngine', () => {
  let engine: ThinkEngine;
  const emptyContext: ContextBlock[] = [];

  beforeEach(() => {
    const config = createTestConfig();
    engine = new ThinkEngine(config);
  });

  it('should activate thinking for queries matching trigger patterns', () => {
    const result = engine.shouldActivate(
      'Calculate the total cost step by step',
      emptyContext,
    );
    expect(result).toBe(true);
  });

  it('should not activate thinking for simple queries', () => {
    const result = engine.shouldActivate(
      'What is your phone number?',
      emptyContext,
    );
    expect(result).toBe(false);
  });

  it('should activate for "analyze" trigger pattern', () => {
    const result = engine.shouldActivate(
      'Analyze the sales data from last quarter',
      emptyContext,
    );
    expect(result).toBe(true);
  });

  it('should activate for "compare" trigger pattern', () => {
    const result = engine.shouldActivate(
      'Compare plan A and plan B',
      emptyContext,
    );
    expect(result).toBe(true);
  });

  it('should activate for very long queries (>500 chars)', () => {
    const longQuery = 'a'.repeat(501);
    const result = engine.shouldActivate(longQuery, emptyContext);
    expect(result).toBe(true);
  });

  it('should respect disabled config', () => {
    const config = createTestConfig({
      layers: {
        thinkTool: { enabled: false },
      },
    });
    const disabled = new ThinkEngine(config);
    expect(disabled.shouldActivate('Calculate step by step', emptyContext)).toBe(false);
  });

  it('should return configured budget tokens', () => {
    const config = createTestConfig({
      layers: {
        thinkTool: { maxBudgetTokens: 20000 },
      },
    });
    const customEngine = new ThinkEngine(config);
    expect(customEngine.getThinkingBudget()).toBe(20000);
  });
});

describe('ComplexTaskRegistry', () => {
  it('should register and match tasks', () => {
    const registry = new ComplexTaskRegistry();
    registry.register({
      id: 'math',
      name: 'Math Calculations',
      description: 'Complex mathematical operations',
      patterns: [/calcul/i, /compute/i, /math/i],
      minBudgetTokens: 5000,
    });

    const match = registry.match('Can you calculate my taxes?');
    expect(match).not.toBeNull();
    expect(match?.id).toBe('math');
  });

  it('should return null when no match', () => {
    const registry = new ComplexTaskRegistry();
    expect(registry.match('Hello world')).toBeNull();
  });
});
