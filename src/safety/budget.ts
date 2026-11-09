export class BudgetExceeded extends Error {}

/** Tracks model usage for one fix attempt and stops it at the configured limits. */
export class Budget {
  inputTokens = 0;
  outputTokens = 0;
  turns = 0;

  constructor(
    readonly maxTokens: number,
    readonly maxTurns: number,
  ) {}

  get totalTokens(): number {
    return this.inputTokens + this.outputTokens;
  }

  record(usage: { inputTokens: number; outputTokens: number }): void {
    this.turns++;
    this.inputTokens += usage.inputTokens;
    this.outputTokens += usage.outputTokens;
  }

  /** Throws when the next turn would go over a limit. */
  check(): void {
    if (this.turns >= this.maxTurns) throw new BudgetExceeded(`Reached the limit of ${this.maxTurns} model turns.`);
    if (this.totalTokens >= this.maxTokens) {
      throw new BudgetExceeded(`Reached the token limit (${this.totalTokens.toLocaleString("en-US")} of ${this.maxTokens.toLocaleString("en-US")}).`);
    }
  }
}
