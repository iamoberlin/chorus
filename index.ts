/**
 * CHORUS Extension
 *
 * Recursive self-improvement for OpenClaw agents.
 * Implements the Nine Choirs hierarchy for hierarchical cognition.
 * Config via CHORUS.md in agent workspace.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { loadChorusConfig } from "./src/config.js";
import { createSecurityHooks } from "./src/security.js";
import { createChoirScheduler } from "./src/scheduler.js";
import { CHOIRS, formatFrequency } from "./src/choirs.js";

const VERSION = "0.2.0";

const plugin = {
  id: "chorus",
  name: "CHORUS",
  description: "Nine Choirs architecture for recursive self-improvement.",
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
    // Load config from workspace CHORUS.md
    const workspaceDir = api.config.agents?.defaults?.workspace;
    const config = loadChorusConfig(workspaceDir);

    api.logger.info(`[chorus] 🎵 CHORUS v${VERSION}`);
    api.logger.info(`[chorus] Config: ${workspaceDir || "defaults"}`);

    // Register security hooks (prompt hardening)
    createSecurityHooks(api, config);

    // Register choir scheduler service
    if (config.choirs.enabled) {
      api.registerService(createChoirScheduler(config, api.logger, api));
      api.logger.info("[chorus] Choirs enabled — scheduler registered");
    } else {
      api.logger.info("[chorus] Choirs disabled — set 'Enabled: true' in CHORUS.md");
    }

    // Register CLI (with commands list to prevent duplicate registration)
    api.registerCli((ctx) => {
      const program = ctx.program.command("chorus").description("CHORUS Nine Choirs management");

      // Status command
      program.command("status").description("Show CHORUS status").action(() => {
        console.log("");
        console.log("🎵 CHORUS — Nine Choirs Architecture");
        console.log("═".repeat(42));
        console.log("");
        console.log(`  Version:          ${VERSION}`);
        console.log(`  Prompt hardening: ${config.security.promptHardening ? "✅ enabled" : "❌ disabled"}`);
        console.log(`  Choirs:           ${config.choirs.enabled ? "✅ enabled" : "❌ disabled"}`);
        console.log(`  Memory audit:     ${config.memory.audit ? "✅ enabled" : "❌ disabled"}`);
        console.log(`  Consolidation:    ${config.memory.consolidation ? "✅ enabled" : "❌ disabled"}`);
        console.log(`  Workspace:        ${workspaceDir || "(default)"}`);
        console.log("");
        
        if (!config.choirs.enabled) {
          console.log("  💡 To enable choirs, add to CHORUS.md:");
          console.log("     - Enabled: true");
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

      // Run a specific choir manually
      program
        .command("run <choir>")
        .description("Manually trigger a choir")
        .action(async (choirId: string) => {
          const choir = CHOIRS[choirId];
          if (!choir) {
            console.error(`❌ Unknown choir: ${choirId}`);
            console.log("Available:", Object.keys(CHOIRS).join(", "));
            return;
          }
          console.log(`\n${choir.emoji} Running ${choir.name}...\n`);
          
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
            console.log("(Preview only — runAgentTurn not available in CLI context)");
            console.log("\nPrompt preview:");
            console.log("─".repeat(50));
            console.log(choir.prompt.slice(0, 600) + "...");
          }
          console.log("");
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
  console.log(`  ${status} ${choir.emoji} ${choir.name.padEnd(14)} ${freq} ${choir.function}`);
}

export default plugin;
