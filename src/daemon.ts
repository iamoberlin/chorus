/**
 * CHORUS Daemon
 *
 * Autonomous attention loop that monitors senses,
 * filters for salience, and invokes cognition when needed.
 */

import type { PluginLogger } from "openclaw/plugin-sdk";
import type { Signal, Sense } from "./senses.js";
import { ALL_SENSES } from "./senses.js";
import { SalienceFilter, defaultFilter } from "./salience.js";
import { recordExecution, type ChoirExecution } from "./metrics.js";

export interface DaemonConfig {
  enabled: boolean;
  senses: {
    inbox: boolean;
    goals: boolean;
    time: boolean;
  };
  thinkThreshold: number;    // Minimum priority to invoke cognition
  pollIntervalMs: number;    // How often to poll senses
  minSleepMs: number;        // Minimum sleep between cycles
  maxSleepMs: number;        // Maximum sleep (night/idle)
  quietHoursStart: number;   // Hour to start quiet mode (e.g., 23)
  quietHoursEnd: number;     // Hour to end quiet mode (e.g., 7)
}

export const DEFAULT_DAEMON_CONFIG: DaemonConfig = {
  enabled: true,
  senses: {
    inbox: true,
    goals: true,
    time: true,
  },
  thinkThreshold: 55,
  pollIntervalMs: 5 * 60 * 1000,  // 5 minutes
  minSleepMs: 30 * 1000,          // 30 seconds
  maxSleepMs: 10 * 60 * 1000,     // 10 minutes
  quietHoursStart: 23,
  quietHoursEnd: 7,
};

interface AttentionItem extends Signal {
  salienceScore: number;
  rulesApplied: string[];
}

export function createDaemon(
  config: DaemonConfig,
  log: PluginLogger,
  api: any  // OpenClawPluginApi
) {
  const filter = new SalienceFilter([], config.thinkThreshold);
  const attentionQueue: AttentionItem[] = [];
  const cleanupFns: (() => void)[] = [];
  
  let pollInterval: NodeJS.Timeout | null = null;
  let running = false;

  // Get enabled senses
  function getEnabledSenses(): Sense[] {
    return ALL_SENSES.filter(sense => {
      if (sense.id === "inbox" && !config.senses.inbox) return false;
      if (sense.id === "goals" && !config.senses.goals) return false;
      if (sense.id === "time" && !config.senses.time) return false;
      return true;
    });
  }

  // Process a signal through salience filter
  function processSignal(signal: Signal): void {
    const result = filter.evaluate(signal);
    
    log.debug(
      `[daemon] Signal: "${signal.content.slice(0, 50)}..." ` +
      `(${signal.priority} → ${result.finalPriority}, rules: ${result.rulesApplied.join(",")})`
    );

    if (result.shouldAttend) {
      attentionQueue.push({
        ...signal,
        salienceScore: result.finalPriority,
        rulesApplied: result.rulesApplied,
      });
      
      log.info(
        `[daemon] 👁️ Queued: "${signal.content.slice(0, 60)}..." (priority: ${result.finalPriority})`
      );
    }
  }

  // Poll all senses
  async function pollSenses(): Promise<void> {
    for (const sense of getEnabledSenses()) {
      if (sense.poll) {
        try {
          const signals = await sense.poll();
          for (const signal of signals) {
            processSignal(signal);
          }
        } catch (err) {
          log.error(`[daemon] Sense ${sense.id} poll failed: ${err}`);
        }
      }
    }
  }

  // Start watchers for event-based senses
  function startWatchers(): void {
    for (const sense of getEnabledSenses()) {
      if (sense.watch) {
        try {
          const cleanup = sense.watch(processSignal);
          cleanupFns.push(cleanup);
          log.info(`[daemon] 👁️ Watching: ${sense.description}`);
        } catch (err) {
          log.error(`[daemon] Sense ${sense.id} watch failed: ${err}`);
        }
      }
    }
  }

  // Process the highest priority item in queue
  async function processQueue(): Promise<void> {
    if (attentionQueue.length === 0) return;

    // Sort by salience score (highest first)
    attentionQueue.sort((a, b) => b.salienceScore - a.salienceScore);
    
    const item = attentionQueue.shift()!;
    const startTime = Date.now();

    log.info(`[daemon] 🧠 Attending: "${item.content.slice(0, 80)}..." (priority: ${item.salienceScore})`);

    // Build prompt for cognition
    const prompt = buildAttentionPrompt(item);

    const execution: ChoirExecution = {
      choirId: "daemon",
      timestamp: new Date().toISOString(),
      durationMs: 0,
      success: false,
      outputLength: 0,
    };

    try {
      const result = await api.runAgentTurn?.({
        sessionLabel: "chorus:daemon",
        message: prompt,
        isolated: true,
        timeoutSeconds: 180,
      });

      execution.durationMs = Date.now() - startTime;
      execution.success = true;
      execution.outputLength = result?.response?.length || 0;
      execution.tokensUsed = result?.meta?.tokensUsed;

      log.info(`[daemon] ✓ Completed in ${(execution.durationMs / 1000).toFixed(1)}s`);

    } catch (err) {
      execution.durationMs = Date.now() - startTime;
      execution.success = false;
      execution.error = String(err);
      log.error(`[daemon] ✗ Failed: ${err}`);
    }

    // Record metrics
    recordExecution(execution);
  }

  function buildAttentionPrompt(item: AttentionItem): string {
    const parts = [
      "## DAEMON ATTENTION SIGNAL",
      "",
      `**Source:** ${item.source}`,
      `**Priority:** ${item.salienceScore}/100`,
      `**Time:** ${item.timestamp.toISOString()}`,
      "",
      "**Content:**",
      item.content,
      "",
    ];

    if (item.metadata && Object.keys(item.metadata).length > 0) {
      parts.push("**Metadata:**");
      parts.push("```json");
      parts.push(JSON.stringify(item.metadata, null, 2));
      parts.push("```");
      parts.push("");
    }

    parts.push("---");
    parts.push("");
    parts.push("Evaluate this signal. Determine if action is needed.");
    parts.push("");
    parts.push("If action needed:");
    parts.push("- Take the action directly (update files, send messages, etc.)");
    parts.push("- Log what you did in today's memory file");
    parts.push("");
    parts.push("If no action needed:");
    parts.push("- Briefly explain why and move on");
    parts.push("");
    parts.push("Be concise. This is autonomous processing, not a conversation.");

    return parts.join("\n");
  }

  // Calculate adaptive sleep time
  function calculateSleepTime(): number {
    const hour = new Date().getHours();
    const isQuietHours = hour >= config.quietHoursStart || hour < config.quietHoursEnd;

    // Check queue pressure
    const queuePressure = attentionQueue.length > 0
      ? Math.max(...attentionQueue.map(i => i.salienceScore))
      : 0;

    if (queuePressure > 80) return config.minSleepMs;
    if (queuePressure > 60) return config.minSleepMs * 2;
    if (isQuietHours) return config.maxSleepMs;
    
    return config.pollIntervalMs;
  }

  // Main daemon service
  return {
    id: "chorus-daemon",

    start: () => {
      if (!config.enabled) {
        log.info("[daemon] Disabled in config");
        return;
      }

      running = true;
      log.info("[daemon] 🌅 Daemon starting...");

      // Start event watchers
      startWatchers();

      // Initial poll
      pollSenses().catch(err => log.error(`[daemon] Initial poll failed: ${err}`));

      // Periodic polling
      pollInterval = setInterval(async () => {
        if (!running) return;

        try {
          await pollSenses();
          await processQueue();
        } catch (err) {
          log.error(`[daemon] Cycle error: ${err}`);
        }
      }, config.pollIntervalMs);

      log.info(`[daemon] 👁️ Active — polling every ${config.pollIntervalMs / 1000}s, threshold: ${config.thinkThreshold}`);
    },

    stop: () => {
      running = false;
      log.info("[daemon] Stopping...");

      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }

      for (const cleanup of cleanupFns) {
        try {
          cleanup();
        } catch {}
      }
      cleanupFns.length = 0;

      attentionQueue.length = 0;
      log.info("[daemon] Stopped");
    },

    // Expose for CLI
    getQueueSize: () => attentionQueue.length,
    getQueue: () => [...attentionQueue],
    forceProcess: () => processQueue(),
    forcePoll: () => pollSenses(),
  };
}
