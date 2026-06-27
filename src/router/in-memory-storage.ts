/**
 * In-Memory Storage — Adapter Layer
 *
 * Responsibility: Implement MetricsStorage using in-memory Map
 * Test implementation for unit testing without I/O
 */

import type { MetricsStorage } from './metrics-storage.js';

/**
 * InMemoryStorage
 *
 * Test implementation: stores everything in memory.
 * Perfect for unit tests (fast, deterministic, no I/O).
 */
export class InMemoryStorage implements MetricsStorage {
  private files: Map<string, string> = new Map();

  async save(filename: string, content: string): Promise<void> {
    this.files.set(filename, content);
  }

  async load(filename: string): Promise<string> {
    return this.files.get(filename) ?? '';
  }

  async listFiles(dir: string): Promise<string[]> {
    return [...this.files.keys()].filter(f => f.startsWith(dir));
  }

  async delete(filename: string): Promise<void> {
    this.files.delete(filename);
  }

  async exists(filename: string): Promise<boolean> {
    return this.files.has(filename);
  }

  /**
   * Test helper: get all files (for assertions in tests)
   */
  getAllFiles(): Map<string, string> {
    return new Map(this.files);
  }

  /**
   * Test helper: clear all files (for test isolation)
   */
  clear(): void {
    this.files.clear();
  }
}
