import type { Config, Plugin, PluginInput } from '@opencode-ai/plugin';
import { loadConfig, createRouterAgent, createTierSubagents } from './config.js';

const plugin = (input: PluginInput) =>
  Promise.resolve({
    config: async (config: Config) => {
      try {
        const cfg = loadConfig(input.directory);
        if (cfg.agentName && !config.agent?.[cfg.agentName]) {
          createRouterAgent(config, cfg);
        }
        createTierSubagents(config, cfg);
      } catch (e) {
        console.error(`[tier-router] config error:`, e);
      }
      return config;
    },
  }) as unknown as Plugin;

export default plugin;
