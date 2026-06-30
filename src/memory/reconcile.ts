import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { MemoryStore } from './store.js';

export function extractScope(absolutePath: string, memoryDir: string): string {
  const rel = relative(memoryDir, absolutePath);
  const parts = rel.split(sep);

  if (parts[0] === 'global') return 'global';
  if (parts[0] === 'projects') return 'projects';
  if (parts[0] === 'sessions') return 'sessions';

  return 'unknown';
}

export function extractScopeId(absolutePath: string, memoryDir: string): string {
  const rel = relative(memoryDir, absolutePath);
  const parts = rel.split(sep);

  if (parts.length >= 2 && (parts[0] === 'projects' || parts[0] === 'sessions')) {
    return parts[1];
  }

  return '';
}

export function extractType(filename: string): string {
  if (filename === 'checkpoint.md') return 'checkpoint';
  if (filename === 'MEMORY.md') return 'snapshot';
  if (filename === 'progress.md') return 'progress';
  return 'snapshot';
}

function walkMdFiles(dir: string): string[] {
  const results: string[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...walkMdFiles(fullPath));
      } else if (entry.name.endsWith('.md')) {
        results.push(fullPath);
      }
    }
  } catch {
    // directory might not exist or be unreadable
  }

  return results;
}

export function reconcileMemoryDir(store: MemoryStore, memoryDir: string): void {
  const indexedPaths = new Set(store.getIndexedPaths());
  const files = walkMdFiles(memoryDir);

  for (const filePath of files) {
    try {
      const content = readFileSync(filePath, 'utf8');
      const filename = filePath.split(sep).pop() ?? '';
      const scope = extractScope(filePath, memoryDir);
      const scopeId = extractScopeId(filePath, memoryDir);
      const type = extractType(filename);

      store.write(filePath, scope, scopeId, type, content);
    } catch {
      // skip unreadable files
    }
  }
}
