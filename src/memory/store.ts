import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface MemoryRow {
  path: string;
  scope: string;
  scope_id: string;
  type: string;
  body: string;
  rank: number;
}

export interface SearchOpts {
  scope?: string;
  scope_id?: string;
  type?: string;
  limit?: number;
}

export class MemoryStore {
  private db: Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory (
        path TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        type TEXT NOT NULL,
        body TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
    `);

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        body,
        content=memory,
        content_rowid=rowid,
        tokenize='porter unicode61'
      );
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory BEGIN
        INSERT INTO memory_fts(rowid, body) VALUES (new.rowid, new.body);
      END;
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, body) VALUES('delete', old.rowid, old.body);
      END;
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memory BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, body) VALUES('delete', old.rowid, old.body);
        INSERT INTO memory_fts(rowid, body) VALUES (new.rowid, new.body);
      END;
    `);
  }

  search(query: string, opts?: SearchOpts): MemoryRow[] {
    const limit = opts?.limit ?? 10;
    const ftsQuery = query.replace(/['"]/g, '').trim();
    if (!ftsQuery) return [];

    let sql = `
      SELECT m.path, m.scope, m.scope_id, m.type, m.body, fts.rank
      FROM memory_fts fts
      JOIN memory m ON m.rowid = fts.rowid
      WHERE memory_fts MATCH $query
    `;
    const params: Record<string, string | number> = { $query: ftsQuery };

    if (opts?.scope) {
      sql += ' AND m.scope = $scope';
      params.$scope = opts.scope;
    }
    if (opts?.scope_id) {
      sql += ' AND m.scope_id = $scope_id';
      params.$scope_id = opts.scope_id;
    }
    if (opts?.type) {
      sql += ' AND m.type = $type';
      params.$type = opts.type;
    }

    sql += ' ORDER BY fts.rank LIMIT $limit';
    params.$limit = limit;

    return this.db.prepare(sql).all(params) as MemoryRow[];
  }

  write(path: string, scope: string, scopeId: string, type: string, body: string): void {
    this.db
      .prepare(
        `INSERT INTO memory (path, scope, scope_id, type, body)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           scope = excluded.scope,
           scope_id = excluded.scope_id,
           type = excluded.type,
           body = excluded.body,
           updated_at = unixepoch()`
      )
      .run(path, scope, scopeId, type, body);
  }

  getIndexedPaths(): string[] {
    const rows = this.db.prepare('SELECT path FROM memory').all() as { path: string }[];
    return rows.map((r) => r.path);
  }

  close(): void {
    this.db.close();
  }
}
