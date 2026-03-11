/**
 * Layer 4 — Complex Task Registry
 *
 * Allows registering task types that should always use extended thinking.
 * Examples: financial calculations, legal analysis, code review.
 */

export interface TaskDefinition {
  id: string;
  name: string;
  description: string;
  /** Regex patterns that identify this task type */
  patterns: RegExp[];
  /** Minimum thinking budget for this task */
  minBudgetTokens: number;
}

export class ComplexTaskRegistry {
  private tasks: Map<string, TaskDefinition> = new Map();

  register(task: TaskDefinition): void {
    this.tasks.set(task.id, task);
  }

  unregister(id: string): void {
    this.tasks.delete(id);
  }

  /**
   * Find matching task definitions for a query.
   */
  match(query: string): TaskDefinition | null {
    for (const task of this.tasks.values()) {
      for (const pattern of task.patterns) {
        if (pattern.test(query)) {
          return task;
        }
      }
    }
    return null;
  }

  getAll(): TaskDefinition[] {
    return Array.from(this.tasks.values());
  }
}
