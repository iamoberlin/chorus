/**
 * CHORUS Salience Filter
 *
 * Cheap, rule-based scoring to decide what's worth attending to.
 * No LLM calls — this runs constantly and must be fast.
 */

import type { Signal } from "./senses.js";

export interface SalienceRule {
  id: string;
  match?: RegExp;           // Content pattern
  source?: string;          // Source type filter
  sourceMatch?: RegExp;     // Source pattern
  boost?: number;           // Add to priority
  penalty?: number;         // Subtract from priority
  minPriority?: number;     // Set floor
  maxPriority?: number;     // Set ceiling
}

// Default rules — can be extended via config
const DEFAULT_RULES: SalienceRule[] = [
  // Urgency keywords
  { id: "urgent", match: /\b(urgent|asap|emergency|critical|immediately)\b/i, boost: 40 },
  { id: "important", match: /\b(important|priority|attention)\b/i, boost: 20 },
  
  // Source boosts
  { id: "goal-source", source: "goal", boost: 15 },
  { id: "inbox-source", source: "inbox", boost: 10 },
  
  // Overdue goals are critical
  { id: "overdue", match: /\boverdue\b/i, boost: 30 },
  
  // Time-based signals are moderate priority
  { id: "time-source", source: "time", maxPriority: 65 },
  
  // Curiosity is low priority (background exploration)
  { id: "curiosity-source", source: "curiosity", maxPriority: 45 },
  
  // Spam/noise penalties
  { id: "unsubscribe", match: /\b(unsubscribe|newsletter|promo|marketing)\b/i, penalty: 50 },
  { id: "automated", match: /\b(automated|no-reply|noreply)\b/i, penalty: 30 },
  
  // Stalled projects need attention but aren't urgent
  { id: "stalled", match: /\bstalled\b/i, boost: 10, maxPriority: 55 },
];

export interface SalienceResult {
  originalPriority: number;
  finalPriority: number;
  rulesApplied: string[];
  shouldAttend: boolean;
}

export class SalienceFilter {
  private rules: SalienceRule[];
  private threshold: number;
  private seenSignals: Map<string, number> = new Map(); // Dedup within time window

  constructor(
    customRules: SalienceRule[] = [],
    threshold: number = 55
  ) {
    this.rules = [...DEFAULT_RULES, ...customRules];
    this.threshold = threshold;
  }

  evaluate(signal: Signal): SalienceResult {
    let priority = signal.priority;
    const rulesApplied: string[] = [];

    // Check for duplicate signals (same id within 1 hour)
    const lastSeen = this.seenSignals.get(signal.id);
    if (lastSeen && Date.now() - lastSeen < 60 * 60 * 1000) {
      return {
        originalPriority: signal.priority,
        finalPriority: 0,
        rulesApplied: ["dedup"],
        shouldAttend: false,
      };
    }

    // Apply rules
    for (const rule of this.rules) {
      let applies = true;

      // Source filter
      if (rule.source && signal.source !== rule.source) {
        applies = false;
      }

      // Source pattern
      if (rule.sourceMatch && !rule.sourceMatch.test(signal.source)) {
        applies = false;
      }

      // Content pattern
      if (rule.match && !rule.match.test(signal.content)) {
        applies = false;
      }

      if (applies) {
        rulesApplied.push(rule.id);

        if (rule.boost) priority += rule.boost;
        if (rule.penalty) priority -= rule.penalty;
        if (rule.minPriority !== undefined) priority = Math.max(priority, rule.minPriority);
        if (rule.maxPriority !== undefined) priority = Math.min(priority, rule.maxPriority);
      }
    }

    // Clamp to 0-100
    priority = Math.max(0, Math.min(100, priority));

    const shouldAttend = priority >= this.threshold;

    // Mark as seen if we're attending
    if (shouldAttend) {
      this.seenSignals.set(signal.id, Date.now());
    }

    // Cleanup old entries periodically
    if (this.seenSignals.size > 1000) {
      const cutoff = Date.now() - 60 * 60 * 1000;
      for (const [id, time] of this.seenSignals) {
        if (time < cutoff) this.seenSignals.delete(id);
      }
    }

    return {
      originalPriority: signal.priority,
      finalPriority: priority,
      rulesApplied,
      shouldAttend,
    };
  }

  // Add custom rules at runtime
  addRule(rule: SalienceRule): void {
    this.rules.push(rule);
  }

  // Update threshold
  setThreshold(threshold: number): void {
    this.threshold = threshold;
  }

  // Get current threshold
  getThreshold(): number {
    return this.threshold;
  }

  // List all rules
  getRules(): SalienceRule[] {
    return [...this.rules];
  }
}

// Singleton instance with defaults
export const defaultFilter = new SalienceFilter();
