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
  goalResearch: {
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
  /** Goal-derived research config */
  goalResearch?: {
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
  goalResearch: {
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

  // Goal Research
  if (pluginConfig.goalResearch) {
    if (pluginConfig.goalResearch.enabled !== undefined) {
      config.goalResearch.enabled = pluginConfig.goalResearch.enabled;
    }
    if (pluginConfig.goalResearch.dailyRunCap !== undefined) {
      config.goalResearch.dailyRunCap = pluginConfig.goalResearch.dailyRunCap;
    }
    if (pluginConfig.goalResearch.defaultFrequency !== undefined) {
      config.goalResearch.defaultFrequency = pluginConfig.goalResearch.defaultFrequency;
    }
    if (pluginConfig.goalResearch.defaultMaxFrequency !== undefined) {
      config.goalResearch.defaultMaxFrequency = pluginConfig.goalResearch.defaultMaxFrequency;
    }
  }

  return config;
}
