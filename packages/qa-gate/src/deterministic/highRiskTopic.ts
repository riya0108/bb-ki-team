import type { RiskLevel } from '@bb/shared-types';

// Spec section 14.1's 9 high-risk categories, each with a small keyword set. This is
// a coarse heuristic gate, not a substitute for the LLM rubric checks — it exists so
// risk_level/risk_flags are set deterministically and can't be silently skipped.
const HIGH_RISK_CATEGORIES: Record<string, RegExp> = {
  financial_claims: /\b(invest(ment|ing)?|stock (price|market)|returns?|mutual fund|portfolio|IPO|crore|lakh)\b/i,
  politics: /\b(election|minister|parliament|government policy|political party|MP\b|MLA\b)\b/i,
  legal_tax: /\b(tax (law|rule|slab)|legal advice|lawsuit|court ruling|income tax act|GST rate)\b/i,
  health: /\b(cure|diagnos(is|e)|treatment|medicine|disease|symptom|dosage)\b/i,
  accusations: /\b(accused of|allegedly|scam(med)?|fraud(ulent)?|lawsuit against)\b/i,
  client_info: /\b(client (name|data|confidential)|non-disclosure|NDA\b)\b/i,
  breaking_news: /\b(breaking|just in|developing story|unconfirmed reports)\b/i,
  unsourced_statistics: /\b\d+(\.\d+)?\s?%|\b(₹|\$)\s?\d[\d,]*/,
  ai_demonstration: /\b(AI[- ]generated (demo|result)|synthetic (video|image) shown as real)\b/i,
};

export interface HighRiskClassification {
  riskLevel: RiskLevel;
  riskFlags: string[];
}

export function classifyHighRiskTopic(text: string): HighRiskClassification {
  const riskFlags = Object.entries(HIGH_RISK_CATEGORIES)
    .filter(([, pattern]) => pattern.test(text))
    .map(([category]) => category);

  const riskLevel: RiskLevel = riskFlags.length >= 2 ? 'high' : riskFlags.length === 1 ? 'medium' : 'low';

  return { riskLevel, riskFlags };
}
