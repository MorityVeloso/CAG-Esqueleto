import { describe, it, expect, beforeEach } from 'vitest';
import { ThinkEngine } from '../../src/layers/layer4-think-tool/think-engine.js';
import { ComplexTaskRegistry } from '../../src/layers/layer4-think-tool/complex-tasks.js';
import { createTestConfig } from '../../src/core/config.js';
import type { QueryContext } from '../../src/core/types.js';

describe('ThinkEngine', () => {
  let engine: ThinkEngine;
  const baseContext: QueryContext = {
    query: '',
    conversationHistory: [],
    activeKnowledge: [],
    complexity: 'simple',
  };

  beforeEach(() => {
    const config = createTestConfig();
    engine = new ThinkEngine(config);
  });

  it('should activate thinking for complex queries', () => {
    const result = engine.shouldUseThinking(
      'Calculate the total cost step by step',
      baseContext,
    );
    expect(result).toBe(true);
  });

  it('should not activate thinking for simple queries', () => {
    const result = engine.shouldUseThinking(
      'What is your phone number?',
      baseContext,
    );
    expect(result).toBe(false);
  });

  it('should detect multi-step complexity', () => {
    const complexity = engine.assessComplexity(
      'First analyze the data, then create a plan, and finally implement it',
      baseContext,
    );
    expect(complexity).toBe('multi_step');
  });

  it('should detect moderate complexity for comparisons', () => {
    const complexity = engine.assessComplexity(
      'What is the difference between plan A and plan B?',
      baseContext,
    );
    expect(complexity).toBe('moderate');
  });

  it('should return simple for short, direct queries', () => {
    const complexity = engine.assessComplexity('Hello', baseContext);
    expect(complexity).toBe('simple');
  });

  it('should respect disabled config', () => {
    const config = createTestConfig({
      layers: {
        ...createTestConfig().layers,
        thinkTool: { enabled: false, budgetTokens: 10000 },
      },
    });
    const disabled = new ThinkEngine(config);
    expect(disabled.shouldUseThinking('Calculate step by step', baseContext)).toBe(false);
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
