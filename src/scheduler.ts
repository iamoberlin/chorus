/**
 * CHORUS Choir Scheduler
 *
 * Executes choirs on schedule, manages illumination flow.
 * Each choir runs at its defined frequency, with context passing between them.
 */

import type { OpenClawPluginService, PluginLogger } from "openclaw/plugin-sdk";
import type { ChorusConfig } from "./config.js";
import { CHOIRS, shouldRunChoir, CASCADE_ORDER, type Choir } from "./choirs.js";

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

export function createChoirScheduler(
  config: ChorusConfig,
  log: PluginLogger,
  api: any // OpenClawPluginApi
): OpenClawPluginService {
  let checkInterval: NodeJS.Timeout | null = null;
  const contextStore: Map<string, ChoirContext> = new Map();
  const runState: Map<string, ChoirRunState> = new Map();

  // Initialize run state for all choirs
  for (const choirId of Object.keys(CHOIRS)) {
    runState.set(choirId, { runCount: 0 });
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

  // Execute a choir
  async function executeChoir(choir: Choir): Promise<void> {
    const state = runState.get(choir.id) || { runCount: 0 };

    log.info(`[chorus] ${choir.emoji} Executing ${choir.name} (run #${state.runCount + 1})`);

    try {
      const prompt = buildPrompt(choir);

      // Use OpenClaw's session system to run an agent turn
      const result = await api.runAgentTurn?.({
        sessionLabel: `chorus:${choir.id}`,
        message: prompt,
        isolated: true,
        timeoutSeconds: 300, // 5 min max
      });

      const output = result?.response || "(no response)";

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

      log.info(`[chorus] ${choir.emoji} ${choir.name} completed`);

      // Log illumination flow
      if (choir.passesTo.length > 0) {
        log.debug(`[chorus] Illumination ready for: ${choir.passesTo.join(", ")}`);
      }

    } catch (error) {
      log.error(`[chorus] ${choir.name} failed: ${error}`);
    }
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
