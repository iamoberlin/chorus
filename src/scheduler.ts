/**
 * CHORUS Choir Scheduler
 *
 * Executes choirs on schedule, manages illumination flow.
 * Each choir runs at its defined frequency, with context passing between them.
 */

import type { OpenClawPluginService, PluginLogger } from "openclaw/plugin-sdk";
import type { ChorusConfig } from "./config.js";
import { CHOIRS, shouldRunChoir, CASCADE_ORDER, type Choir } from "./choirs.js";
import { recordExecution, type ChoirExecution } from "./metrics.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { spawn } from "child_process";

// Type for the plugin API's runAgentTurn method
interface AgentTurnResult {
  text?: string;
  payloads?: Array<{ text?: string; mediaUrl?: string | null }>;
  meta?: { durationMs?: number };
}

// ── Message delivery ────────────────────────────────────────
// Choirs that should always deliver their output to the human
const ALWAYS_DELIVER_CHOIRS = new Set(["archangels"]);

// Choirs that deliver when output contains alert signals
const ALERT_DELIVER_CHOIRS = new Set(["powers", "principalities", "virtues", "seraphim"]);

// Patterns that indicate alert-worthy output
const ALERT_PATTERNS = [
  /\balert\b/i,
  /\burgent\b/i,
  /\bimmediate\s+attention\b/i,
  /\btext\s+brandon\b/i,
  /\bnotif(?:y|ied|ication)\b/i,
  /🔴|⚠️|🚨/,
  /\bthesis\s+(?:challenged|broken|invalidated)\b/i,
  /\bposition\s+(?:at\s+risk|threatened)\b/i,
];

// Quiet hours: 11pm-7am ET — only truly urgent alerts
function isQuietHours(): boolean {
  // Use Intl to get the actual ET hour (handles EST/EDT correctly)
  const etHour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: "America/New_York",
    }).format(new Date()),
    10
  );
  return etHour >= 23 || etHour < 7;
}

function hasAlertSignals(output: string): boolean {
  return ALERT_PATTERNS.some(p => p.test(output));
}

function truncateForSms(text: string, maxLen = 1500): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "\n…(truncated)";
}

async function maybeDeliverOutput(choir: Choir, output: string, log: PluginLogger): Promise<void> {
  // Skip empty/trivial outputs
  if (!output || output.length < 20) return;
  // Skip HEARTBEAT_OK or NO_REPLY
  if (/^(HEARTBEAT_OK|NO_REPLY)\s*$/i.test(output.trim())) return;

  const shouldDeliver =
    ALWAYS_DELIVER_CHOIRS.has(choir.id) ||
    (ALERT_DELIVER_CHOIRS.has(choir.id) && hasAlertSignals(output));

  if (!shouldDeliver) return;

  // Respect quiet hours for non-urgent
  if (isQuietHours() && !(/🔴|🚨|\burgent\b/i.test(output))) {
    log.info(`[chorus] Suppressing ${choir.name} delivery during quiet hours`);
    return;
  }

  const header = `${choir.emoji} ${choir.name}`;
  const message = `${header}\n\n${truncateForSms(output)}`;

  try {
    // Use imsg CLI to deliver (same as the channel config)
    const imsgResult = await new Promise<{ status: number | null; stderr: string }>((resolve) => {
      const child = spawn('imsg', ['send', '--to', 'REDACTED_PHONE', '--text', message], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      const timer = setTimeout(() => { child.kill('SIGTERM'); }, 15000);
      child.on('close', (code) => { clearTimeout(timer); resolve({ status: code, stderr }); });
      child.on('error', (err) => { clearTimeout(timer); resolve({ status: 1, stderr: String(err) }); });
    });

    if (imsgResult.status === 0) {
      log.info(`[chorus] 📨 Delivered ${choir.name} output via iMessage`);
    } else {
      log.warn(`[chorus] Failed to deliver ${choir.name}: ${imsgResult.stderr.slice(0, 100)}`);
    }
  } catch (err) {
    log.error(`[chorus] Delivery error for ${choir.name}: ${err}`);
  }
}

interface ChoirContext {
  choirId: string;
  output: string;
  timestamp: Date;
}

interface ChoirRunState {
  lastRun?: Date;
  lastOutput?: string;
  runCount: number;
}

// State persistence path
const CHORUS_DIR = join(homedir(), ".chorus");
const RUN_STATE_PATH = join(CHORUS_DIR, "run-state.json");

// Load persisted run state from disk
function loadRunState(log: PluginLogger): Map<string, ChoirRunState> {
  const state = new Map<string, ChoirRunState>();
  
  // Initialize all choirs with default state
  for (const choirId of Object.keys(CHOIRS)) {
    state.set(choirId, { runCount: 0 });
  }
  
  // Try to load persisted state
  if (existsSync(RUN_STATE_PATH)) {
    try {
      const data = JSON.parse(readFileSync(RUN_STATE_PATH, "utf-8"));
      for (const [choirId, saved] of Object.entries(data)) {
        const s = saved as any;
        if (state.has(choirId)) {
          state.set(choirId, {
            lastRun: s.lastRun ? new Date(s.lastRun) : undefined,
            lastOutput: s.lastOutput,
            runCount: s.runCount || 0,
          });
        }
      }
      log.info(`[chorus] Loaded run state from disk (${Object.keys(data).length} choirs)`);
    } catch (err) {
      log.warn(`[chorus] Failed to load run state: ${err}`);
    }
  }
  
  return state;
}

// Save run state to disk
function saveRunState(state: Map<string, ChoirRunState>, log: PluginLogger): void {
  try {
    // Ensure directory exists
    if (!existsSync(CHORUS_DIR)) {
      mkdirSync(CHORUS_DIR, { recursive: true });
    }
    
    const obj: Record<string, any> = {};
    for (const [choirId, s] of state) {
      obj[choirId] = {
        lastRun: s.lastRun?.toISOString(),
        lastOutput: s.lastOutput,
        runCount: s.runCount,
      };
    }
    writeFileSync(RUN_STATE_PATH, JSON.stringify(obj, null, 2));
  } catch (err) {
    log.error(`[chorus] Failed to save run state: ${err}`);
  }
}

export function createChoirScheduler(
  config: ChorusConfig,
  log: PluginLogger,
  api: any // OpenClawPluginApi
): OpenClawPluginService {
  let checkInterval: NodeJS.Timeout | null = null;
  const contextStore: Map<string, ChoirContext> = new Map();
  
  // Load persisted state instead of starting fresh
  const runState = loadRunState(log);

  // CLI fallback for executing choirs when plugin API is unavailable
  async function executeChoirViaCli(choir: Choir, prompt: string): Promise<string> {
    const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn('openclaw', [
        'agent',
        '--session-id', `chorus:${choir.id}`,
        '--message', prompt,
        '--json',
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';
      const maxBuffer = 1024 * 1024;
      child.stdout.on('data', (d: Buffer) => { if (stdout.length < maxBuffer) stdout += d.toString(); });
      child.stderr.on('data', (d: Buffer) => { if (stderr.length < maxBuffer) stderr += d.toString(); });

      const timer = setTimeout(() => { child.kill('SIGTERM'); }, 300000); // 5 min
      child.on('close', (code) => { clearTimeout(timer); resolve({ status: code, stdout, stderr }); });
      child.on('error', (err) => { clearTimeout(timer); resolve({ status: 1, stdout: '', stderr: String(err) }); });
    });

    if (result.status === 0 && result.stdout) {
      const stdout = result.stdout;
      // Find the last top-level JSON object (skip plugin log noise)
      for (let i = stdout.length - 1; i >= 0; i--) {
        if (stdout[i] === '{') {
          try {
            const parsed = JSON.parse(stdout.slice(i));
            return parsed.response ||
              parsed.content ||
              parsed.result?.payloads?.slice(-1)?.[0]?.text ||
              parsed.result?.text ||
              (typeof parsed.result === "string" ? parsed.result : null) ||
              stdout;
          } catch { /* keep searching */ }
        }
      }
      return stdout;
    }

    if (result.stderr) {
      log.warn(`[chorus] ${choir.name} CLI stderr: ${result.stderr.slice(0, 200)}`);
    }
    return "(no response)";
  }

  // Build the prompt with context injected
  function buildPrompt(choir: Choir): string {
    let prompt = choir.prompt;

    // Replace context placeholders
    for (const upstreamId of choir.receivesFrom) {
      const placeholder = `{${upstreamId}_context}`;
      const ctx = contextStore.get(upstreamId);
      const contextText = ctx ? ctx.output : "(awaiting context from " + upstreamId + ")";
      prompt = prompt.replace(placeholder, contextText);
    }

    return prompt;
  }

  // Execute a choir using the plugin API (fast, in-process) with CLI fallback
  async function executeChoir(choir: Choir): Promise<void> {
    const state = runState.get(choir.id) || { runCount: 0 };
    const startTime = Date.now();

    log.info(`[chorus] ${choir.emoji} Executing ${choir.name} (run #${state.runCount + 1})`);

    const execution: ChoirExecution = {
      choirId: choir.id,
      timestamp: new Date().toISOString(),
      durationMs: 0,
      success: false,
      outputLength: 0,
    };

    try {
      const prompt = buildPrompt(choir);
      let output = "(no response)";

      // Prefer plugin API (in-process, no CLI spawn overhead)
      if (typeof api.runAgentTurn === 'function') {
        try {
          const result: AgentTurnResult = await api.runAgentTurn({
            sessionLabel: `chorus:${choir.id}`,
            message: prompt,
            isolated: true,
            timeoutSeconds: 300,
          });

          // Extract text from payloads — concatenate all payload texts
          const payloadTexts = (result?.payloads || [])
            .map((p: any) => p?.text || '')
            .filter((t: string) => t.length > 0);

          if (payloadTexts.length > 0) {
            // Use the last substantive payload (earlier ones are often thinking-out-loud)
            output = payloadTexts[payloadTexts.length - 1];
          } else if (result?.text) {
            output = result.text;
          }
        } catch (apiErr) {
          log.warn(`[chorus] API runAgentTurn failed for ${choir.name}, falling back to CLI: ${apiErr}`);
          output = await executeChoirViaCli(choir, prompt);
        }
      } else {
        // Fallback: spawn CLI process
        output = await executeChoirViaCli(choir, prompt);
      }

      execution.durationMs = Date.now() - startTime;
      execution.success = output !== "(no response)";
      execution.outputLength = output.length;
      execution.tokensUsed = estimateTokens(output);

      // Parse output for metrics (findings, alerts, improvements)
      execution.findings = countFindings(output);
      execution.alerts = countAlerts(output);
      execution.improvements = extractImprovements(output, choir.id);

      // Store context for downstream choirs
      contextStore.set(choir.id, {
        choirId: choir.id,
        output: output.slice(0, 2000), // Truncate for context passing
        timestamp: new Date(),
      });

      // Update run state
      runState.set(choir.id, {
        lastRun: new Date(),
        lastOutput: output.slice(0, 500),
        runCount: state.runCount + 1,
      });
      
      // Persist state to disk after each run
      saveRunState(runState, log);

      log.info(`[chorus] ${choir.emoji} ${choir.name} completed (${(execution.durationMs/1000).toFixed(1)}s)`);

      // Deliver output to human if choir warrants it
      await maybeDeliverOutput(choir, output, log);

      // Log illumination flow
      if (choir.passesTo.length > 0) {
        log.debug(`[chorus] Illumination ready for: ${choir.passesTo.join(", ")}`);
      }

    } catch (error) {
      execution.durationMs = Date.now() - startTime;
      execution.success = false;
      execution.error = String(error);
      log.error(`[chorus] ${choir.name} failed: ${error}`);
    }

    // Record metrics
    recordExecution(execution);
  }

  // Estimate tokens from output length (rough: 1 token ≈ 4 chars)
  function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  // Count research findings in output
  function countFindings(output: string): number {
    const patterns = [
      /found\s+(\d+)\s+(?:papers?|articles?|findings?)/gi,
      /(\d+)\s+(?:new|notable)\s+(?:papers?|findings?)/gi,
      /key\s+findings?:/gi,
      /\*\*finding/gi,
    ];
    let count = 0;
    for (const pattern of patterns) {
      const matches = output.match(pattern);
      if (matches) count += matches.length;
    }
    return count;
  }

  // Count alerts in output
  function countAlerts(output: string): number {
    const patterns = [
      /\balert\b/gi,
      /\bnotif(?:y|ied|ication)\b/gi,
      /\burgent\b/gi,
      /\bimmediate\s+attention\b/gi,
    ];
    let count = 0;
    for (const pattern of patterns) {
      const matches = output.match(pattern);
      if (matches) count += matches.length;
    }
    return Math.min(count, 5); // Cap at 5 to avoid false positives
  }

  // Extract improvements from RSI (Virtues) output
  function extractImprovements(output: string, choirId: string): string[] {
    if (choirId !== "virtues") return [];
    const improvements: string[] = [];
    const patterns = [
      /implemented[:\s]+([^\n.]+)/gi,
      /improved[:\s]+([^\n.]+)/gi,
      /created[:\s]+([^\n.]+)/gi,
      /updated[:\s]+([^\n.]+)/gi,
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(output)) !== null) {
        const item = match[1].trim().slice(0, 50);
        if (item.length > 5) improvements.push(item);
      }
    }
    return improvements.slice(0, 5); // Cap at 5
  }

  // Check and run due choirs
  async function checkAndRunChoirs(): Promise<void> {
    const now = new Date();

    // Check choirs in cascade order (important for illumination flow)
    for (const choirId of CASCADE_ORDER) {
      const choir = CHOIRS[choirId];
      if (!choir) continue;

      // Check if enabled
      if (config.choirs.overrides[choirId] === false) {
        continue;
      }

      // Check if due based on interval
      const state = runState.get(choirId);
      if (shouldRunChoir(choir, now, state?.lastRun)) {
        await executeChoir(choir);
      }
    }
  }

  return {
    id: "chorus-scheduler",

    start: () => {
      if (!config.choirs.enabled) {
        log.info("[chorus] Choir scheduler disabled (enable in openclaw.yaml)");
        return;
      }

      log.info("[chorus] 🎵 Starting Nine Choirs scheduler");
      log.info("[chorus] Frequencies: Seraphim 1×/day → Angels 48×/day");

      // Check for due choirs every minute
      checkInterval = setInterval(() => {
        checkAndRunChoirs().catch((err) => {
          log.error(`[chorus] Scheduler error: ${err}`);
        });
      }, 60 * 1000);

      // Run initial check after a short delay
      setTimeout(() => {
        log.info("[chorus] Running initial choir check...");
        checkAndRunChoirs().catch((err) => {
          log.error(`[chorus] Initial check error: ${err}`);
        });
      }, 5000);

      log.info("[chorus] 🎵 Scheduler active");
    },

    stop: () => {
      log.info("[chorus] Stopping choir scheduler");
      if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
      }
      contextStore.clear();
    },
  };
}
