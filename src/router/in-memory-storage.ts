/**
 * Armazenamento em Memória — Camada de Adaptador
 *
 * Responsabilidade: Implementar MetricsStorage usando Map em memória
 * Implementação de teste para testes unitários sem I/O
 */

import type { MetricsStorage } from './metrics-storage.js';

/**
 * InMemoryStorage
 *
 * Implementação de teste: armazena tudo em memória.
 * Perfeita para testes unitários (rápida, determinística, sem I/O).
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
   * Função auxiliar de teste: obtém todos os arquivos (para assertivas em testes)
   */
  getAllFiles(): Map<string, string> {
    return new Map(this.files);
  }

  /**
   * Função auxiliar de teste: limpa todos os arquivos (para isolamento de testes)
   */
  clear(): void {
    this.files.clear();
  }
}
