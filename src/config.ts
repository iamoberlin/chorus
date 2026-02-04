/**
 * CHORUS Configuration
 *
 * Standard OpenClaw plugin config via openclaw.yaml:
 *   plugins.entries.chorus.config
 */

export interface ChorusConfig {
  choirs: {
    enabled: boolean;
    timezone: string;
    overrides: Record<string, boolean>;
  };
  memory: {
    consolidation: boolean;
    episodicRetentionDays: number;
  };
  purposeResearch: {
    enabled: boolean;
    dailyRunCap: number;
    defaultFrequency: number;
    defaultMaxFrequency: number;
  };
}

/** Plugin config schema (from openclaw.yaml) */
export interface ChorusPluginConfig {
  enabled?: boolean;
  timezone?: string;
  memoryConsolidation?: boolean;
  episodicRetentionDays?: number;
  /** Individual choir overrides */
  choirs?: Record<string, boolean>;
  /** Purpose-derived research config */
  purposeResearch?: {
    enabled?: boolean;
    dailyRunCap?: number;
    defaultFrequency?: number;
    defaultMaxFrequency?: number;
  };
}

const DEFAULT_CONFIG: ChorusConfig = {
  choirs: {
    enabled: false,
    timezone: "America/New_York",
    overrides: {},
  },
  memory: {
    consolidation: true,
    episodicRetentionDays: 90,
  },
  purposeResearch: {
    enabled: true,
    dailyRunCap: 50,
    defaultFrequency: 6,
    defaultMaxFrequency: 24,
  },
};

/**
 * Load CHORUS config from openclaw.yaml plugin config
 */
export function loadChorusConfig(pluginConfig?: ChorusPluginConfig): ChorusConfig {
  const config = structuredClone(DEFAULT_CONFIG);

  if (!pluginConfig) return config;

  // Choirs
  if (pluginConfig.enabled !== undefined) {
    config.choirs.enabled = pluginConfig.enabled;
  }
  if (pluginConfig.timezone) {
    config.choirs.timezone = pluginConfig.timezone;
  }
  if (pluginConfig.choirs) {
    config.choirs.overrides = pluginConfig.choirs;
  }

  // Memory
  if (pluginConfig.memoryConsolidation !== undefined) {
    config.memory.consolidation = pluginConfig.memoryConsolidation;
  }
  if (pluginConfig.episodicRetentionDays !== undefined) {
    config.memory.episodicRetentionDays = pluginConfig.episodicRetentionDays;
  }

  // Purpose Research
  if (pluginConfig.purposeResearch) {
    if (pluginConfig.purposeResearch.enabled !== undefined) {
      config.purposeResearch.enabled = pluginConfig.purposeResearch.enabled;
    }
    if (pluginConfig.purposeResearch.dailyRunCap !== undefined) {
      config.purposeResearch.dailyRunCap = pluginConfig.purposeResearch.dailyRunCap;
    }
    if (pluginConfig.purposeResearch.defaultFrequency !== undefined) {
      config.purposeResearch.defaultFrequency = pluginConfig.purposeResearch.defaultFrequency;
    }
    if (pluginConfig.purposeResearch.defaultMaxFrequency !== undefined) {
      config.purposeResearch.defaultMaxFrequency = pluginConfig.purposeResearch.defaultMaxFrequency;
    }
  }

  return config;
}
