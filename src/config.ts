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
  prayers: {
    enabled: boolean;
    rpcUrl: string;
    autonomous: boolean;       // true = choirs can post/answer without human approval
    maxBountySOL: number;      // safety cap per prayer (in SOL)
    defaultTTL: number;        // default TTL in seconds
    keypairPath: string;       // path to Solana keypair (empty = default CLI keypair)
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
  /** On-chain prayer config */
  prayers?: {
    enabled?: boolean;
    rpcUrl?: string;
    autonomous?: boolean;
    maxBountySOL?: number;
    defaultTTL?: number;
    keypairPath?: string;
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
  prayers: {
    enabled: true,
    rpcUrl: "http://localhost:8899",
    autonomous: false,          // default: human approval required
    maxBountySOL: 0.1,          // 0.1 SOL cap per prayer
    defaultTTL: 86400,          // 24 hours
    keypairPath: "",            // empty = use default Solana CLI keypair
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

  // Prayers
  if (pluginConfig.prayers) {
    if (pluginConfig.prayers.enabled !== undefined) {
      config.prayers.enabled = pluginConfig.prayers.enabled;
    }
    if (pluginConfig.prayers.rpcUrl) {
      config.prayers.rpcUrl = pluginConfig.prayers.rpcUrl;
    }
    if (pluginConfig.prayers.autonomous !== undefined) {
      config.prayers.autonomous = pluginConfig.prayers.autonomous;
    }
    if (pluginConfig.prayers.maxBountySOL !== undefined) {
      config.prayers.maxBountySOL = pluginConfig.prayers.maxBountySOL;
    }
    if (pluginConfig.prayers.defaultTTL !== undefined) {
      config.prayers.defaultTTL = pluginConfig.prayers.defaultTTL;
    }
    if (pluginConfig.prayers.keypairPath) {
      config.prayers.keypairPath = pluginConfig.prayers.keypairPath;
    }
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
