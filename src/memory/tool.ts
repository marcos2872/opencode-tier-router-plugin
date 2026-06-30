import { tool } from '@opencode-ai/plugin/tool';
import { z } from 'zod';
import { mkdirSync } from 'node:fs';
import { MemoryStore, type MemoryRow } from './store.js';
import { reconcileMemoryDir } from './reconcile.js';

interface MemoryToolOpts {
  memoryDir: string;
  dbPath: string;
  globalMemoryDir: string;
  globalDbPath: string;
}

export function createMemoryTool({ memoryDir, dbPath, globalMemoryDir, globalDbPath }: MemoryToolOpts) {
  let projectStore: MemoryStore | null = null;
  let globalStore: MemoryStore | null = null;
  let projectReconciled = false;
  let globalReconciled = false;

  function getProjectStore(): MemoryStore {
    if (!projectStore) {
      mkdirSync(memoryDir, { recursive: true });
      projectStore = new MemoryStore(dbPath);
    }
    if (!projectReconciled) {
      reconcileMemoryDir(projectStore, memoryDir);
      projectReconciled = true;
    }
    return projectStore;
  }

  function getGlobalStore(): MemoryStore {
    if (!globalStore) {
      mkdirSync(globalMemoryDir, { recursive: true });
      globalStore = new MemoryStore(globalDbPath);
    }
    if (!globalReconciled) {
      reconcileMemoryDir(globalStore, globalMemoryDir);
      globalReconciled = true;
    }
    return globalStore;
  }

  function isGlobalScope(scope: string): boolean {
    return scope === 'global' || scope === 'global-preferences' || scope.endsWith('-preferences');
  }

  return tool({
    description:
      'Search or write to the persistent memory store. Operations: search (BM25 FTS over markdown bodies) or write (insert/update a memory entry).',
    args: {
      operation: z.enum(['search', 'write']),
      query: z.string().optional(),
      scope: z.string().optional(),
      scope_id: z.string().optional(),
      type: z.string().optional(),
      limit: z.number().optional(),
      path: z.string().optional(),
      content: z.string().optional(),
    },
    async execute(args) {
      if (args.operation === 'search') {
        if (!args.query) return 'Error: query is required for search';

        const results: MemoryRow[] = [];

        if (args.scope && isGlobalScope(args.scope)) {
          results.push(...getGlobalStore().search(args.query, {
            type: args.type,
            limit: args.limit,
          }));
        } else if (args.scope) {
          results.push(...getProjectStore().search(args.query, {
            scope: args.scope,
            scope_id: args.scope_id,
            type: args.type,
            limit: args.limit,
          }));
        } else {
          results.push(...getGlobalStore().search(args.query, {
            type: args.type,
            limit: args.limit,
          }));
          results.push(...getProjectStore().search(args.query, {
            type: args.type,
            limit: args.limit,
          }));
        }

        if (results.length === 0) return 'No results found';
        return JSON.stringify(results.slice(0, args.limit ?? 10), null, 2);
      }

      if (args.operation === 'write') {
        if (!args.path) return 'Error: path is required for write';
        if (!args.content) return 'Error: content is required for write';
        if (!args.scope) return 'Error: scope is required for write';

        const scope = args.scope;
        const scopeId = args.scope_id ?? '';
        const type = args.type ?? 'snapshot';

        if (isGlobalScope(scope)) {
          getGlobalStore().write(args.path, scope, scopeId, type, args.content);
        } else {
          getProjectStore().write(args.path, scope, scopeId, type, args.content);
        }

        return `Wrote to ${args.path}`;
      }

      return 'Error: unknown operation';
    },
  });
}
