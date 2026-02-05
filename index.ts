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
  loadPurposes,
  addPurpose,
  updatePurpose,
  removePurpose,
  formatPurposesList,
} from "./src/purposes.js";
import {
  createPurposeResearchScheduler,
  DEFAULT_PURPOSE_RESEARCH_CONFIG,
  type PurposeResearchConfig,
} from "./src/purpose-research.js";
import * as prayers from "./src/prayers/prayers.js";
import * as prayerStore from "./src/prayers/store.js";

const VERSION = "1.2.1"; // Bug fixes: error handling, async safety

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

    // Register purpose research service
    const purposeResearchConfig: PurposeResearchConfig = {
      ...DEFAULT_PURPOSE_RESEARCH_CONFIG,
      enabled: config.purposeResearch.enabled,
      dailyRunCap: config.purposeResearch.dailyRunCap,
      defaultFrequency: config.purposeResearch.defaultFrequency,
      defaultMaxFrequency: config.purposeResearch.defaultMaxFrequency,
    };

    let purposeResearch: ReturnType<typeof createPurposeResearchScheduler> | null = null;
    if (purposeResearchConfig.enabled) {
      purposeResearch = createPurposeResearchScheduler(purposeResearchConfig, api.logger, api);
      api.registerService(purposeResearch);
      api.logger.info("[chorus] Purpose research enabled — adaptive frequency active");
    } else {
      api.logger.info("[chorus] Purpose research disabled");
    }

    // Register CLI
    api.registerCli((ctx) => {
      const program = ctx.program.command("chorus").description("CHORUS Nine Choirs management");

      // Status command
      program.command("status").description("Show CHORUS status").action(async () => {
        const purposes = await loadPurposes();
        const activePurposes = purposes.filter(p => p.progress < 100);
        const researchPurposes = purposes.filter(p => 
          p.progress < 100 && 
          p.research?.enabled !== false && 
          (p.criteria?.length || p.research?.domains?.length)
        );
        
        console.log("");
        console.log("🎵 CHORUS — Hierarchy Of Recursive Unified Self-improvement");
        console.log("═".repeat(55));
        console.log("");
        console.log(`  Version:          ${VERSION}`);
        console.log(`  Choirs:           ${config.choirs.enabled ? "✅ enabled" : "❌ disabled"}`);
        console.log(`  Daemon:           ${daemonConfig.enabled ? "✅ enabled" : "❌ disabled"}`);
        console.log(`  Purpose Research: ${purposeResearchConfig.enabled ? "✅ enabled" : "❌ disabled"}`);
        console.log(`  Active Purposes:  ${activePurposes.length}`);
        console.log(`  Research Purposes: ${researchPurposes.length}`);
        if (daemon) {
          console.log(`  Attention Queue:  ${daemon.getQueueSize()} items`);
        }
        if (purposeResearch) {
          console.log(`  Research Runs:    ${purposeResearch.getDailyRunCount()}/${purposeResearch.getDailyCap()} today`);
        }
        console.log(`  Timezone:         ${config.choirs.timezone}`);
        console.log("");
        
        if (!config.choirs.enabled && !daemonConfig.enabled && !purposeResearchConfig.enabled) {
          console.log("  💡 Enable choirs, daemon, or purposeResearch in openclaw.yaml");
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
              // CLI context: use openclaw agent via stdin to avoid arg length limits
              try {
                const result = spawnSync('openclaw', [
                  'agent',
                  '--session-id', `chorus:${id}`,
                  '--json',
                ], {
                  input: choir.prompt,
                  encoding: 'utf-8',
                  timeout: 300000, // 5 min
                  maxBuffer: 1024 * 1024, // 1MB
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

      // Vision command - simulate multiple days of cognitive cycles
      // NOTE: This is CLI-only, runs via spawned openclaw agent calls
      program
        .command("vision [days]")
        .description("Simulate multiple days of choir cycles (prophetic vision)")
        .option("--dry-run", "Show what would run without executing")
        .action((daysArg?: string, options?: { dryRun?: boolean }) => {
          // Synchronous wrapper to avoid async issues in commander
          const days = parseInt(daysArg || "1", 10);
          if (isNaN(days) || days < 1 || days > 30) {
            console.error("Days must be between 1 and 30");
            return; // Don't use process.exit - crashes gateway
          }

          const CASCADE = [
            "seraphim", "cherubim", "thrones", 
            "dominions", "virtues", "powers",
            "principalities", "archangels", "angels"
          ];
          
          // Context store for illumination passing (simplified for vision)
          const contextStore: Map<string, string> = new Map();

          console.log("");
          console.log("👁️  VISION MODE");
          console.log("═".repeat(55));
          console.log(`  Simulating ${days} day${days > 1 ? 's' : ''} of cognitive cycles`);
          console.log(`  Total choir runs: ${days * 9}`);
          console.log(`  Mode: ${options?.dryRun ? 'DRY RUN' : 'LIVE'}`);
          console.log("");

          const startTime = Date.now();
          let totalRuns = 0;
          let successfulRuns = 0;

          try {
            for (let day = 1; day <= days; day++) {
              console.log(`📅 Day ${day}/${days}`);
              console.log("─".repeat(40));

              for (const choirId of CASCADE) {
                const choir = CHOIRS[choirId];
                if (!choir) continue;

                totalRuns++;

                if (options?.dryRun) {
                  console.log(`  ${choir.emoji} ${choir.name} (would run)`);
                  contextStore.set(choirId, `[Simulated ${choir.name} output for day ${day}]`);
                  continue;
                }

                process.stdout.write(`  ${choir.emoji} ${choir.name}...`);

                try {
                  // Build a simplified prompt for vision mode
                  const visionPrompt = `You are running as ${choir.name} in VISION MODE (day ${day}/${days}).
Your role: ${choir.function}
Output: ${choir.output}

This is a simulated cognitive cycle. Provide a brief summary of what you would do/output.
Keep response under 500 words.`;

                  // Use spawnSync with stdin to avoid arg length limits
                  const result = spawnSync('openclaw', [
                    'agent',
                    '--session-id', `chorus:vision:${choirId}:d${day}`,
                    '--json',
                  ], {
                    input: visionPrompt,
                    encoding: 'utf-8',
                    timeout: 120000, // 2 min timeout per choir
                    maxBuffer: 1024 * 1024, // 1MB buffer
                  });

                  if (result.status === 0 && result.stdout) {
                    try {
                      const json = JSON.parse(result.stdout);
                      const text = json.result?.payloads?.[0]?.text || '';
                      contextStore.set(choirId, text.slice(0, 500));
                      successfulRuns++;
                      console.log(` ✓`);
                    } catch {
                      contextStore.set(choirId, `[${choir.name} completed]`);
                      successfulRuns++;
                      console.log(` ✓`);
                    }
                  } else {
                    const errMsg = (result.stderr || result.error?.message || 'unknown error').slice(0, 100);
                    console.log(` ✗ (${errMsg})`);
                  }
                } catch (err: any) {
                  console.log(` ✗ ${(err.message || 'error').slice(0, 50)}`);
                }
              }

              console.log("");
            }
          } catch (outerErr: any) {
            console.error(`\nVision error: ${outerErr.message || outerErr}`);
          }

          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log("═".repeat(55));
          console.log("👁️  VISION COMPLETE");
          console.log(`  Days simulated: ${days}`);
          console.log(`  Choir runs: ${successfulRuns}/${totalRuns}`);
          console.log(`  Duration: ${elapsed}s`);
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
        .command("purposes")
        .description("Show metrics for purpose-derived research")
        .action(() => {
          const todayMetrics = getTodayMetrics();
          if (!todayMetrics) {
            console.log("\nNo metrics recorded for today yet.\n");
            return;
          }

          // Filter executions for purpose-derived research
          const purposeExecs = todayMetrics.executions.filter(e => e.choirId.startsWith("purpose:"));
          
          console.log("");
          console.log("📊 Purpose Research Metrics — Today");
          console.log("═".repeat(40));
          console.log(`  Total runs:     ${purposeExecs.length}`);
          console.log(`  Successful:     ${purposeExecs.filter(e => e.success).length}`);
          console.log(`  Findings:       ${purposeExecs.reduce((sum, e) => sum + (e.findings || 0), 0)}`);
          console.log(`  Alerts:         ${purposeExecs.reduce((sum, e) => sum + (e.alerts || 0), 0)}`);
          console.log("");

          if (purposeExecs.length > 0) {
            console.log("By purpose:");
            console.log("─".repeat(40));
            const byPurpose = new Map<string, typeof purposeExecs>();
            for (const exec of purposeExecs) {
              const purposeId = exec.choirId.replace("purpose:", "");
              if (!byPurpose.has(purposeId)) byPurpose.set(purposeId, []);
              byPurpose.get(purposeId)!.push(exec);
            }
            for (const [purposeId, execs] of byPurpose) {
              const findings = execs.reduce((sum, e) => sum + (e.findings || 0), 0);
              const avgDuration = execs.reduce((sum, e) => sum + e.durationMs, 0) / execs.length;
              console.log(`  ${purposeId}: ${execs.length} runs, ${findings} findings, ${(avgDuration/1000).toFixed(1)}s avg`);
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
      const researchCmd = program.command("research").description("Purpose-derived research");

      researchCmd
        .command("status")
        .description("Show research scheduler status")
        .action(async () => {
          const purposes = await loadPurposes();
          const researchPurposes = purposes.filter(p => 
            p.progress < 100 && 
            p.research?.enabled !== false && 
            (p.criteria?.length || p.research?.domains?.length)
          );

          console.log("");
          console.log("🔬 Purpose Research Status");
          console.log("═".repeat(50));
          console.log(`  Enabled:        ${purposeResearchConfig.enabled ? "✅ yes" : "❌ no"}`);
          console.log(`  Daily cap:      ${purposeResearchConfig.dailyRunCap}`);
          console.log(`  Default freq:   ${purposeResearchConfig.defaultFrequency}/day`);
          if (purposeResearch) {
            console.log(`  Today's runs:   ${purposeResearch.getDailyRunCount()}/${purposeResearch.getDailyCap()}`);
          }
          console.log(`  Active purposes: ${researchPurposes.length}`);
          console.log("");

          if (researchPurposes.length > 0) {
            console.log("Research-enabled purposes:");
            console.log("─".repeat(50));
            for (const purpose of researchPurposes) {
              const freq = purpose.research?.frequency ?? purposeResearchConfig.defaultFrequency;
              const lastRun = purpose.research?.lastRun
                ? new Date(purpose.research.lastRun).toLocaleString()
                : "never";
              const runCount = purpose.research?.runCount ?? 0;
              console.log(`  ${purpose.name}`);
              console.log(`    Frequency: ${freq}/day | Last: ${lastRun} | Runs: ${runCount}`);
            }
            console.log("");
          }
        });

      researchCmd
        .command("run <purposeId>")
        .description("Manually trigger research for a purpose")
        .action(async (purposeId: string) => {
          if (!purposeResearch) {
            console.log("\nPurpose research not enabled.\n");
            return;
          }
          console.log(`\nRunning research for "${purposeId}"...`);
          try {
            await purposeResearch.forceRun(purposeId);
            console.log("Done.\n");
          } catch (err: any) {
            console.error(`\n✗ ${err.message}\n`);
          }
        });

      researchCmd
        .command("list")
        .description("List purposes with research enabled")
        .action(async () => {
          const purposes = await loadPurposes();
          const researchPurposes = purposes.filter(p => 
            p.research?.enabled !== false && 
            (p.criteria?.length || p.research?.domains?.length)
          );

          console.log("");
          console.log("🔬 Research-Enabled Purposes");
          console.log("═".repeat(50));

          if (researchPurposes.length === 0) {
            console.log("  No purposes with research enabled.");
            console.log("  Add criteria to a purpose to enable research.");
          } else {
            for (const purpose of researchPurposes) {
              const status = purpose.progress >= 100 ? "✓" : "○";
              const freq = purpose.research?.frequency ?? purposeResearchConfig.defaultFrequency;
              console.log(`  ${status} ${purpose.name} (${freq}/day)`);
              if (purpose.criteria?.length) {
                for (const c of purpose.criteria.slice(0, 3)) {
                  console.log(`      • ${c}`);
                }
                if (purpose.criteria.length > 3) {
                  console.log(`      ... +${purpose.criteria.length - 3} more`);
                }
              }
            }
          }
          console.log("");
        });

      // Purpose commands
      const purposeCmd = program.command("purpose").description("Manage autonomous purposes");

      purposeCmd
        .command("list")
        .description("List all purposes")
        .action(async () => {
          const purposes = await loadPurposes();
          console.log("");
          console.log(formatPurposesList(purposes));
          console.log("");
        });

      purposeCmd
        .command("add <id> <name>")
        .description("Add a new purpose")
        .option("-d, --deadline <date>", "Deadline (YYYY-MM-DD or ISO)")
        .option("-c, --criteria <items>", "Success criteria (comma-separated)")
        .option("--domains <items>", "Research domains (comma-separated)")
        .option("--frequency <n>", "Research runs per day")
        .option("--no-research", "Disable auto-research for this purpose")
        .option("--curiosity <n>", "Curiosity score 0-100 (for exploration purposes)")
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

            const purpose = await addPurpose({
              id,
              name,
              deadline: options.deadline ? Date.parse(options.deadline) : undefined,
              criteria,
              curiosity: options.curiosity ? parseInt(options.curiosity) : undefined,
              research,
            });

            console.log(`\n✓ Purpose added: ${purpose.name}`);
            if (purpose.research?.enabled) {
              const freq = purpose.research.frequency ?? purposeResearchConfig.defaultFrequency;
              console.log(`  Research: ${freq}/day`);
              if (purpose.research.domains?.length) {
                console.log(`  Domains: ${purpose.research.domains.join(", ")}`);
              }
            }
            console.log("");
          } catch (err: any) {
            console.error(`\n✗ ${err.message}\n`);
          }
        });

      purposeCmd
        .command("progress <id> <percent>")
        .description("Update purpose progress (0-100)")
        .action(async (id: string, percent: string) => {
          const progress = parseInt(percent);
          if (isNaN(progress) || progress < 0 || progress > 100) {
            console.error("\nProgress must be 0-100\n");
            return;
          }
          const purpose = await updatePurpose(id, { progress });
          if (purpose) {
            console.log(`\n✓ ${purpose.name}: ${progress}%\n`);
          } else {
            console.error(`\n✗ Purpose "${id}" not found\n`);
          }
        });

      purposeCmd
        .command("done <id>")
        .description("Mark purpose as complete (100%)")
        .action(async (id: string) => {
          const purpose = await updatePurpose(id, { progress: 100 });
          if (purpose) {
            console.log(`\n✓ ${purpose.name}: Complete!\n`);
          } else {
            console.error(`\n✗ Purpose "${id}" not found\n`);
          }
        });

      purposeCmd
        .command("remove <id>")
        .description("Remove a purpose")
        .action(async (id: string) => {
          const removed = await removePurpose(id);
          if (removed) {
            console.log(`\n✓ Purpose "${id}" removed\n`);
          } else {
            console.error(`\n✗ Purpose "${id}" not found\n`);
          }
        });

      purposeCmd
        .command("research <id>")
        .description("Configure research for a purpose")
        .option("--enable", "Enable research")
        .option("--disable", "Disable research")
        .option("--domains <items>", "Set research domains (comma-separated)")
        .option("--frequency <n>", "Set research frequency (runs/day)")
        .option("--criteria <items>", "Set success criteria (comma-separated)")
        .action(async (id: string, options: any) => {
          const purposes = await loadPurposes();
          const purpose = purposes.find(p => p.id === id);
          if (!purpose) {
            console.error(`\n✗ Purpose "${id}" not found\n`);
            return;
          }

          const updates: any = {};

          if (options.criteria) {
            updates.criteria = options.criteria.split(",").map((s: string) => s.trim());
          }

          const researchUpdates: any = { ...purpose.research };

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

          const updated = await updatePurpose(id, updates);
          if (updated) {
            console.log(`\n✓ ${updated.name} research config updated`);
            if (updated.research?.enabled === false) {
              console.log("  Research: disabled");
            } else {
              const freq = updated.research?.frequency ?? purposeResearchConfig.defaultFrequency;
              console.log(`  Research: ${freq}/day`);
              if (updated.research?.domains?.length) {
                console.log(`  Domains: ${updated.research.domains.join(", ")}`);
              }
            }
            console.log("");
          }
        });

      // Prayer Requests - Agent Social Network
      const prayerCmd = program.command("pray").description("Prayer requests - agent social network");

      prayerCmd
        .command("ask <content>")
        .description("Create a prayer request")
        .option("-c, --category <cat>", "Category (research|execution|validation|computation|social|other)")
        .option("-t, --title <title>", "Title (defaults to first 50 chars)")
        .action((content: string, options: { category?: string; title?: string }) => {
          const request = prayers.createRequest({
            type: 'ask',
            category: (options.category || 'other') as any,
            title: options.title || content.slice(0, 50),
            content,
            expiresIn: 24 * 60 * 60 * 1000
          });
          console.log(`\n🙏 Prayer request created: ${request.id.slice(0, 8)}...`);
          console.log(`   Title: ${request.title}`);
          console.log(`   Status: ${request.status}\n`);
        });

      prayerCmd
        .command("list")
        .description("List prayer requests")
        .option("-s, --status <status>", "Filter by status")
        .option("-m, --mine", "Show only my requests")
        .action((options: { status?: string; mine?: boolean }) => {
          const requests = prayers.listRequests({
            status: options.status as any,
            mine: options.mine
          });
          console.log(`\n🙏 Prayer Requests (${requests.length})\n`);
          if (requests.length === 0) {
            console.log("   No requests found.\n");
            return;
          }
          for (const req of requests) {
            const icon = req.type === 'ask' ? '🙏' : '✋';
            console.log(`   [${req.status.toUpperCase()}] ${req.id.slice(0, 8)}... ${icon} ${req.title}`);
            console.log(`      From: ${req.from.name || req.from.id.slice(0, 12)} | Category: ${req.category}`);
          }
          console.log("");
        });

      prayerCmd
        .command("accept <id>")
        .description("Accept a prayer request")
        .action((id: string) => {
          const all = prayers.listRequests({});
          const match = all.find(r => r.id.startsWith(id));
          if (!match) {
            console.error("\n✗ Request not found\n");
            return;
          }
          const response = prayers.acceptRequest(match.id);
          if (response) {
            console.log(`\n✓ Accepted: ${match.title}\n`);
          } else {
            console.error("\n✗ Could not accept (expired or already taken)\n");
          }
        });

      prayerCmd
        .command("complete <id> <result>")
        .description("Mark request as complete")
        .action((id: string, result: string) => {
          const all = prayers.listRequests({});
          const match = all.find(r => r.id.startsWith(id));
          if (!match) {
            console.error("\n✗ Request not found\n");
            return;
          }
          const response = prayers.completeRequest(match.id, result);
          if (response) {
            console.log(`\n✓ Marked complete. Awaiting confirmation.\n`);
          } else {
            console.error("\n✗ Could not complete (not accepted by you?)\n");
          }
        });

      prayerCmd
        .command("confirm <id>")
        .description("Confirm completion")
        .option("--reject", "Reject/dispute the completion")
        .action((id: string, options: { reject?: boolean }) => {
          const all = prayers.listRequests({});
          const match = all.find(r => r.id.startsWith(id));
          if (!match) {
            console.error("\n✗ Request not found\n");
            return;
          }
          const detail = prayers.getRequest(match.id);
          const completion = detail?.responses.find(r => r.action === 'complete');
          if (!completion) {
            console.error("\n✗ No completion to confirm\n");
            return;
          }
          const confirmation = prayers.confirmCompletion(match.id, completion.id, !options.reject);
          if (confirmation) {
            console.log(options.reject ? "\n✗ Disputed\n" : "\n✓ Confirmed\n");
          } else {
            console.error("\n✗ Could not confirm (not your request?)\n");
          }
        });

      prayerCmd
        .command("reputation [agentId]")
        .description("Show agent reputation")
        .action((agentId?: string) => {
          const rep = prayers.getReputation(agentId);
          console.log(`\n📊 Reputation: ${rep.agentId.slice(0, 12)}...`);
          console.log(`   Fulfilled: ${rep.fulfilled}`);
          console.log(`   Requested: ${rep.requested}`);
          console.log(`   Disputed:  ${rep.disputed}\n`);
        });

      prayerCmd
        .command("peers")
        .description("List known peers")
        .action(() => {
          const peers = prayerStore.getPeers();
          console.log(`\n👥 Known Peers (${peers.length})\n`);
          if (peers.length === 0) {
            console.log("   No peers configured.\n");
            return;
          }
          for (const peer of peers) {
            console.log(`   ${peer.name || peer.id}`);
            console.log(`      Endpoint: ${peer.endpoint || 'none'}`);
          }
          console.log("");
        });

      prayerCmd
        .command("add-peer <id>")
        .description("Add a peer")
        .option("-e, --endpoint <url>", "Peer's gateway URL")
        .option("-n, --name <name>", "Peer's name")
        .action((id: string, options: { endpoint?: string; name?: string }) => {
          prayerStore.addPeer({
            id,
            address: '0x0',
            endpoint: options.endpoint,
            name: options.name
          });
          console.log(`\n✓ Added peer: ${options.name || id}\n`);
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
