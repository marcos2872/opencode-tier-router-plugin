/**
 * Filesystem Storage — Adapter Layer
 *
 * Responsibility: Implement MetricsStorage using Node.js fs/promises
 * Production implementation for persisting metrics to disk
 */

import { mkdir, writeFile, readFile, readdir, unlink, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { MetricsStorage } from './metrics-storage.js';

/**
 * FilesystemStorage
 *
 * Production implementation: writes/reads files from filesystem.
 */
export class FilesystemStorage implements MetricsStorage {
  async save(filename: string, content: string): Promise<void> {
    const dir = dirname(filename);
    await mkdir(dir, { recursive: true });
    await writeFile(filename, content, 'utf-8');
  }

  async load(filename: string): Promise<string> {
    try {
      return await readFile(filename, 'utf-8');
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        // Expected: file doesn't exist yet
        return '';
      }
      // Unexpected error
      console.warn(`[FilesystemStorage] Failed to read file:`, {
        code: error.code,
        message: error.message,
      });
      return '';
    }
  }

  async listFiles(dir: string): Promise<string[]> {
    try {
      return await readdir(dir);
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        // Expected: file doesn't exist yet
        return [];
      }
      // Unexpected error
      console.warn(`[FilesystemStorage] Failed to list directory:`, {
        code: error.code,
        message: error.message,
      });
      return [];
    }
  }

  async delete(filename: string): Promise<void> {
    try {
      await unlink(filename);
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        // Expected: file doesn't exist yet
        return;
      }
      // Unexpected error
      console.warn(`[FilesystemStorage] Failed to delete file:`, {
        code: error.code,
        message: error.message,
      });
    }
  }

  async exists(filename: string): Promise<boolean> {
    try {
      await stat(filename);
      return true;
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        // Expected: file doesn't exist yet
        return false;
      }
      // Unexpected error
      console.warn(`[FilesystemStorage] Failed to check file existence:`, {
        code: error.code,
        message: error.message,
      });
      return false;
    }
  }
}
