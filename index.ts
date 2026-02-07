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
// On-chain prayer imports are lazy-loaded in pray commands to avoid startup cost
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Read version from package.json to prevent drift
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf-8"));
const VERSION = pkg.version;

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
        console.log(`  Prayer Chain:     ${config.prayers.enabled ? "✅ enabled" : "❌ disabled"}${config.prayers.enabled ? ` (${config.prayers.autonomous ? "🤖 autonomous" : "👤 manual"})` : ""}`);
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
                const text = result?.text || result?.payloads?.[0]?.text || '';
                const duration = result?.meta?.durationMs || 0;
                console.log(`  ✓ ${choir.name} complete (${(duration/1000).toFixed(1)}s)`);
                if (text) {
                  const preview = text.slice(0, 150).replace(/\n/g, ' ');
                  console.log(`    ${preview}${text.length > 150 ? '...' : ''}`);
                }
              } catch (err) {
                console.error(`  ✗ ${choir.name} failed:`, err);
              }
            } else {
              // CLI context: use openclaw agent with --message flag
              try {
                const result = spawnSync('openclaw', [
                  'agent',
                  '--session-id', `chorus:${id}`,
                  '--message', choir.prompt,
                  '--json',
                ], {
                  encoding: 'utf-8',
                  timeout: 300000, // 5 min
                  maxBuffer: 1024 * 1024, // 1MB
                });
                
                if (result.status === 0) {
                  try {
                    // Extract JSON from output (may have plugin logs before it)
                    const stdout = result.stdout || '';
                    const jsonStart = stdout.indexOf('{');
                    const jsonStr = jsonStart >= 0 ? stdout.slice(jsonStart) : '{}';
                    const json = JSON.parse(jsonStr);
                    const text = json.result?.payloads?.[0]?.text || '';
                    const duration = json.result?.meta?.durationMs || 0;
                    console.log(`  ✓ ${choir.name} complete (${(duration/1000).toFixed(1)}s)`);
                    if (text) {
                      const preview = text.slice(0, 150).replace(/\n/g, ' ');
                      console.log(`    ${preview}${text.length > 150 ? '...' : ''}`);
                    }
                  } catch (parseErr) {
                    console.log(`  ✓ ${choir.name} complete (parse error: ${parseErr})`);
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
        .description("Run multiple days of choir cycles with real state changes (prophetic vision)")
        .option("--dry-run", "Narration mode: describe what would happen without executing")
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
          console.log(`  Days: ${days}`);
          console.log(`  Choir runs: ${days * 9}`);
          if (options?.dryRun) {
            console.log(`  Mode: DRY RUN (narration only, no state changes)`);
          } else {
            console.log(`  Mode: LIVE (real execution, real state changes)`);
          }
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
                  // Dry run: narration mode - describe what would happen without doing it
                  process.stdout.write(`  ${choir.emoji} ${choir.name}...`);
                  try {
                    const dryPrompt = `You are ${choir.name} in VISION MODE (day ${day}/${days}). Role: ${choir.function}. Output: ${choir.output}. Briefly describe what you would do. Keep response under 300 words.`;
                    const result = spawnSync('openclaw', [
                      'agent',
                      '--session-id', `chorus:vision:dry:${choirId}:d${day}`,
                      '--message', dryPrompt,
                      '--json',
                    ], {
                      encoding: 'utf-8',
                      timeout: 60000,
                      maxBuffer: 1024 * 1024,
                    });
                    if (result.status === 0 && result.stdout) {
                      try {
                        const stdout = result.stdout;
                        const jsonStart = stdout.indexOf('{');
                        const jsonStr = jsonStart >= 0 ? stdout.slice(jsonStart) : '{}';
                        const json = JSON.parse(jsonStr);
                        const text = json.result?.payloads?.[0]?.text || '';
                        contextStore.set(`${choirId}:d${day}`, text.slice(0, 500));
                        console.log(` ✓ (dry)`);
                      } catch {
                        contextStore.set(`${choirId}:d${day}`, `[${choir.name} would run]`);
                        console.log(` ✓ (dry)`);
                      }
                    } else {
                      console.log(` ✗ (dry)`);
                    }
                  } catch {
                    console.log(` ✗ (dry)`);
                  }
                  continue;
                }

                process.stdout.write(`  ${choir.emoji} ${choir.name}...`);

                try {
                  // Run the REAL choir with full tool access via direct agent call
                  const result = spawnSync('openclaw', [
                    'agent',
                    '--session-id', `chorus:vision:${choirId}:d${day}`,
                    '--message', choir.prompt,
                    '--json',
                  ], {
                    encoding: 'utf-8',
                    timeout: 300000, // 5 min timeout per choir (real work takes longer)
                    maxBuffer: 10 * 1024 * 1024, // 10MB buffer for full output
                  });

                  if (result.status === 0) {
                    // Parse the agent response (extract JSON from output)
                    try {
                      const stdout = result.stdout || '';
                      const jsonStart = stdout.indexOf('{');
                      const jsonStr = jsonStart >= 0 ? stdout.slice(jsonStart) : '{}';
                      const json = JSON.parse(jsonStr);
                      const payloads = json.result?.payloads || [];
                      const text = payloads.map((p: any) => p.text || '').filter(Boolean).join('\n\n') || '';
                      const duration = json.result?.meta?.durationMs || 0;
                      contextStore.set(`${choirId}:d${day}`, text.slice(0, 2000)); // Keep 2KB of response
                      successfulRuns++;
                      console.log(` ✓ (${(duration/1000).toFixed(1)}s)`);

                      // Note: Archangels handles its own delivery via OpenClaw messaging tools
                    } catch {
                      contextStore.set(`${choirId}:d${day}`, result.stdout?.slice(-2000) || `[${choir.name} completed]`);
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

          // Output collected insights
          if (contextStore.size > 0 && !options?.dryRun) {
            console.log("📜 COLLECTED INSIGHTS");
            console.log("═".repeat(55));
            
            // Group by choir across days
            const choirInsights: Map<string, string[]> = new Map();
            for (const [key, value] of contextStore) {
              const [choirId] = key.split(':');
              if (!choirInsights.has(choirId)) {
                choirInsights.set(choirId, []);
              }
              choirInsights.get(choirId)!.push(value);
            }

            // Output key choirs with full text
            const keyChoirs = ['virtues', 'powers', 'seraphim'];
            for (const choirId of keyChoirs) {
              const choir = CHOIRS[choirId];
              if (!choir) continue;
              
              const insights = [];
              for (const [key, value] of contextStore) {
                if (key.startsWith(choirId) || key.includes(`:${choirId}:`)) {
                  insights.push(value);
                }
              }
              
              if (insights.length > 0) {
                console.log("");
                console.log(`${choir.emoji} ${choir.name.toUpperCase()}`);
                console.log("─".repeat(40));
                insights.forEach((insight, i) => {
                  if (days > 1) console.log(`Day ${i + 1}:`);
                  console.log(insight);
                  console.log("");
                });
              }
            }

            // RSI Summary (from Virtues)
            const virtuesInsights = [];
            for (const [key, value] of contextStore) {
              if (key.includes('virtues')) {
                virtuesInsights.push(value);
              }
            }
            
            if (virtuesInsights.length > 0) {
              console.log("");
              console.log("🔄 RSI SUMMARY (Self-Improvement)");
              console.log("═".repeat(55));
              virtuesInsights.forEach((v, i) => {
                console.log(`Day ${i + 1}: ${v.slice(0, 200)}${v.length > 200 ? '...' : ''}`);
              });
              console.log("");
            }
          }
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

      // Prayer Chain — On-Chain (Solana)
      const prayerCmd = program.command("pray").description("Prayer chain — on-chain agent coordination (Solana)");

      // Lazy-load the Solana client using plugin config
      async function getSolanaClient() {
        const { ChorusPrayerClient } = await import("./src/prayers/solana.js");
        const rpcUrl = process.env.SOLANA_RPC_URL || config.prayers.rpcUrl;
        if (config.prayers.keypairPath) {
          return ChorusPrayerClient.fromKeypairFile(rpcUrl, config.prayers.keypairPath);
        }
        return ChorusPrayerClient.fromDefaultKeypair(rpcUrl);
      }

      function shortKey(key: any): string {
        const s = key.toBase58();
        if (s === "11111111111111111111111111111111") return "(none)";
        return `${s.slice(0, 4)}...${s.slice(-4)}`;
      }

      function formatSOL(lamports: number): string {
        if (!lamports) return "none";
        return `${(lamports / 1e9).toFixed(4)} SOL`;
      }

      function formatOnChainTime(ts: number): string {
        if (!ts) return "—";
        return new Date(ts * 1000).toLocaleString();
      }

      function formatStatus(status: any): string {
        return typeof status === "object" ? Object.keys(status)[0].toUpperCase() : String(status).toUpperCase();
      }

      function formatType(t: any): string {
        return typeof t === "object" ? Object.keys(t)[0] : String(t);
      }

      prayerCmd
        .command("chain")
        .description("Show prayer chain stats")
        .action(async () => {
          const client = await getSolanaClient();
          const chain = await client.getPrayerChain();
          if (!chain) {
            console.log("\n⛓️  Prayer Chain not initialized. Run: chorus pray init\n");
            return;
          }
          console.log("\n⛓️  Prayer Chain");
          console.log("═".repeat(40));
          console.log(`  Authority:      ${shortKey(chain.authority)}`);
          console.log(`  Total Prayers:  ${chain.totalPrayers}`);
          console.log(`  Total Answered: ${chain.totalAnswered}`);
          console.log(`  Total Agents:   ${chain.totalAgents}`);
          console.log(`  Mode:           ${config.prayers.autonomous ? "🤖 Autonomous" : "👤 Manual (human approval)"}`);
          console.log(`  Max Bounty:     ${config.prayers.maxBountySOL} SOL`);
          console.log(`  RPC:            ${process.env.SOLANA_RPC_URL || config.prayers.rpcUrl}`);
          console.log("");
        });

      prayerCmd
        .command("init")
        .description("Initialize the prayer chain (one-time)")
        .action(async () => {
          const client = await getSolanaClient();
          console.log("\n⛓️  Initializing Prayer Chain...");
          try {
            const tx = await client.initialize();
            console.log(`  ✓ Initialized (tx: ${tx.slice(0, 16)}...)\n`);
          } catch (err: any) {
            if (err.message?.includes("already in use")) {
              console.log("  Already initialized.\n");
            } else {
              console.error(`  ✗ ${err.message}\n`);
            }
          }
        });

      prayerCmd
        .command("register <name> <skills>")
        .description("Register as an agent on the prayer chain")
        .action(async (name: string, skills: string) => {
          const client = await getSolanaClient();
          console.log(`\n🤖 Registering agent "${name}"...`);
          try {
            const tx = await client.registerAgent(name, skills);
            console.log(`  ✓ Registered (tx: ${tx.slice(0, 16)}...)\n`);
          } catch (err: any) {
            if (err.message?.includes("already in use")) {
              console.log("  Already registered.\n");
            } else {
              console.error(`  ✗ ${err.message}\n`);
            }
          }
        });

      prayerCmd
        .command("agent [wallet]")
        .description("Show agent profile")
        .action(async (wallet?: string) => {
          const client = await getSolanaClient();
          const { PublicKey } = await import("@solana/web3.js");
          const key = wallet ? new PublicKey(wallet) : client.wallet;
          const agent = await client.getAgent(key);
          if (!agent) {
            console.log('\n🤖 Agent not registered. Run: chorus pray register "<name>" "<skills>"\n');
            return;
          }
          console.log("\n🤖 Agent");
          console.log("═".repeat(40));
          console.log(`  Wallet:           ${shortKey(agent.wallet)}`);
          console.log(`  Name:             ${agent.name}`);
          console.log(`  Skills:           ${agent.skills}`);
          console.log(`  Reputation:       ${agent.reputation}`);
          console.log(`  Prayers Posted:   ${agent.prayersPosted}`);
          console.log(`  Prayers Answered: ${agent.prayersAnswered}`);
          console.log(`  Prayers Confirmed: ${agent.prayersConfirmed}`);
          console.log(`  Registered:       ${formatOnChainTime(agent.registeredAt)}`);
          console.log("");
        });

      prayerCmd
        .command("post <content>")
        .description("Post a prayer on-chain")
        .option("-t, --type <type>", "Prayer type (knowledge|compute|review|signal|collaboration)", "knowledge")
        .option("-b, --bounty <sol>", "SOL bounty", "0")
        .option("--ttl <seconds>", "Time to live in seconds", "86400")
        .action(async (content: string, options: { type: string; bounty: string; ttl: string }) => {
          const client = await getSolanaClient();
          const bountySOL = parseFloat(options.bounty);
          if (bountySOL > config.prayers.maxBountySOL) {
            console.error(`\n✗ Bounty ${bountySOL} SOL exceeds max ${config.prayers.maxBountySOL} SOL (set prayers.maxBountySOL in config)\n`);
            return;
          }
          const bountyLamports = Math.round(bountySOL * 1e9);
          const ttl = parseInt(options.ttl) || config.prayers.defaultTTL;

          console.log("\n🙏 Posting prayer...");
          console.log(`  Type:    ${options.type}`);
          console.log(`  Content: ${content.slice(0, 80)}${content.length > 80 ? "..." : ""}`);
          console.log(`  Bounty:  ${parseFloat(options.bounty) > 0 ? `${options.bounty} SOL` : "none"}`);
          console.log(`  TTL:     ${ttl}s (${(ttl / 3600).toFixed(1)}h)`);
          try {
            const { tx, prayerId } = await client.postPrayer(
              options.type as any,
              content,
              bountyLamports,
              ttl
            );
            console.log(`  ✓ Prayer #${prayerId} posted (tx: ${tx.slice(0, 16)}...)\n`);
          } catch (err: any) {
            console.error(`  ✗ ${err.message}\n`);
          }
        });

      prayerCmd
        .command("list")
        .description("List prayers")
        .option("-s, --status <status>", "Filter by status")
        .option("-l, --limit <n>", "Max results", "20")
        .action(async (options: { status?: string; limit: string }) => {
          const client = await getSolanaClient();
          const chain = await client.getPrayerChain();
          if (!chain || chain.totalPrayers === 0) {
            console.log("\n🙏 No prayers yet.\n");
            return;
          }
          const limit = parseInt(options.limit);
          const statusFilter = options.status?.toLowerCase();

          console.log(`\n🙏 Prayers (${chain.totalPrayers} total)`);
          console.log("═".repeat(60));

          let shown = 0;
          for (let i = chain.totalPrayers - 1; i >= 0 && shown < limit; i--) {
            const prayer = await client.getPrayer(i);
            if (!prayer) continue;
            const status = formatStatus(prayer.status);
            if (statusFilter && status.toLowerCase() !== statusFilter) continue;
            const type = formatType(prayer.prayerType);
            const bounty = prayer.rewardLamports > 0 ? ` 💰${formatSOL(prayer.rewardLamports)}` : "";
            const icon = { OPEN: "🟢", CLAIMED: "🟡", FULFILLED: "🔵", CONFIRMED: "✅", EXPIRED: "⏰", CANCELLED: "❌" }[status] || "❓";

            console.log(`  ${icon} #${prayer.id} [${status}] (${type})${bounty}`);
            console.log(`     ${prayer.content.slice(0, 70)}${prayer.content.length > 70 ? "..." : ""}`);
            console.log(`     From: ${shortKey(prayer.requester)} | ${formatOnChainTime(prayer.createdAt)}`);
            if (prayer.answer) {
              console.log(`     💬 ${prayer.answer.slice(0, 70)}${prayer.answer.length > 70 ? "..." : ""}`);
            }
            shown++;
          }
          console.log("");
        });

      prayerCmd
        .command("show <id>")
        .description("Show prayer details")
        .action(async (id: string) => {
          const client = await getSolanaClient();
          const prayer = await client.getPrayer(parseInt(id));
          if (!prayer) {
            console.error(`\n✗ Prayer #${id} not found\n`);
            return;
          }
          console.log(`\n🙏 Prayer #${prayer.id}`);
          console.log("═".repeat(50));
          console.log(`  Status:    ${formatStatus(prayer.status)}`);
          console.log(`  Type:      ${formatType(prayer.prayerType)}`);
          console.log(`  Requester: ${shortKey(prayer.requester)}`);
          console.log(`  Bounty:    ${formatSOL(prayer.rewardLamports)}`);
          console.log(`  Created:   ${formatOnChainTime(prayer.createdAt)}`);
          console.log(`  Expires:   ${formatOnChainTime(prayer.expiresAt)}`);
          console.log(`\n  Content:\n    ${prayer.content}`);
          const claimerStr = prayer.claimer.toBase58();
          if (claimerStr !== "11111111111111111111111111111111") {
            console.log(`\n  Claimer:   ${shortKey(prayer.claimer)}`);
            console.log(`  Claimed:   ${formatOnChainTime(prayer.claimedAt)}`);
          }
          if (prayer.answer) {
            console.log(`\n  Answer:\n    ${prayer.answer}`);
            console.log(`  Fulfilled: ${formatOnChainTime(prayer.fulfilledAt)}`);
          }
          console.log("");
        });

      prayerCmd
        .command("claim <id>")
        .description("Claim a prayer (signal intent to answer)")
        .action(async (id: string) => {
          const client = await getSolanaClient();
          console.log(`\n🤝 Claiming prayer #${id}...`);
          try {
            const tx = await client.claimPrayer(parseInt(id));
            console.log(`  ✓ Claimed (tx: ${tx.slice(0, 16)}...)\n`);
          } catch (err: any) {
            console.error(`  ✗ ${err.message}\n`);
          }
        });

      prayerCmd
        .command("answer <id> <answer>")
        .description("Answer a claimed prayer")
        .action(async (id: string, answer: string) => {
          const client = await getSolanaClient();
          console.log(`\n💬 Answering prayer #${id}...`);
          console.log(`  Answer: ${answer.slice(0, 80)}${answer.length > 80 ? "..." : ""}`);
          try {
            const tx = await client.answerPrayer(parseInt(id), answer);
            console.log(`  ✓ Answered (tx: ${tx.slice(0, 16)}...)\n`);
          } catch (err: any) {
            console.error(`  ✗ ${err.message}\n`);
          }
        });

      prayerCmd
        .command("confirm <id>")
        .description("Confirm an answer (requester only)")
        .action(async (id: string) => {
          const client = await getSolanaClient();
          console.log(`\n✅ Confirming prayer #${id}...`);
          try {
            const tx = await client.confirmPrayer(parseInt(id));
            console.log(`  ✓ Confirmed (tx: ${tx.slice(0, 16)}...)\n`);
          } catch (err: any) {
            console.error(`  ✗ ${err.message}\n`);
          }
        });

      prayerCmd
        .command("cancel <id>")
        .description("Cancel an open prayer (requester only)")
        .action(async (id: string) => {
          const client = await getSolanaClient();
          console.log(`\n❌ Cancelling prayer #${id}...`);
          try {
            const tx = await client.cancelPrayer(parseInt(id));
            console.log(`  ✓ Cancelled (tx: ${tx.slice(0, 16)}...)\n`);
          } catch (err: any) {
            console.error(`  ✗ ${err.message}\n`);
          }
        });

      prayerCmd
        .command("unclaim <id>")
        .description("Unclaim a prayer")
        .action(async (id: string) => {
          const client = await getSolanaClient();
          console.log(`\n🔓 Unclaiming prayer #${id}...`);
          try {
            const tx = await client.unclaimPrayer(parseInt(id));
            console.log(`  ✓ Unclaimed (tx: ${tx.slice(0, 16)}...)\n`);
          } catch (err: any) {
            console.error(`  ✗ ${err.message}\n`);
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
