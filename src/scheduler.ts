/**
 * CHORUS Choir Scheduler
 *
 * Executes choirs on schedule, manages illumination flow.
 */

import type { OpenClawPluginService, PluginLogger } from "openclaw/plugin-sdk";
import type { ChorusConfig } from "./config.js";
import { CHOIRS, shouldRunChoir, type Choir } from "./choirs.js";

interface ChoirContext {
  choirId: string;
  output: string;
  timestamp: Date;
}

export function createChoirScheduler(
  config: ChorusConfig,
  log: PluginLogger,
  api: any // OpenClawPluginApi - using any to avoid import issues
): OpenClawPluginService {
  let intervals: NodeJS.Timeout[] = [];
  const contextStore: Map<string, ChoirContext> = new Map();

  // Get context from upstream choirs
  function getUpstreamContext(choir: Choir): string {
    const contexts: string[] = [];
    for (const upstreamId of choir.receivesFrom) {
      const ctx = contextStore.get(upstreamId);
      if (ctx) {
        contexts.push(`[${ctx.choirId}]: ${ctx.output}`);
      }
    }
    return contexts.length > 0 ? contexts.join("\n\n") : "(no upstream context)";
  }

  // Build the prompt with context injected
  function buildPrompt(choir: Choir): string {
    let prompt = choir.prompt;

    // Replace context placeholders
    for (const upstreamId of choir.receivesFrom) {
      const placeholder = `{${upstreamId}_context}`;
      const ctx = contextStore.get(upstreamId);
      const contextText = ctx ? ctx.output : "(no context from " + upstreamId + ")";
      prompt = prompt.replace(placeholder, contextText);
    }

    return prompt;
  }

  // Execute a choir
  async function executeChoir(choir: Choir): Promise<void> {
    log.info(`[chorus] Executing ${choir.name} (${choir.id})`);

    try {
      const prompt = buildPrompt(choir);

      // Use OpenClaw's session system to run an agent turn
      // This creates an isolated session for the choir
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

      log.info(`[chorus] ${choir.name} completed`);

      // If choir passes to others and they're due, trigger them
      for (const downstreamId of choir.passesTo) {
        const downstream = CHOIRS[downstreamId];
        if (downstream && config.choirs.overrides[downstreamId] !== false) {
          // Don't immediately trigger - let their schedule handle it
          // But mark that illumination is ready
          log.debug(`[chorus] Illumination ready for ${downstreamId}`);
        }
      }
    } catch (error) {
      log.error(`[chorus] ${choir.name} failed: ${error}`);
    }
  }

  // Check and run due choirs
  async function checkAndRunChoirs(): Promise<void> {
    const now = new Date();

    for (const [choirId, choir] of Object.entries(CHOIRS)) {
      // Check if enabled
      if (config.choirs.overrides[choirId] === false) continue;

      // Check if due
      if (shouldRunChoir(choir, now)) {
        // Avoid running the same choir multiple times in the same window
        const lastRun = contextStore.get(choirId)?.timestamp;
        if (lastRun) {
          const minutesSinceLastRun = (now.getTime() - lastRun.getTime()) / 1000 / 60;
          if (minutesSinceLastRun < 30) continue; // Don't run again within 30 min
        }

        await executeChoir(choir);
      }
    }
  }

  return {
    id: "chorus-scheduler",

    start: () => {
      if (!config.choirs.enabled) {
        log.info("[chorus] Scheduler disabled");
        return;
      }

      log.info("[chorus] Starting choir scheduler");

      // Check for due choirs every minute
      const checkInterval = setInterval(() => {
        checkAndRunChoirs().catch((err) => {
          log.error(`[chorus] Scheduler error: ${err}`);
        });
      }, 60 * 1000);

      intervals.push(checkInterval);

      // Run initial check
      checkAndRunChoirs().catch((err) => {
        log.error(`[chorus] Initial check error: ${err}`);
      });

      log.info("[chorus] Scheduler started");
    },

    stop: () => {
      log.info("[chorus] Stopping scheduler");
      for (const interval of intervals) {
        clearInterval(interval);
      }
      intervals = [];
      contextStore.clear();
    },
  };
}
