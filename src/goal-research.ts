/**
 * CHORUS Goal Research Scheduler
 *
 * Runs research for active goals based on adaptive frequency.
 * Separate from choir-scheduler (fixed 9) and daemon (attention response).
 */

import type { OpenClawPluginService, PluginLogger } from "openclaw/plugin-sdk";
import { loadGoals, updateGoal, type Goal } from "./goals.js";
import { recordExecution, type ChoirExecution } from "./metrics.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface GoalResearchConfig {
  enabled: boolean;
  dailyRunCap: number;
  defaultFrequency: number;
  defaultMaxFrequency: number;
  researchTimeoutMs: number;
  checkIntervalMs: number;
}

export const DEFAULT_GOAL_RESEARCH_CONFIG: GoalResearchConfig = {
  enabled: true,
  dailyRunCap: 50,
  defaultFrequency: 6,
  defaultMaxFrequency: 24,
  researchTimeoutMs: 300000,
  checkIntervalMs: 60000,
};

interface DailyRunTracker {
  date: string;
  count: number;
}

interface ResearchState {
  dailyRuns: DailyRunTracker;
  activeGoalCount: number;
}

function getTodayKey(): string {
  return new Date().toISOString().split("T")[0];
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function countFindings(output: string): number {
  const patterns = [/FINDINGS:/gi, /\*\*finding/gi, /discovered/gi, /found that/gi];
  let count = 0;
  for (const pattern of patterns) {
    const matches = output.match(pattern);
    if (matches) count += matches.length;
  }
  return Math.max(1, Math.min(count, 10));
}

function countAlerts(output: string): number {
  const alertSection = output.match(/ALERTS?:\s*([^\n]+(?:\n(?!-|\*|[A-Z]+:)[^\n]+)*)/i);
  if (!alertSection) return 0;
  const alertText = alertSection[1].toLowerCase();
  if (alertText.includes("none") || alertText.includes("no alert")) return 0;
  return 1;
}

const STATE_DIR = join(homedir(), ".chorus");
const STATE_FILE = join(STATE_DIR, "research-state.json");

function loadState(): ResearchState {
  try {
    if (existsSync(STATE_FILE)) {
      const data = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
      return {
        dailyRuns: data.dailyRuns || { date: getTodayKey(), count: 0 },
        activeGoalCount: data.activeGoalCount || 0,
      };
    }
  } catch {}
  return {
    dailyRuns: { date: getTodayKey(), count: 0 },
    activeGoalCount: 0,
  };
}

function saveState(state: ResearchState): void {
  try {
    if (!existsSync(STATE_DIR)) {
      mkdirSync(STATE_DIR, { recursive: true });
    }
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {}
}

export function createGoalResearchScheduler(
  config: GoalResearchConfig,
  log: PluginLogger,
  api: any
): OpenClawPluginService & {
  getDailyRunCount: () => number;
  getDailyCap: () => number;
  forceRun: (goalId: string) => Promise<void>;
  getStatus: () => { enabled: boolean; dailyRuns: number; dailyCap: number; activeGoals: number };
} {
  let checkInterval: NodeJS.Timeout | null = null;
  
  // Load persisted state
  const state = loadState();
  let dailyRuns: DailyRunTracker = state.dailyRuns;
  let cachedActiveGoalCount: number = state.activeGoalCount;

  function checkDayRollover(): void {
    const today = getTodayKey();
    if (dailyRuns.date !== today) {
      log.info(`[goal-research] New day — resetting run counter`);
      dailyRuns = { date: today, count: 0 };
      persistState();
    }
  }

  function persistState(): void {
    saveState({
      dailyRuns,
      activeGoalCount: cachedActiveGoalCount,
    });
  }

  function calculateFrequency(goal: Goal): number {
    const base = goal.research?.frequency ?? config.defaultFrequency;
    const max = goal.research?.maxFrequency ?? config.defaultMaxFrequency;

    if (!goal.deadline) return base;

    const deadline =
      typeof goal.deadline === "string" ? Date.parse(goal.deadline) : goal.deadline;
    const daysRemaining = (deadline - Date.now()) / (24 * 60 * 60 * 1000);

    let frequency: number;
    if (daysRemaining <= 0) {
      frequency = max;
    } else if (daysRemaining <= 7) {
      frequency = base * 3;
    } else if (daysRemaining <= 30) {
      frequency = base * 1.5;
    } else {
      frequency = base;
    }

    return Math.min(frequency, max);
  }

  function isResearchDue(goal: Goal): boolean {
    if (goal.progress >= 100) return false;
    if (goal.research?.enabled === false) return false;
    if (!goal.criteria?.length && !goal.research?.domains?.length) return false;

    const lastRun = goal.research?.lastRun ?? 0;
    const frequency = calculateFrequency(goal);
    const intervalMs = (24 * 60 * 60 * 1000) / frequency;

    return Date.now() - lastRun >= intervalMs;
  }

  function generatePrompt(goal: Goal): string {
    const domains = goal.research?.domains?.join(", ") || "relevant sources";
    const criteria = goal.criteria?.map((c) => `- ${c}`).join("\n") || "(no specific criteria)";
    const isCurious = (goal.curiosity ?? 0) > 70;

    if (isCurious) {
      return `
GOAL RESEARCH (EXPLORATION MODE): ${goal.name}

You are exploring ideas related to:
${goal.description || goal.name}

This is curiosity-driven research. Be open to unexpected connections.

Starting points:
${criteria}

Tasks:
1. Search broadly for interesting developments
2. Look for unexpected connections or adjacent ideas
3. Note anything surprising or counterintuitive
4. Identify rabbit holes worth exploring later

Output format:
- DISCOVERIES: What you found (can be tangential)
- CONNECTIONS: Links to other domains or ideas
- QUESTIONS: New questions raised
- RABBIT_HOLES: Topics worth deeper exploration

Write findings to: research/goal-${goal.id}-$(date +%Y-%m-%d-%H%M).md
`.trim();
    }

    const alertThreshold = goal.research?.alertThreshold ?? "medium";
    const alertGuidance: Record<string, string> = {
      low: "Alert only for critical, time-sensitive findings",
      medium: "Alert for significant developments affecting the goal",
      high: "Alert for any notable findings",
    };

    return `
GOAL RESEARCH: ${goal.name}

You are researching for the following goal:
${goal.description || goal.name}

Search domains: ${domains}

Success criteria to inform research:
${criteria}

Tasks:
1. Search for recent developments relevant to this goal
2. Assess impact on goal progress or timeline
3. Flag anything that challenges or validates current assumptions
4. Note actionable insights

Alert threshold: ${alertThreshold}
${alertGuidance[alertThreshold]}

Output format:
- FINDINGS: Key discoveries (bullet points)
- IMPACT: How this affects the goal (progress/timeline/risk)
- ALERTS: Anything requiring immediate attention (or "none")
- NEXT: What to research next time

Write findings to: research/goal-${goal.id}-$(date +%Y-%m-%d-%H%M).md

CRITICAL: If sending alerts via iMessage, use PLAIN TEXT ONLY (no markdown).
`.trim();
  }

  async function runResearch(goal: Goal): Promise<void> {
    const startTime = Date.now();
    log.info(`[goal-research] 🔬 Running research for "${goal.name}"`);

    const execution: ChoirExecution = {
      choirId: `goal:${goal.id}`,
      timestamp: new Date().toISOString(),
      durationMs: 0,
      success: false,
      outputLength: 0,
    };

    try {
      const prompt = generatePrompt(goal);

      const result = await api.runAgentTurn?.({
        sessionLabel: `chorus:goal:${goal.id}`,
        message: prompt,
        isolated: true,
        timeoutSeconds: config.researchTimeoutMs / 1000,
      });

      const output = result?.response || "";
      execution.durationMs = Date.now() - startTime;
      execution.success = true;
      execution.outputLength = output.length;
      execution.tokensUsed = result?.meta?.tokensUsed || estimateTokens(output);
      execution.findings = countFindings(output);
      execution.alerts = countAlerts(output);

      log.info(
        `[goal-research] ✓ "${goal.name}" complete ` +
          `(${(execution.durationMs / 1000).toFixed(1)}s, ${execution.findings} findings)`
      );

      await updateGoal(goal.id, {
        research: {
          ...goal.research,
          enabled: goal.research?.enabled ?? true,
          lastRun: Date.now(),
          runCount: (goal.research?.runCount ?? 0) + 1,
        },
      });
    } catch (err) {
      execution.durationMs = Date.now() - startTime;
      execution.success = false;
      execution.error = String(err);
      log.error(`[goal-research] ✗ "${goal.name}" failed: ${err}`);
    }

    recordExecution(execution);
    dailyRuns.count++;
    persistState();
  }

  async function checkAndRun(): Promise<void> {
    checkDayRollover();

    if (dailyRuns.count >= config.dailyRunCap) {
      log.debug(`[goal-research] Daily cap reached (${dailyRuns.count}/${config.dailyRunCap})`);
      return;
    }

    const goals = await loadGoals();
    
    // Update cached active goal count
    cachedActiveGoalCount = goals.filter(
      (g) =>
        g.progress < 100 &&
        g.research?.enabled !== false &&
        (g.criteria?.length || g.research?.domains?.length)
    ).length;
    
    const dueGoals = goals.filter(isResearchDue);

    if (dueGoals.length === 0) return;

    dueGoals.sort((a, b) => {
      const aDeadline = a.deadline
        ? typeof a.deadline === "string"
          ? Date.parse(a.deadline)
          : a.deadline
        : Infinity;
      const bDeadline = b.deadline
        ? typeof b.deadline === "string"
          ? Date.parse(b.deadline)
          : b.deadline
        : Infinity;
      return aDeadline - bDeadline;
    });

    const goal = dueGoals[0];

    if (dailyRuns.count < config.dailyRunCap) {
      await runResearch(goal);
    }
  }

  return {
    id: "chorus-goal-research",

    start: () => {
      if (!config.enabled) {
        log.info("[goal-research] Disabled in config");
        return;
      }

      log.info("[goal-research] 🔬 Starting goal research scheduler");
      log.info(
        `[goal-research] Daily cap: ${config.dailyRunCap}, check interval: ${config.checkIntervalMs / 1000}s`
      );

      checkInterval = setInterval(() => {
        checkAndRun().catch((err) => {
          log.error(`[goal-research] Check failed: ${err}`);
        });
      }, config.checkIntervalMs);

      setTimeout(() => {
        checkAndRun().catch((err) => {
          log.error(`[goal-research] Initial check failed: ${err}`);
        });
      }, 5000);

      log.info("[goal-research] 🔬 Scheduler active");
    },

    stop: () => {
      log.info("[goal-research] Stopping");
      if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
      }
    },

    getDailyRunCount: () => dailyRuns.count,
    getDailyCap: () => config.dailyRunCap,

    forceRun: async (goalId: string) => {
      const goals = await loadGoals();
      const goal = goals.find((g) => g.id === goalId);
      if (!goal) throw new Error(`Goal "${goalId}" not found`);
      await runResearch(goal);
    },

    getStatus: () => {
      return {
        enabled: config.enabled,
        dailyRuns: dailyRuns.count,
        dailyCap: config.dailyRunCap,
        activeGoals: cachedActiveGoalCount,
      };
    },
  };
}
