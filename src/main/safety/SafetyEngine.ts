import type { SafetyPolicyStore } from './SafetyPolicyStore.js';
import type { PolicyContent } from './types.js';
import { evaluateInputSafety, type InputSafetyDecision } from './InputSafetyFilter.js';

// Binds the frozen published safety policy to the input filter. A missing,
// stale, or corrupt active version fails closed; it never runs rule-less.
export class SafetyEngine {
  constructor(private readonly policyStore: SafetyPolicyStore) {}

  async checkInput(normalizedText: string): Promise<InputSafetyDecision> {
    let policy: PolicyContent | null = null;
    try {
      const versionId = await this.policyStore.getActivePublishedVersion();
      if (versionId !== null) {
        policy = this.policyStore.readPolicy(versionId);
      }
    } catch {
      policy = null;
    }
    return evaluateInputSafety({ normalizedText, compiledRules: policy?.compiledRules ?? null });
  }
}
