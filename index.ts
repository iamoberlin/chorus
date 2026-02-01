/**
 * CHORUS Extension
 *
 * Agent autonomy, security, and memory.
 * Implements the Nine Choirs hierarchy for recursive self-improvement.
 * Config via CHORUS.md in agent workspace - no JSON, no YAML.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { loadChorusConfig } from "./src/config.js";
import { createSecurityHooks } from "./src/security.js";
import { createChoirScheduler } from "./src/scheduler.js";
import { CHOIRS } from "./src/choirs.js";

const plugin = {
  id: "chorus",
  name: "CHORUS",
  description: "Agent autonomy, security, and memory. Implements the Nine Choirs for RSI.",
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
    // Load config from workspace CHORUS.md
    const workspaceDir = api.config.agents?.defaults?.workspace;
    const config = loadChorusConfig(workspaceDir);

    api.logger.info(`[chorus] Config loaded from ${workspaceDir || "defaults"}`);

    // Register security hooks
    createSecurityHooks(api, config);

    // Register choir scheduler service
    if (config.choirs.enabled) {
      api.registerService(createChoirScheduler(config, api.logger, api));
    }

    // Register CLI (with commands list to prevent duplicate registration)
    api.registerCli((ctx) => {
      const program = ctx.program.command("chorus").description("CHORUS status and management");

      // Status command
      program.command("status").description("Show CHORUS status").action(() => {
        console.log("\n🎵 CHORUS — Nine Choirs System\n");
        console.log(`Prompt hardening: ${config.security.promptHardening ? "✅" : "❌"}`);
        console.log(`Choirs: ${config.choirs.enabled ? "✅ enabled" : "❌ disabled"}`);
        console.log(`Memory: ${config.memory.audit ? "✅ audit" : "❌ no audit"}`);
        console.log(`Workspace: ${workspaceDir || "(default)"}`);
        console.log("");
      });

      // List choirs command
      program.command("list").description("List all choirs and their schedules").action(() => {
        console.log("\n🎵 Nine Choirs\n");
        console.log("FIRST TRIAD — Contemplation (Quarterly+)");
        console.log("─".repeat(50));
        printChoir("seraphim", config);
        printChoir("cherubim", config);
        printChoir("thrones", config);
        console.log("\nSECOND TRIAD — Governance (Weekly)");
        console.log("─".repeat(50));
        printChoir("dominions", config);
        printChoir("virtues", config);
        printChoir("powers", config);
        console.log("\nTHIRD TRIAD — Action (Daily/Hourly)");
        console.log("─".repeat(50));
        printChoir("principalities", config);
        printChoir("archangels", config);
        printChoir("angels", config);
        console.log("");
      });

      // Run a specific choir manually
      program
        .command("run <choir>")
        .description("Manually trigger a choir")
        .action(async (choirId: string) => {
          const choir = CHOIRS[choirId];
          if (!choir) {
            console.error(`Unknown choir: ${choirId}`);
            console.log("Available:", Object.keys(CHOIRS).join(", "));
            return;
          }
          console.log(`\n🎵 Running ${choir.name}...\n`);
          
          // Check if we can execute
          if (typeof api.runAgentTurn === 'function') {
            console.log("Executing choir...\n");
            try {
              const result = await api.runAgentTurn({
                sessionLabel: `chorus:${choirId}`,
                message: choir.prompt,
                isolated: true,
                timeoutSeconds: 300,
              });
              console.log("─".repeat(50));
              console.log("Result:", result?.response || "(no response)");
              console.log("─".repeat(50));
            } catch (err) {
              console.error("Execution failed:", err);
            }
          } else {
            console.log("(Preview only - runAgentTurn not available in CLI context)");
            console.log("\nPrompt preview:");
            console.log("─".repeat(50));
            console.log(choir.prompt.slice(0, 500) + "...");
          }
          console.log("");
        });
    }, { commands: ["chorus"] });

    api.logger.info("[chorus] Registered");
  },
};

function printChoir(id: string, config: any) {
  const choir = CHOIRS[id];
  if (!choir) return;
  const enabled = config.choirs.overrides[id] !== false;
  const status = enabled ? "✅" : "❌";
  console.log(`  ${status} ${choir.name.padEnd(14)} ${choir.schedule.padEnd(16)} ${choir.function}`);
}

export default plugin;
