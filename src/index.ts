import type { Config, Plugin, PluginInput } from '@opencode-ai/plugin';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import {
  loadConfig,
  createComposeAgent,
  createExploreAgent,
  createGeneralAgent,
} from './config.js';
import { createMemoryTool } from './memory/tool.js';

const GLOBAL_MEMORY_BASE = join(homedir(), '.config', 'opencode', 'memory');

function projectId(dir: string): string {
  return createHash('sha256').update(dir).digest('hex').slice(0, 12);
}

const plugin = (input: PluginInput) =>
  Promise.resolve({
    config: async (config: Config) => {
      try {
        const cfg = loadConfig(input.directory);
        createComposeAgent(config);
        createExploreAgent(config, cfg);
        createGeneralAgent(config, cfg);
      } catch (e) {
        console.error(`[compose-plugin] config error:`, e);
      }
      return config;
    },
    tool: {
      memory: createMemoryTool({
        memoryDir: join(GLOBAL_MEMORY_BASE, 'projects', projectId(input.directory)),
        dbPath: join(GLOBAL_MEMORY_BASE, 'projects', projectId(input.directory), 'memory.db'),
        globalMemoryDir: join(GLOBAL_MEMORY_BASE, 'global'),
        globalDbPath: join(GLOBAL_MEMORY_BASE, 'global', 'memory.db'),
      }),
    },
  }) as unknown as Plugin;

export default plugin;
