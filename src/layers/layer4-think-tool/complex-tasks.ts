/**
 * Layer 4 — Complex Task Registry
 *
 * Pre-defines task types that always activate the Think Tool
 * and inject task-specific instructions into the system prompt.
 *
 * Comes with 4 built-in tasks (reconciliation, simulation,
 * comparison, financial calculation). Users can register custom tasks.
 */

import type { ComplexTask } from '@core/types.js';

export class ComplexTaskRegistry {
  private tasks: Map<string, ComplexTask> = new Map();

  constructor() {
    this.registerDefaults();
  }

  /**
   * Register a custom complex task.
   */
  register(task: ComplexTask): void {
    this.tasks.set(task.id, task);
  }

  /**
   * Get a task by ID.
   */
  get(taskId: string): ComplexTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Unregister a task by ID.
   */
  unregister(id: string): void {
    this.tasks.delete(id);
  }

  /**
   * Find the first task whose patterns match the query.
   */
  matchQuery(query: string): ComplexTask | null {
    for (const task of this.tasks.values()) {
      for (const pattern of task.patterns) {
        if (pattern.test(query)) {
          return task;
        }
      }
    }
    return null;
  }

  /**
   * Get all registered tasks.
   */
  getAll(): ComplexTask[] {
    return Array.from(this.tasks.values());
  }

  // ─── Built-in Tasks ───────────────────────────────────────────────────

  private registerDefaults(): void {
    this.register({
      id: 'subset-sum-reconciliation',
      name: 'Reconciliação por Subset Sum',
      patterns: [/concili|reconcil|match.*payment|batimento/i],
      systemPromptAddition:
        'Para reconciliação, use o Think Tool para: ' +
        '1) Listar todos os valores disponíveis, ' +
        '2) Testar combinações de soma, ' +
        '3) Identificar o subconjunto que fecha com o valor alvo, ' +
        '4) Listar sobras não reconciliadas.',
      requiredContext: ['parameters', 'reference_data'],
    });

    this.register({
      id: 'multi-variable-simulation',
      name: 'Simulação Multi-Variável',
      patterns: [/simul|cenario|scenario|what.if|e.se/i],
      systemPromptAddition:
        'Para simulações, use o Think Tool para: ' +
        '1) Identificar todas as variáveis, ' +
        '2) Calcular cenário base, ' +
        '3) Variar cada parâmetro, ' +
        '4) Comparar resultados, ' +
        '5) Recomendar melhor cenário.',
      requiredContext: ['parameters'],
    });

    this.register({
      id: 'comparative-analysis',
      name: 'Análise Comparativa',
      patterns: [/compar|versus|vs\b|melhor.entre|best.between/i],
      systemPromptAddition:
        'Para análises comparativas, use o Think Tool para: ' +
        '1) Definir critérios de comparação, ' +
        '2) Avaliar cada opção em cada critério, ' +
        '3) Ponderar, ' +
        '4) Ranking final.',
    });

    this.register({
      id: 'financial-calculation',
      name: 'Cálculo Financeiro',
      patterns: [/calcul.*juros|calcul.*imposto|tax.*calc|margem|markup|break.?even/i],
      systemPromptAddition:
        'Para cálculos financeiros, use o Think Tool para: ' +
        '1) Identificar todas as variáveis e suas fontes, ' +
        '2) Mostrar cada passo do cálculo, ' +
        '3) Validar com cálculo reverso, ' +
        '4) Apresentar resultado formatado.',
      requiredContext: ['rules_formulas', 'parameters'],
    });
  }
}
