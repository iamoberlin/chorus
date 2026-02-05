/**
 * CHORUS Metrics System
 *
 * Tracks quantitative and qualitative metrics for choir executions.
 * Persists to ~/.chorus/metrics.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface ChoirExecution {
  choirId: string;
  timestamp: string;
  durationMs: number;
  tokensUsed?: number;
  success: boolean;
  error?: string;
  outputLength: number;
  findings?: number; // For research choirs
  alerts?: number; // For monitoring choirs
  improvements?: string[]; // For RSI (Virtues)
}

export interface DailyMetrics {
  date: string;
  executions: ChoirExecution[];
  summary: {
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    totalDurationMs: number;
    totalTokens: number;
    totalFindings: number;
    totalAlerts: number;
    improvements: string[];
    costEstimateUsd: number;
  };
  qualityScore?: number; // 1-5, set manually or by review
  notes?: string;
}

export interface MetricsStore {
  version: number;
  days: Record<string, DailyMetrics>;
  totals: {
    allTimeRuns: number;
    allTimeSuccesses: number;
    allTimeFindings: number;
    allTimeAlerts: number;
    allTimeImprovements: number;
  };
}

const METRICS_DIR = join(homedir(), ".chorus");
const METRICS_FILE = join(METRICS_DIR, "metrics.json");
const COST_PER_1K_TOKENS = 0.003; // Approximate for Claude Sonnet

function ensureMetricsDir(): boolean {
  try {
    if (!existsSync(METRICS_DIR)) {
      mkdirSync(METRICS_DIR, { recursive: true });
    }
    return true;
  } catch {
    return false;
  }
}

function defaultMetricsStore(): MetricsStore {
  return {
    version: 1,
    days: {},
    totals: {
      allTimeRuns: 0,
      allTimeSuccesses: 0,
      allTimeFindings: 0,
      allTimeAlerts: 0,
      allTimeImprovements: 0,
    },
  };
}

function loadMetrics(): MetricsStore {
  if (!ensureMetricsDir()) {
    return defaultMetricsStore();
  }
  if (existsSync(METRICS_FILE)) {
    try {
      return JSON.parse(readFileSync(METRICS_FILE, "utf-8"));
    } catch {
      // Corrupted file, start fresh
    }
  }
  return defaultMetricsStore();
}

function saveMetrics(store: MetricsStore): void {
  if (!ensureMetricsDir()) {
    return; // Silently fail - metrics are not critical
  }
  try {
    writeFileSync(METRICS_FILE, JSON.stringify(store, null, 2));
  } catch {
    // Silently fail - metrics are not critical
  }
}

function getDateKey(date: Date = new Date()): string {
  return date.toISOString().split("T")[0];
}

function getOrCreateDay(store: MetricsStore, dateKey: string): DailyMetrics {
  if (!store.days[dateKey]) {
    store.days[dateKey] = {
      date: dateKey,
      executions: [],
      summary: {
        totalRuns: 0,
        successfulRuns: 0,
        failedRuns: 0,
        totalDurationMs: 0,
        totalTokens: 0,
        totalFindings: 0,
        totalAlerts: 0,
        improvements: [],
        costEstimateUsd: 0,
      },
    };
  }
  return store.days[dateKey];
}

function updateDaySummary(day: DailyMetrics): void {
  const execs = day.executions;
  day.summary = {
    totalRuns: execs.length,
    successfulRuns: execs.filter((e) => e.success).length,
    failedRuns: execs.filter((e) => !e.success).length,
    totalDurationMs: execs.reduce((sum, e) => sum + e.durationMs, 0),
    totalTokens: execs.reduce((sum, e) => sum + (e.tokensUsed || 0), 0),
    totalFindings: execs.reduce((sum, e) => sum + (e.findings || 0), 0),
    totalAlerts: execs.reduce((sum, e) => sum + (e.alerts || 0), 0),
    improvements: execs.flatMap((e) => e.improvements || []),
    costEstimateUsd: execs.reduce((sum, e) => sum + ((e.tokensUsed || 0) / 1000) * COST_PER_1K_TOKENS, 0),
  };
}

export function recordExecution(execution: ChoirExecution): void {
  const store = loadMetrics();
  const dateKey = getDateKey(new Date(execution.timestamp));
  const day = getOrCreateDay(store, dateKey);

  day.executions.push(execution);
  updateDaySummary(day);

  // Update totals
  store.totals.allTimeRuns++;
  if (execution.success) store.totals.allTimeSuccesses++;
  store.totals.allTimeFindings += execution.findings || 0;
  store.totals.allTimeAlerts += execution.alerts || 0;
  store.totals.allTimeImprovements += (execution.improvements || []).length;

  saveMetrics(store);
}

export function getTodayMetrics(): DailyMetrics | null {
  const store = loadMetrics();
  return store.days[getDateKey()] || null;
}

export function getMetricsForDate(date: string): DailyMetrics | null {
  const store = loadMetrics();
  return store.days[date] || null;
}

export function getRecentMetrics(days: number = 7): DailyMetrics[] {
  const store = loadMetrics();
  const result: DailyMetrics[] = [];
  const now = new Date();

  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = getDateKey(d);
    if (store.days[key]) {
      result.push(store.days[key]);
    }
  }

  return result;
}

export function getTotals(): MetricsStore["totals"] {
  return loadMetrics().totals;
}

export function setQualityScore(date: string, score: number, notes?: string): void {
  const store = loadMetrics();
  const day = store.days[date];
  if (day) {
    day.qualityScore = Math.max(1, Math.min(5, score));
    if (notes) day.notes = notes;
    saveMetrics(store);
  }
}

export function formatMetricsSummary(metrics: DailyMetrics): string {
  const s = metrics.summary;
  const successRate = s.totalRuns > 0 ? ((s.successfulRuns / s.totalRuns) * 100).toFixed(0) : "0";
  const avgDuration = s.totalRuns > 0 ? (s.totalDurationMs / s.totalRuns / 1000).toFixed(1) : "0";

  return `
📊 CHORUS Metrics — ${metrics.date}
${"═".repeat(40)}

Executions:     ${s.totalRuns} runs (${successRate}% success)
Duration:       ${(s.totalDurationMs / 1000).toFixed(0)}s total, ${avgDuration}s avg
Tokens:         ${s.totalTokens.toLocaleString()} (~$${s.costEstimateUsd.toFixed(2)})
Findings:       ${s.totalFindings}
Alerts:         ${s.totalAlerts}
Improvements:   ${s.improvements.length > 0 ? s.improvements.join(", ") : "none"}
Quality Score:  ${metrics.qualityScore ? `${metrics.qualityScore}/5` : "not rated"}
${metrics.notes ? `Notes:          ${metrics.notes}` : ""}
`.trim();
}

export function formatWeeklySummary(): string {
  const recent = getRecentMetrics(7);
  const totals = getTotals();

  if (recent.length === 0) {
    return "No metrics recorded yet.";
  }

  const weekRuns = recent.reduce((sum, d) => sum + d.summary.totalRuns, 0);
  const weekSuccesses = recent.reduce((sum, d) => sum + d.summary.successfulRuns, 0);
  const weekFindings = recent.reduce((sum, d) => sum + d.summary.totalFindings, 0);
  const weekCost = recent.reduce((sum, d) => sum + d.summary.costEstimateUsd, 0);
  const avgQuality = recent.filter((d) => d.qualityScore).reduce((sum, d) => sum + (d.qualityScore || 0), 0) / 
    (recent.filter((d) => d.qualityScore).length || 1);

  return `
📊 CHORUS Weekly Summary
${"═".repeat(40)}

Last 7 Days:
  Runs:         ${weekRuns} (${((weekSuccesses / weekRuns) * 100).toFixed(0)}% success)
  Findings:     ${weekFindings}
  Cost:         ~$${weekCost.toFixed(2)}
  Avg Quality:  ${avgQuality > 0 ? `${avgQuality.toFixed(1)}/5` : "not rated"}

All Time:
  Total Runs:   ${totals.allTimeRuns.toLocaleString()}
  Findings:     ${totals.allTimeFindings}
  Improvements: ${totals.allTimeImprovements}
`.trim();
}
