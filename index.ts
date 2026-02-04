/**
 * CHORUS Extension
 *
 * CHORUS: Hierarchy Of Recursive Unified Self-improvement
 * Recursive illumination through the Nine Choirs.
 * Config via openclaw.yaml: plugins.entries.chorus.config
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { spawnSync } from "child_process";
import { loadChorusConfig, type ChorusPluginConfig } from "./src/config.js";
import { createSecurityHooks } from "./src/security.js";
import { createChoirScheduler } from "./src/scheduler.js";
import { CHOIRS, formatFrequency } from "./src/choirs.js";
import {
  getTodayMetrics,
  getMetricsForDate,
  getRecentMetrics,
  getTotals,
  setQualityScore,
  formatMetricsSummary,
  formatWeeklySummary,
} from "./src/metrics.js";
import { createDaemon, DEFAULT_DAEMON_CONFIG, type DaemonConfig } from "./src/daemon.js";
import { getInboxPath } from "./src/senses.js";
import {
  loadGoals,
  addGoal,
  updateGoal,
  removeGoal,
  formatGoalsList,
} from "./src/goals.js";
import {
  createGoalResearchScheduler,
  DEFAULT_GOAL_RESEARCH_CONFIG,
  type GoalResearchConfig,
} from "./src/goal-research.js";

const VERSION = "1.0.3";

const plugin = {
  id: "chorus",
  name: "CHORUS",
  description: "CHORUS: Hierarchy Of Recursive Unified Self-improvement",

  register(api: OpenClawPluginApi) {
    // Standard OpenClaw config: plugins.entries.chorus.config
    const pluginConfig = api.config.plugins?.entries?.chorus?.config as ChorusPluginConfig | undefined;
    const config = loadChorusConfig(pluginConfig);

    api.logger.info(`[chorus] 🎵 CHORUS v${VERSION}`);

    // Register security hooks (Powers choir handles security)
    createSecurityHooks(api, config);

    // Register choir scheduler service
    if (config.choirs.enabled) {
      api.registerService(createChoirScheduler(config, api.logger, api));
      api.logger.info("[chorus] Choirs enabled — scheduler registered");
    } else {
      api.logger.info("[chorus] Choirs disabled — set enabled: true in openclaw.yaml");
    }

    // Register daemon service
    const daemonConfig: DaemonConfig = {
      ...DEFAULT_DAEMON_CONFIG,
      enabled: (pluginConfig as any)?.daemon?.enabled ?? true,
      ...(pluginConfig as any)?.daemon,
    };
    
    let daemon: ReturnType<typeof createDaemon> | null = null;
    if (daemonConfig.enabled) {
      daemon = createDaemon(daemonConfig, api.logger, api);
      api.registerService(daemon);
      api.logger.info("[chorus] Daemon enabled — autonomous attention active");
    } else {
      api.logger.info("[chorus] Daemon disabled");
    }

    // Register goal research service
    const goalResearchConfig: GoalResearchConfig = {
      ...DEFAULT_GOAL_RESEARCH_CONFIG,
      enabled: config.goalResearch.enabled,
      dailyRunCap: config.goalResearch.dailyRunCap,
      defaultFrequency: config.goalResearch.defaultFrequency,
      defaultMaxFrequency: config.goalResearch.defaultMaxFrequency,
    };

    let goalResearch: ReturnType<typeof createGoalResearchScheduler> | null = null;
    if (goalResearchConfig.enabled) {
      goalResearch = createGoalResearchScheduler(goalResearchConfig, api.logger, api);
      api.registerService(goalResearch);
      api.logger.info("[chorus] Goal research enabled — adaptive frequency active");
    } else {
      api.logger.info("[chorus] Goal research disabled");
    }

    // Register CLI
    api.registerCli((ctx) => {
      const program = ctx.program.command("chorus").description("CHORUS Nine Choirs management");

      // Status command
      program.command("status").description("Show CHORUS status").action(async () => {
        const goals = await loadGoals();
        const activeGoals = goals.filter(g => g.progress < 100);
        const researchGoals = goals.filter(g => 
          g.progress < 100 && 
          g.research?.enabled !== false && 
          (g.criteria?.length || g.research?.domains?.length)
        );
        
        console.log("");
        console.log("🎵 CHORUS — Hierarchy Of Recursive Unified Self-improvement");
        console.log("═".repeat(55));
        console.log("");
        console.log(`  Version:        ${VERSION}`);
        console.log(`  Choirs:         ${config.choirs.enabled ? "✅ enabled" : "❌ disabled"}`);
        console.log(`  Daemon:         ${daemonConfig.enabled ? "✅ enabled" : "❌ disabled"}`);
        console.log(`  Goal Research:  ${goalResearchConfig.enabled ? "✅ enabled" : "❌ disabled"}`);
        console.log(`  Active Goals:   ${activeGoals.length}`);
        console.log(`  Research Goals: ${researchGoals.length}`);
        if (daemon) {
          console.log(`  Attention Queue: ${daemon.getQueueSize()} items`);
        }
        if (goalResearch) {
          console.log(`  Research Runs:  ${goalResearch.getDailyRunCount()}/${goalResearch.getDailyCap()} today`);
        }
        console.log(`  Timezone:       ${config.choirs.timezone}`);
        console.log("");
        
        if (!config.choirs.enabled && !daemonConfig.enabled && !goalResearchConfig.enabled) {
          console.log("  💡 Enable choirs, daemon, or goalResearch in openclaw.yaml");
          console.log("");
        }
      });

      // List choirs command
      program.command("list").description("List all choirs and their schedules").action(() => {
        console.log("");
        console.log("🎵 Nine Choirs");
        console.log("═".repeat(50));
        console.log("");
        console.log("FIRST TRIAD — Contemplation");
        console.log("─".repeat(50));
        printChoir("seraphim", config);
        printChoir("cherubim", config);
        printChoir("thrones", config);
        console.log("");
        console.log("SECOND TRIAD — Governance");
        console.log("─".repeat(50));
        printChoir("dominions", config);
        printChoir("virtues", config);
        printChoir("powers", config);
        console.log("");
        console.log("THIRD TRIAD — Action");
        console.log("─".repeat(50));
        printChoir("principalities", config);
        printChoir("archangels", config);
        printChoir("angels", config);
        console.log("");
      });

      // Run a specific choir manually (or all if none specified)
      program
        .command("run [choir]")
        .description("Manually trigger a choir (or all choirs if none specified)")
        .option("--preview", "Preview prompt without running")
        .action(async (choirId?: string, options?: { preview?: boolean }) => {
          const choirsToRun = choirId 
            ? [choirId] 
            : ["seraphim", "cherubim", "thrones", "dominions", "virtues", "powers", "principalities", "archangels", "angels"];
          
          if (choirId) {
            const choir = CHOIRS[choirId];
            if (!choir) {
              console.error(`Unknown choir: ${choirId}`);
              console.log("Available: seraphim, cherubim, thrones, dominions, virtues, powers, principalities, archangels, angels");
              return;
            }
          }

          console.log("");
          if (!choirId) {
            console.log("🎵 Running all Nine Choirs in cascade order...");
            console.log("");
          }

          for (const id of choirsToRun) {
            const choir = CHOIRS[id];
            if (!choir) continue;
            
            console.log(`Running ${choir.name}...`);
          
            // Preview mode - just show the prompt
            if (options?.preview) {
              console.log(`  Prompt: ${choir.prompt.slice(0, 100)}...`);
              continue;
            }

            // Try gateway-connected runAgentTurn first (available when loaded as plugin)
            if (typeof api.runAgentTurn === 'function') {
              try {
                const result = await api.runAgentTurn({
                  sessionLabel: `chorus:${id}`,
                  message: choir.prompt,
                  isolated: true,
                  timeoutSeconds: 300,
                });
                console.log(`  ✓ ${choir.name} complete`);
              } catch (err) {
                console.error(`  ✗ ${choir.name} failed:`, err);
              }
            } else {
              // CLI context: use openclaw agent for direct execution via gateway
              try {
                const result = spawnSync('openclaw', [
                  'agent',
                  '--session-id', `chorus:${id}`,
                  '--message', choir.prompt,
                  '--json',
                ], {
                  encoding: 'utf-8',
                  timeout: 300000, // 5 min
                });
                
                if (result.status === 0) {
                  try {
                    const json = JSON.parse(result.stdout || '{}');
                    const text = json.result?.payloads?.[0]?.text || '';
                    const duration = json.result?.meta?.durationMs || 0;
                    console.log(`  ✓ ${choir.name} complete (${(duration/1000).toFixed(1)}s)`);
                    if (text) {
                      const preview = text.slice(0, 150).replace(/\n/g, ' ');
                      console.log(`    ${preview}${text.length > 150 ? '...' : ''}`);
                    }
                  } catch {
                    console.log(`  ✓ ${choir.name} complete`);
                  }
                } else {
                  const errMsg = result.stderr || result.stdout || 'Unknown error';
                  if (errMsg.includes('ECONNREFUSED') || errMsg.includes('connect')) {
                    console.log(`  ⚠ Gateway not running. Start with: openclaw gateway start`);
                  } else {
                    console.error(`  ✗ ${choir.name} failed:`, errMsg.trim().slice(0, 200));
                  }
                }
              } catch (err: any) {
                console.error(`  ✗ ${choir.name} failed:`, err.message || err);
              }
            }
          }

          console.log("");
          if (!choirId) {
            console.log("🎵 All choirs scheduled.");
          }
          console.log("");
        });

      // Metrics command
      const metricsCmd = program.command("metrics").description("View CHORUS execution metrics");

      metricsCmd
        .command("today")
        .description("Show today's metrics")
        .action(() => {
          const metrics = getTodayMetrics();
          if (!metrics) {
            console.log("\nNo metrics recorded for today yet.\n");
            return;
          }
          console.log("");
          console.log(formatMetricsSummary(metrics));
          console.log("");
        });

      metricsCmd
        .command("week")
        .description("Show weekly summary")
        .action(() => {
          console.log("");
          console.log(formatWeeklySummary());
          console.log("");
        });

      metricsCmd
        .command("date <date>")
        .description("Show metrics for a specific date (YYYY-MM-DD)")
        .action((date: string) => {
          const metrics = getMetricsForDate(date);
          if (!metrics) {
            console.log(`\nNo metrics recorded for ${date}.\n`);
            return;
          }
          console.log("");
          console.log(formatMetricsSummary(metrics));
          console.log("");
        });

      metricsCmd
        .command("rate <date> <score>")
        .description("Set quality score (1-5) for a date")
        .option("-n, --notes <notes>", "Add notes")
        .action((date: string, score: string, options: { notes?: string }) => {
          const scoreNum = parseInt(score, 10);
          if (isNaN(scoreNum) || scoreNum < 1 || scoreNum > 5) {
            console.error("Score must be 1-5");
            return;
          }
          setQualityScore(date, scoreNum, options.notes);
          console.log(`\n✓ Quality score for ${date} set to ${scoreNum}/5\n`);
        });

      metricsCmd
        .command("totals")
        .description("Show all-time totals")
        .action(() => {
          const totals = getTotals();
          console.log("");
          console.log("📊 CHORUS All-Time Totals");
          console.log("═".repeat(40));
          console.log(`  Total Runs:     ${totals.allTimeRuns.toLocaleString()}`);
          console.log(`  Successes:      ${totals.allTimeSuccesses.toLocaleString()} (${totals.allTimeRuns > 0 ? ((totals.allTimeSuccesses / totals.allTimeRuns) * 100).toFixed(1) : 0}%)`);
          console.log(`  Findings:       ${totals.allTimeFindings}`);
          console.log(`  Alerts:         ${totals.allTimeAlerts}`);
          console.log(`  Improvements:   ${totals.allTimeImprovements}`);
          console.log("");
        });

      metricsCmd
        .command("goals")
        .description("Show metrics for goal-derived research")
        .action(() => {
          const todayMetrics = getTodayMetrics();
          if (!todayMetrics) {
            console.log("\nNo metrics recorded for today yet.\n");
            return;
          }

          // Filter executions for goal-derived research
          const goalExecs = todayMetrics.executions.filter(e => e.choirId.startsWith("goal:"));
          
          console.log("");
          console.log("📊 Goal Research Metrics — Today");
          console.log("═".repeat(40));
          console.log(`  Total runs:     ${goalExecs.length}`);
          console.log(`  Successful:     ${goalExecs.filter(e => e.success).length}`);
          console.log(`  Findings:       ${goalExecs.reduce((sum, e) => sum + (e.findings || 0), 0)}`);
          console.log(`  Alerts:         ${goalExecs.reduce((sum, e) => sum + (e.alerts || 0), 0)}`);
          console.log("");

          if (goalExecs.length > 0) {
            console.log("By goal:");
            console.log("─".repeat(40));
            const byGoal = new Map<string, typeof goalExecs>();
            for (const exec of goalExecs) {
              const goalId = exec.choirId.replace("goal:", "");
              if (!byGoal.has(goalId)) byGoal.set(goalId, []);
              byGoal.get(goalId)!.push(exec);
            }
            for (const [goalId, execs] of byGoal) {
              const findings = execs.reduce((sum, e) => sum + (e.findings || 0), 0);
              const avgDuration = execs.reduce((sum, e) => sum + e.durationMs, 0) / execs.length;
              console.log(`  ${goalId}: ${execs.length} runs, ${findings} findings, ${(avgDuration/1000).toFixed(1)}s avg`);
            }
            console.log("");
          }
        });

      // Daemon commands
      const daemonCmd = program.command("daemon").description("Autonomous attention daemon");

      daemonCmd
        .command("status")
        .description("Show daemon status")
        .action(() => {
          console.log("");
          console.log("👁️ CHORUS Daemon");
          console.log("═".repeat(40));
          console.log(`  Enabled:        ${daemonConfig.enabled ? "✅ yes" : "❌ no"}`);
          console.log(`  Threshold:      ${daemonConfig.thinkThreshold}`);
          console.log(`  Poll interval:  ${daemonConfig.pollIntervalMs / 1000}s`);
          console.log(`  Quiet hours:    ${daemonConfig.quietHoursStart}:00 - ${daemonConfig.quietHoursEnd}:00`);
          console.log(`  Inbox:          ${getInboxPath()}`);
          if (daemon) {
            console.log(`  Queue size:     ${daemon.getQueueSize()}`);
          }
          console.log("");
        });

      daemonCmd
        .command("queue")
        .description("Show current attention queue")
        .action(() => {
          if (!daemon) {
            console.log("\nDaemon not running.\n");
            return;
          }
          const queue = daemon.getQueue();
          console.log("");
          console.log("👁️ Attention Queue");
          console.log("═".repeat(50));
          if (queue.length === 0) {
            console.log("  (empty)");
          } else {
            for (const item of queue) {
              console.log(`  [${item.salienceScore}] ${item.source}: ${item.content.slice(0, 60)}...`);
            }
          }
          console.log("");
        });

      daemonCmd
        .command("poll")
        .description("Force poll all senses now")
        .action(async () => {
          if (!daemon) {
            console.log("\nDaemon not running.\n");
            return;
          }
          console.log("\nPolling senses...");
          await daemon.forcePoll();
          console.log(`Queue size: ${daemon.getQueueSize()}\n`);
        });

      daemonCmd
        .command("process")
        .description("Process highest priority item now")
        .action(async () => {
          if (!daemon) {
            console.log("\nDaemon not running.\n");
            return;
          }
          const size = daemon.getQueueSize();
          if (size === 0) {
            console.log("\nQueue empty.\n");
            return;
          }
          console.log("\nProcessing top item...");
          await daemon.forceProcess();
          console.log("Done.\n");
        });

      // Research commands
      const researchCmd = program.command("research").description("Goal-derived research");

      researchCmd
        .command("status")
        .description("Show research scheduler status")
        .action(async () => {
          const goals = await loadGoals();
          const researchGoals = goals.filter(g => 
            g.progress < 100 && 
            g.research?.enabled !== false && 
            (g.criteria?.length || g.research?.domains?.length)
          );

          console.log("");
          console.log("🔬 Goal Research Status");
          console.log("═".repeat(50));
          console.log(`  Enabled:        ${goalResearchConfig.enabled ? "✅ yes" : "❌ no"}`);
          console.log(`  Daily cap:      ${goalResearchConfig.dailyRunCap}`);
          console.log(`  Default freq:   ${goalResearchConfig.defaultFrequency}/day`);
          if (goalResearch) {
            console.log(`  Today's runs:   ${goalResearch.getDailyRunCount()}/${goalResearch.getDailyCap()}`);
          }
          console.log(`  Active goals:   ${researchGoals.length}`);
          console.log("");

          if (researchGoals.length > 0) {
            console.log("Research-enabled goals:");
            console.log("─".repeat(50));
            for (const goal of researchGoals) {
              const freq = goal.research?.frequency ?? goalResearchConfig.defaultFrequency;
              const lastRun = goal.research?.lastRun
                ? new Date(goal.research.lastRun).toLocaleString()
                : "never";
              const runCount = goal.research?.runCount ?? 0;
              console.log(`  ${goal.name}`);
              console.log(`    Frequency: ${freq}/day | Last: ${lastRun} | Runs: ${runCount}`);
            }
            console.log("");
          }
        });

      researchCmd
        .command("run <goalId>")
        .description("Manually trigger research for a goal")
        .action(async (goalId: string) => {
          if (!goalResearch) {
            console.log("\nGoal research not enabled.\n");
            return;
          }
          console.log(`\nRunning research for "${goalId}"...`);
          try {
            await goalResearch.forceRun(goalId);
            console.log("Done.\n");
          } catch (err: any) {
            console.error(`\n✗ ${err.message}\n`);
          }
        });

      researchCmd
        .command("list")
        .description("List goals with research enabled")
        .action(async () => {
          const goals = await loadGoals();
          const researchGoals = goals.filter(g => 
            g.research?.enabled !== false && 
            (g.criteria?.length || g.research?.domains?.length)
          );

          console.log("");
          console.log("🔬 Research-Enabled Goals");
          console.log("═".repeat(50));

          if (researchGoals.length === 0) {
            console.log("  No goals with research enabled.");
            console.log("  Add criteria to a goal to enable research.");
          } else {
            for (const goal of researchGoals) {
              const status = goal.progress >= 100 ? "✓" : "○";
              const freq = goal.research?.frequency ?? goalResearchConfig.defaultFrequency;
              console.log(`  ${status} ${goal.name} (${freq}/day)`);
              if (goal.criteria?.length) {
                for (const c of goal.criteria.slice(0, 3)) {
                  console.log(`      • ${c}`);
                }
                if (goal.criteria.length > 3) {
                  console.log(`      ... +${goal.criteria.length - 3} more`);
                }
              }
            }
          }
          console.log("");
        });

      // Goal commands
      const goalCmd = program.command("goal").description("Manage autonomous goals");

      goalCmd
        .command("list")
        .description("List all goals")
        .action(async () => {
          const goals = await loadGoals();
          console.log("");
          console.log(formatGoalsList(goals));
          console.log("");
        });

      goalCmd
        .command("add <id> <name>")
        .description("Add a new goal")
        .option("-d, --deadline <date>", "Deadline (YYYY-MM-DD or ISO)")
        .option("-c, --criteria <items>", "Success criteria (comma-separated)")
        .option("--domains <items>", "Research domains (comma-separated)")
        .option("--frequency <n>", "Research runs per day")
        .option("--no-research", "Disable auto-research for this goal")
        .option("--curiosity <n>", "Curiosity score 0-100 (for exploration goals)")
        .action(async (id: string, name: string, options: any) => {
          try {
            const criteria = options.criteria 
              ? options.criteria.split(",").map((s: string) => s.trim()) 
              : undefined;
            const domains = options.domains
              ? options.domains.split(",").map((s: string) => s.trim())
              : undefined;

            // Build research config if criteria or domains provided
            let research = undefined;
            if (options.research === false) {
              research = { enabled: false };
            } else if (criteria?.length || domains?.length) {
              research = {
                enabled: true,
                domains,
                frequency: options.frequency ? parseInt(options.frequency) : undefined,
              };
            }

            const goal = await addGoal({
              id,
              name,
              deadline: options.deadline ? Date.parse(options.deadline) : undefined,
              criteria,
              curiosity: options.curiosity ? parseInt(options.curiosity) : undefined,
              research,
            });

            console.log(`\n✓ Goal added: ${goal.name}`);
            if (goal.research?.enabled) {
              const freq = goal.research.frequency ?? goalResearchConfig.defaultFrequency;
              console.log(`  Research: ${freq}/day`);
              if (goal.research.domains?.length) {
                console.log(`  Domains: ${goal.research.domains.join(", ")}`);
              }
            }
            console.log("");
          } catch (err: any) {
            console.error(`\n✗ ${err.message}\n`);
          }
        });

      goalCmd
        .command("progress <id> <percent>")
        .description("Update goal progress (0-100)")
        .action(async (id: string, percent: string) => {
          const progress = parseInt(percent);
          if (isNaN(progress) || progress < 0 || progress > 100) {
            console.error("\nProgress must be 0-100\n");
            return;
          }
          const goal = await updateGoal(id, { progress });
          if (goal) {
            console.log(`\n✓ ${goal.name}: ${progress}%\n`);
          } else {
            console.error(`\n✗ Goal "${id}" not found\n`);
          }
        });

      goalCmd
        .command("done <id>")
        .description("Mark goal as complete (100%)")
        .action(async (id: string) => {
          const goal = await updateGoal(id, { progress: 100 });
          if (goal) {
            console.log(`\n✓ ${goal.name}: Complete!\n`);
          } else {
            console.error(`\n✗ Goal "${id}" not found\n`);
          }
        });

      goalCmd
        .command("remove <id>")
        .description("Remove a goal")
        .action(async (id: string) => {
          const removed = await removeGoal(id);
          if (removed) {
            console.log(`\n✓ Goal "${id}" removed\n`);
          } else {
            console.error(`\n✗ Goal "${id}" not found\n`);
          }
        });

      goalCmd
        .command("research <id>")
        .description("Configure research for a goal")
        .option("--enable", "Enable research")
        .option("--disable", "Disable research")
        .option("--domains <items>", "Set research domains (comma-separated)")
        .option("--frequency <n>", "Set research frequency (runs/day)")
        .option("--criteria <items>", "Set success criteria (comma-separated)")
        .action(async (id: string, options: any) => {
          const goals = await loadGoals();
          const goal = goals.find(g => g.id === id);
          if (!goal) {
            console.error(`\n✗ Goal "${id}" not found\n`);
            return;
          }

          const updates: any = {};

          if (options.criteria) {
            updates.criteria = options.criteria.split(",").map((s: string) => s.trim());
          }

          const researchUpdates: any = { ...goal.research };

          if (options.enable) {
            researchUpdates.enabled = true;
          } else if (options.disable) {
            researchUpdates.enabled = false;
          }

          if (options.domains) {
            researchUpdates.domains = options.domains.split(",").map((s: string) => s.trim());
          }

          if (options.frequency) {
            researchUpdates.frequency = parseInt(options.frequency);
          }

          updates.research = researchUpdates;

          const updated = await updateGoal(id, updates);
          if (updated) {
            console.log(`\n✓ ${updated.name} research config updated`);
            if (updated.research?.enabled === false) {
              console.log("  Research: disabled");
            } else {
              const freq = updated.research?.frequency ?? goalResearchConfig.defaultFrequency;
              console.log(`  Research: ${freq}/day`);
              if (updated.research?.domains?.length) {
                console.log(`  Domains: ${updated.research.domains.join(", ")}`);
              }
            }
            console.log("");
          }
        });

      // Inbox command (shortcut)
      program
        .command("inbox")
        .description("Show inbox path for daemon signals")
        .action(() => {
          console.log(`\nDrop files here to trigger daemon attention:\n  ${getInboxPath()}\n`);
        });

    }, { commands: ["chorus"] });

    api.logger.info("[chorus] 🎵 Registered");
  },
};

function printChoir(id: string, config: any) {
  const choir = CHOIRS[id];
  if (!choir) return;
  const enabled = config.choirs.overrides[id] !== false;
  const status = enabled ? "✅" : "❌";
  const freq = formatFrequency(choir).padEnd(8);
  console.log(`  ${status} ${choir.name.padEnd(16)} ${freq} ${choir.function}`);
}

export default plugin;
