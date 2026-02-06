/**
 * CHORUS Purpose Research Scheduler
 *
 * Runs research for active purposes based on adaptive frequency.
 * Separate from choir-scheduler (fixed 9) and daemon (attention response).
 */

import type { OpenClawPluginService, PluginLogger } from "openclaw/plugin-sdk";
import { loadPurposes, updatePurpose, type Purpose } from "./purposes.js";
import { recordExecution, type ChoirExecution } from "./metrics.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { spawn } from "child_process";

// Workspace path for research output
const WORKSPACE_PATH = process.env.OPENCLAW_WORKSPACE || join(homedir(), ".openclaw", "workspace");
const RESEARCH_DIR = join(WORKSPACE_PATH, "research");

export interface PurposeResearchConfig {
  enabled: boolean;
  dailyRunCap: number;
  defaultFrequency: number;
  defaultMaxFrequency: number;
  researchTimeoutMs: number;
  checkIntervalMs: number;
}

export const DEFAULT_PURPOSE_RESEARCH_CONFIG: PurposeResearchConfig = {
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
  activePurposeCount: number;
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
        activePurposeCount: data.activePurposeCount || 0,
      };
    }
  } catch {}
  return {
    dailyRuns: { date: getTodayKey(), count: 0 },
    activePurposeCount: 0,
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

export function createPurposeResearchScheduler(
  config: PurposeResearchConfig,
  log: PluginLogger,
  api: any
): OpenClawPluginService & {
  getDailyRunCount: () => number;
  getDailyCap: () => number;
  forceRun: (purposeId: string) => Promise<void>;
  getStatus: () => { enabled: boolean; dailyRuns: number; dailyCap: number; activePurposes: number };
} {
  let checkInterval: NodeJS.Timeout | null = null;
  
  // Load persisted state
  const state = loadState();
  let dailyRuns: DailyRunTracker = state.dailyRuns;
  let cachedActivePurposeCount: number = state.activePurposeCount;

  function checkDayRollover(): void {
    const today = getTodayKey();
    if (dailyRuns.date !== today) {
      log.info(`[purpose-research] New day — resetting run counter`);
      dailyRuns = { date: today, count: 0 };
      persistState();
    }
  }

  function persistState(): void {
    saveState({
      dailyRuns,
      activePurposeCount: cachedActivePurposeCount,
    });
  }

  function calculateFrequency(purpose: Purpose): number {
    const base = purpose.research?.frequency ?? config.defaultFrequency;
    const max = purpose.research?.maxFrequency ?? config.defaultMaxFrequency;

    if (!purpose.deadline) return base;

    const deadline =
      typeof purpose.deadline === "string" ? Date.parse(purpose.deadline) : purpose.deadline;
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

  function isResearchDue(purpose: Purpose): boolean {
    if (purpose.progress >= 100) return false;
    if (purpose.research?.enabled === false) return false;
    if (!purpose.criteria?.length && !purpose.research?.domains?.length) return false;

    const lastRun = purpose.research?.lastRun ?? 0;
    const frequency = calculateFrequency(purpose);
    const intervalMs = (24 * 60 * 60 * 1000) / frequency;

    return Date.now() - lastRun >= intervalMs;
  }

  function generatePrompt(purpose: Purpose): string {
    const domains = purpose.research?.domains?.join(", ") || "relevant sources";
    const criteria = purpose.criteria?.map((c) => `- ${c}`).join("\n") || "(no specific criteria)";
    const isCurious = (purpose.curiosity ?? 0) > 70;

    if (isCurious) {
      return `
PURPOSE RESEARCH (EXPLORATION MODE): ${purpose.name}

You are exploring ideas related to:
${purpose.description || purpose.name}

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

Your output will be saved automatically. Focus on the research content.
`.trim();
    }

    const alertThreshold = purpose.research?.alertThreshold ?? "medium";
    const alertGuidance: Record<string, string> = {
      low: "Alert only for critical, time-sensitive findings",
      medium: "Alert for significant developments affecting the purpose",
      high: "Alert for any notable findings",
    };

    return `
PURPOSE RESEARCH: ${purpose.name}

You are researching for the following purpose:
${purpose.description || purpose.name}

Search domains: ${domains}

Success criteria to inform research:
${criteria}

Tasks:
1. Search for recent developments relevant to this purpose
2. Assess impact on purpose progress or timeline
3. Flag anything that challenges or validates current assumptions
4. Note actionable insights

Alert threshold: ${alertThreshold}
${alertGuidance[alertThreshold]}

Output format:
- FINDINGS: Key discoveries (bullet points)
- IMPACT: How this affects the purpose (progress/timeline/risk)
- ALERTS: Anything requiring immediate attention (or "none")
- NEXT: What to research next time

Your output will be saved automatically. Focus on the research content.

CRITICAL: If sending alerts via iMessage, use PLAIN TEXT ONLY (no markdown).
`.trim();
  }

  async function runResearch(purpose: Purpose): Promise<void> {
    const startTime = Date.now();
    log.info(`[purpose-research] 🔬 Running research for "${purpose.name}"`);

    const execution: ChoirExecution = {
      choirId: `purpose:${purpose.id}`,
      timestamp: new Date().toISOString(),
      durationMs: 0,
      success: false,
      outputLength: 0,
    };

    try {
      const prompt = generatePrompt(purpose);
      let output = "";
      let result: any = null;

      // Try plugin API first, fall back to CLI
      if (typeof api.runAgentTurn === "function") {
        try {
          result = await api.runAgentTurn({
            sessionLabel: `chorus:purpose:${purpose.id}`,
            message: prompt,
            isolated: true,
            timeoutSeconds: config.researchTimeoutMs / 1000,
          });
          output = result?.response || "";
        } catch (apiErr) {
          log.debug(`[purpose-research] API runAgentTurn failed, falling back to CLI: ${apiErr}`);
          result = null;
        }
      }

      if (!result) {
        // CLI fallback - use stdin to avoid arg length limits (async to avoid blocking event loop)
        log.debug(`[purpose-research] Using CLI fallback for "${purpose.name}"`);
        result = await new Promise<any>((resolve) => {
          const child = spawn("openclaw", [
            "agent",
            "--session-id", `chorus:purpose:${purpose.id}`,
            "--json",
          ], { stdio: ['pipe', 'pipe', 'pipe'] });

          let stdout = '';
          let stderr = '';
          const maxBuffer = 1024 * 1024;
          child.stdout.on('data', (d: Buffer) => { if (stdout.length < maxBuffer) stdout += d.toString(); });
          child.stderr.on('data', (d: Buffer) => { if (stderr.length < maxBuffer) stderr += d.toString(); });

          // Write prompt to stdin
          child.stdin.write(prompt);
          child.stdin.end();

          const timer = setTimeout(() => { child.kill('SIGTERM'); }, config.researchTimeoutMs);
          child.on('close', (code) => { clearTimeout(timer); resolve({ status: code, stdout, stderr }); });
          child.on('error', (err) => { clearTimeout(timer); resolve({ status: 1, stdout: '', stderr: String(err) }); });
        });

        if (result.status === 0 && result.stdout) {
          try {
            const json = JSON.parse(result.stdout);
            output = json.result?.payloads?.[0]?.text || json.response || "";
          } catch {
            output = result.stdout;
          }
        } else if (result.stderr) {
          log.error(`[purpose-research] CLI error: ${result.stderr}`);
        }
      }
      execution.durationMs = Date.now() - startTime;
      execution.success = true;
      execution.outputLength = output.length;
      execution.tokensUsed = result?.meta?.tokensUsed || estimateTokens(output);
      execution.findings = countFindings(output);
      execution.alerts = countAlerts(output);

      log.info(
        `[purpose-research] ✓ "${purpose.name}" complete ` +
          `(${(execution.durationMs / 1000).toFixed(1)}s, ${execution.findings} findings)`
      );

      // Write research output to file
      if (output && output.length > 50) {
        try {
          if (!existsSync(RESEARCH_DIR)) {
            mkdirSync(RESEARCH_DIR, { recursive: true });
          }
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
          const filename = `purpose-${purpose.id}-${timestamp}.md`;
          const filepath = join(RESEARCH_DIR, filename);
          const header = `# Research: ${purpose.name}\n\n**Date:** ${new Date().toISOString()}\n**Purpose:** ${purpose.id}\n\n---\n\n`;
          writeFileSync(filepath, header + output);
          log.info(`[purpose-research] 📝 Wrote ${filename}`);
        } catch (writeErr) {
          log.error(`[purpose-research] Failed to write research file: ${writeErr}`);
        }
      }

      await updatePurpose(purpose.id, {
        research: {
          ...purpose.research,
          enabled: purpose.research?.enabled ?? true,
          lastRun: Date.now(),
          runCount: (purpose.research?.runCount ?? 0) + 1,
        },
      });
    } catch (err) {
      execution.durationMs = Date.now() - startTime;
      execution.success = false;
      execution.error = String(err);
      log.error(`[purpose-research] ✗ "${purpose.name}" failed: ${err}`);
    }

    recordExecution(execution);
    dailyRuns.count++;
    persistState();
  }

  async function checkAndRun(): Promise<void> {
    checkDayRollover();

    if (dailyRuns.count >= config.dailyRunCap) {
      log.debug(`[purpose-research] Daily cap reached (${dailyRuns.count}/${config.dailyRunCap})`);
      return;
    }

    const purposes = await loadPurposes();
    
    // Update cached active purpose count
    cachedActivePurposeCount = purposes.filter(
      (p) =>
        p.progress < 100 &&
        p.research?.enabled !== false &&
        (p.criteria?.length || p.research?.domains?.length)
    ).length;
    
    const duePurposes = purposes.filter(isResearchDue);

    if (duePurposes.length === 0) return;

    duePurposes.sort((a, b) => {
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

    const purpose = duePurposes[0];

    if (dailyRuns.count < config.dailyRunCap) {
      await runResearch(purpose);
    }
  }

  return {
    id: "chorus-purpose-research",

    start: () => {
      if (!config.enabled) {
        log.info("[purpose-research] Disabled in config");
        return;
      }

      log.info("[purpose-research] 🔬 Starting purpose research scheduler");
      log.info(
        `[purpose-research] Daily cap: ${config.dailyRunCap}, check interval: ${config.checkIntervalMs / 1000}s`
      );

      checkInterval = setInterval(() => {
        checkAndRun().catch((err) => {
          log.error(`[purpose-research] Check failed: ${err}`);
        });
      }, config.checkIntervalMs);

      setTimeout(() => {
        checkAndRun().catch((err) => {
          log.error(`[purpose-research] Initial check failed: ${err}`);
        });
      }, 5000);

      log.info("[purpose-research] 🔬 Scheduler active");
    },

    stop: () => {
      log.info("[purpose-research] Stopping");
      if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
      }
    },

    getDailyRunCount: () => dailyRuns.count,
    getDailyCap: () => config.dailyRunCap,

    forceRun: async (purposeId: string) => {
      const purposes = await loadPurposes();
      const purpose = purposes.find((p) => p.id === purposeId);
      if (!purpose) throw new Error(`Purpose "${purposeId}" not found`);
      await runResearch(purpose);
    },

    getStatus: () => {
      return {
        enabled: config.enabled,
        dailyRuns: dailyRuns.count,
        dailyCap: config.dailyRunCap,
        activePurposes: cachedActivePurposeCount,
      };
    },
  };
}
