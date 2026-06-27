/**
 * Metrics Storage — Port/Interface Layer
 *
 * Responsibility: Define abstraction for persistence I/O
 * ✅ Dependency Inversion: Implementations depend on this interface
 * Allows swapping filesystem for in-memory storage in tests
 */

/**
 * MetricsStorage interface
 *
 * Abstracts all I/O operations for persisting and loading metrics.
 * Implementations (FilesystemStorage, InMemoryStorage) are in separate modules.
 */
export interface MetricsStorage {
  /**
   * Save content to a file at the given path.
   * Create directory recursively if needed.
   */
  save(filename: string, content: string): Promise<void>;

  /**
   * Load content from a file at the given path.
   * Return empty string if file doesn't exist.
   */
  load(filename: string): Promise<string>;

  /**
   * List files in a directory matching a pattern.
   * Return empty array if directory doesn't exist.
   */
  listFiles(dir: string): Promise<string[]>;

  /**
   * Delete a file at the given path.
   * No-op if file doesn't exist.
   */
  delete(filename: string): Promise<void>;

  /**
   * Check if a file exists at the given path.
   */
  exists(filename: string): Promise<boolean>;
}
