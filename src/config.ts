/**
 * CHORUS Configuration
 *
 * Parses CHORUS.md from agent workspace.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface ChorusConfig {
  security: {
    /** Add identity protection to system prompt. Default: true */
    promptHardening: boolean;
  };
  choirs: {
    enabled: boolean;
    timezone: string;
    maxConcurrent: number;
    overrides: Record<string, boolean>;
  };
  memory: {
    audit: boolean;
    workingTtlMs: number;
    episodicRetentionDays: number;
    consolidation: boolean;
  };
}

const DEFAULT_CONFIG: ChorusConfig = {
  security: {
    promptHardening: true,
  },
  choirs: {
    enabled: false,
    timezone: "America/New_York",
    maxConcurrent: 1,
    overrides: {},
  },
  memory: {
    audit: true,
    workingTtlMs: 30 * 60 * 1000,
    episodicRetentionDays: 90,
    consolidation: true,
  },
};

export function loadChorusConfig(workspaceDir?: string): ChorusConfig {
  if (!workspaceDir) return DEFAULT_CONFIG;

  const configPath = join(workspaceDir, "CHORUS.md");
  if (!existsSync(configPath)) return DEFAULT_CONFIG;

  try {
    const content = readFileSync(configPath, "utf-8");
    return parseChorusMarkdown(content);
  } catch {
    return DEFAULT_CONFIG;
  }
}

function parseChorusMarkdown(content: string): ChorusConfig {
  const config = structuredClone(DEFAULT_CONFIG);

  // Parse Security
  config.security.promptHardening = parseBool(content, "Prompt hardening", true);

  // Parse Choirs
  config.choirs.enabled = parseBool(content, "Enabled", false);
  config.choirs.timezone = parseString(content, "Timezone", "America/New_York");
  config.choirs.maxConcurrent = parseInt(parseString(content, "Max concurrent", "1"), 10);

  // Parse choir overrides
  for (const name of ["angels", "archangels", "principalities", "powers", "virtues", "dominions", "thrones", "cherubim", "seraphim"]) {
    const value = parseBoolOptional(content, name);
    if (value !== null) config.choirs.overrides[name] = value;
  }

  // Parse Memory
  config.memory.audit = parseBool(content, "Audit", true);
  config.memory.workingTtlMs = parseDuration(parseString(content, "Working TTL", "30m"));
  config.memory.episodicRetentionDays = parseInt(parseString(content, "Episodic retention", "90d"), 10);
  config.memory.consolidation = parseBool(content, "Consolidation", true);

  return config;
}

function parseBool(content: string, key: string, defaultValue: boolean): boolean {
  const match = content.match(new RegExp(`^\\s*-\\s*${key}:\\s*(\\w+)`, "im"));
  if (!match) return defaultValue;
  const v = match[1].toLowerCase();
  return v === "enabled" || v === "true" || v === "yes" || v === "on";
}

function parseBoolOptional(content: string, key: string): boolean | null {
  const match = content.match(new RegExp(`^\\s*-\\s*${key}:\\s*(\\w+)`, "im"));
  if (!match) return null;
  const v = match[1].toLowerCase();
  return v === "enabled" || v === "true" || v === "yes" || v === "on";
}

function parseString(content: string, key: string, defaultValue: string): string {
  const match = content.match(new RegExp(`^\\s*-\\s*${key}:\\s*(.+)$`, "im"));
  return match ? match[1].trim() : defaultValue;
}

function parseDuration(value: string): number {
  const match = value.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) return 30 * 60 * 1000;
  const num = parseInt(match[1], 10);
  switch (match[2]) {
    case "ms": return num;
    case "s": return num * 1000;
    case "m": return num * 60 * 1000;
    case "h": return num * 60 * 60 * 1000;
    case "d": return num * 24 * 60 * 60 * 1000;
    default: return 30 * 60 * 1000;
  }
}
