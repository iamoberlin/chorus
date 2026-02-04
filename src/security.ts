/**
 * CHORUS Security Integration
 *
 * Security in CHORUS is handled by the Powers choir (8×/day adversarial review).
 * Real-time input validation is handled by core OpenClaw's security layer.
 *
 * Enable in openclaw.yaml:
 *   security:
 *     inputValidation:
 *       enabled: true
 *       onThreat: block
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { ChorusConfig } from "./config.js";

export function createSecurityHooks(
  api: OpenClawPluginApi,
  _config: ChorusConfig
) {
  // Security is handled by:
  // 1. Core OpenClaw security.inputValidation (real-time)
  // 2. Powers choir (8×/day adversarial review)
  // No additional hooks needed.
  api.logger.debug("[chorus] Security delegated to Powers choir + core OpenClaw");
}
