/**
 * CHORUS Extension
 *
 * The soul, ascending.
 * Recursive illumination through the Nine Choirs.
 * Config via openclaw.yaml: plugins.entries.chorus.config
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { loadChorusConfig, type ChorusPluginConfig } from "./src/config.js";
import { createSecurityHooks } from "./src/security.js";
import { createChoirScheduler } from "./src/scheduler.js";
import { CHOIRS, formatFrequency } from "./src/choirs.js";

const VERSION = "0.3.0";

const plugin = {
  id: "chorus",
  name: "CHORUS",
  description: "The soul, ascending. Recursive illumination through the Nine Choirs.",

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

    // Register CLI
    api.registerCli((ctx) => {
      const program = ctx.program.command("chorus").description("CHORUS Nine Choirs management");

      // Status command
      program.command("status").description("Show CHORUS status").action(() => {
        console.log("");
        console.log("🎵 CHORUS — The soul, ascending.");
        console.log("═".repeat(42));
        console.log("");
        console.log(`  Version:        ${VERSION}`);
        console.log(`  Choirs:         ${config.choirs.enabled ? "✅ enabled" : "❌ disabled"}`);
        console.log(`  Timezone:       ${config.choirs.timezone}`);
        console.log(`  Consolidation:  ${config.memory.consolidation ? "✅ enabled" : "❌ disabled"}`);
        console.log("");
        
        if (!config.choirs.enabled) {
          console.log("  💡 To enable choirs, add to openclaw.yaml:");
          console.log("     plugins.entries.chorus.config.enabled: true");
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
