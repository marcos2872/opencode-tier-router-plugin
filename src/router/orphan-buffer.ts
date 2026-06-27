/**
 * Correção de condição de corrida: um evento step-finish chega antes que a decisão de roteamento seja armazenada.
 *
 * Problema: A ordem dos ganchos do plugin não é garantida. Exemplo:
 *   1. o gancho chat.message dispara → o evento chega → ainda não há decisão de roteamento na memória
 *   2. a decisão de roteamento é armazenada alguns segundos depois
 *   Resultado: o evento é registrado com delegatedTier='unknown'
 *
 * Solução: Bufferiza eventos órfãos por até 5 segundos com lógica de retentativa.
 * Após 5s, atribui à camada 'unknown' e persiste imediatamente.
 *
 * Implementação:
 * - Armazena eventos com timestamp e contagem de tentativas
 * - tryCorrelate(sessionId, decision) retorna o órfão mais antigo se encontrado
 * - getExpired() retorna todos os órfãos que excederam MAX_WAIT_MS
 * - size() retorna o tamanho atual do buffer (para monitoramento)
 */

import { calculateCost } from './cost-calculator.js';
import {
  CLEANUP_INTERVAL_MS,
  ORPHAN_MAX_ATTEMPTS,
  ORPHAN_MAX_WAIT_MS,
  ORPHAN_RETRY_INTERVAL_MS,
} from '../constants.js';
import type { TokenRecord, RoutingDecision } from './token-event-parser.js';

interface OrphanEntry {
  record: TokenRecord;
  attempts: number;
  firstSeen: number;
}

/**
 * OrphanBuffer — Armazenamento temporário para eventos aguardando decisões de roteamento
 *
 * Seguro para threads em Node.js (loop de eventos com thread único).
 * Memória limitada: max ~100 órfãos × 200 bytes = 20KB.
 */
export class OrphanBuffer {
  private buffer: Map<string, OrphanEntry> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private readonly MAX_ATTEMPTS = ORPHAN_MAX_ATTEMPTS;
  private readonly RETRY_INTERVAL_MS = ORPHAN_RETRY_INTERVAL_MS; // 1s between retries
  private readonly MAX_WAIT_MS = ORPHAN_MAX_WAIT_MS; // 5s total wait before marking as unknown

  /**
   * Adiciona um registro órfão ao buffer.
   *
   * @param record - Registro de token aguardando uma decisão de roteamento.
   * @returns Nada.
   * @example
   * ```ts
   * orphanBuffer.add(record);
   * ```
   */
  add(record: TokenRecord): void {
    const key = `${record.sessionId}:${record.timestamp}`;
    this.buffer.set(key, { record, attempts: 0, firstSeen: Date.now() });
  }

  /**
   * Tenta correlacionar um órfão com uma decisão de roteamento.
   * Retorna o registro atualizado (com a camada preenchida) se encontrado, caso contrário undefined.
   * Remove a entrada correlacionada do buffer.
   *
   * Estratégia: Usa o órfão mais antigo para esta sessão (equidade FIFO).
   * Isso garante que os eventos sejam correlacionados em ordem temporal.
   *
   * @param sessionId - Identificador da sessão do OpenCode para corresponder.
   * @param routingDecision - Decisão de roteamento usada para preencher o registro retornado.
   * @returns Registro atualizado (com a camada preenchida) se encontrado, caso contrário undefined.
   */
  tryCorrelate(sessionId: string, routingDecision: RoutingDecision): TokenRecord | undefined {
    // Find the oldest orphan for this session
    let oldestKey: string | undefined;
    let oldestRecord: TokenRecord | undefined;
    let oldestTime = Infinity;

    for (const [key, entry] of this.buffer.entries()) {
      if (entry.record.sessionId === sessionId && entry.firstSeen < oldestTime) {
        oldestTime = entry.firstSeen;
        oldestKey = key;
        oldestRecord = entry.record;
      }
    }

    if (!oldestKey || !oldestRecord) return undefined;

    // Correlate: fill in delegatedTier and estimated cost
    const correlated: TokenRecord = {
      ...oldestRecord,
      delegatedTier: routingDecision.tier,
      estimatedTokens: routingDecision.estimated,
      estimatedCost:
        routingDecision.estimated && calculateCost(routingDecision.estimated, { costRatio: routingDecision.costRatio }),
    };

    this.buffer.delete(oldestKey);
    return correlated;
  }

  /**
   * Obtém todos os órfãos que excederam o tempo máximo de espera (5s).
   * Eles serão salvos com delegatedTier='unknown'.
   * Remove-os do buffer.
   *
   * @returns Registros de token expirados, em ordem FIFO do buffer.
   * @example
   * ```ts
   * const expired = orphanBuffer.getExpired();
   * ```
   */
  getExpired(): TokenRecord[] {
    const now = Date.now();
    const expired: TokenRecord[] = [];

    for (const [key, entry] of this.buffer.entries()) {
      if (now - entry.firstSeen >= this.MAX_WAIT_MS) {
        expired.push(entry.record);
        this.buffer.delete(key);
      }
    }

    return expired;
  }

  /**
   * Tamanho atual do buffer (para monitoramento/testes).
   *
   * @returns Número de registros órfãos bufferizados.
   */
  size(): number {
    return this.buffer.size;
  }

  /**
   * Inicia limpeza periódica de registros órfãos expirados.
   *
   * @param callback - Função invocada com registros órfãos expirados.
   * @returns Nada.
   * @example
   * ```ts
   * orphanBuffer.startCleanup(expired => processExpiredOrphans(expired));
   * ```
   */
  startCleanup(callback: (expired: TokenRecord[]) => void): void {
    this.stopCleanup();
    this.cleanupInterval = setInterval(() => {
      const expired = this.getExpired();
      callback(expired);
    }, CLEANUP_INTERVAL_MS);
  }

  /**
   * Para a limpeza periódica de registros órfãos expirados.
   *
   * @returns Nada.
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Limpa todas as entradas bufferizadas (para testes/limpeza).
   *
   * @returns Nada.
   */
  clear(): void {
    this.buffer.clear();
  }

  /**
   * Obtém todas as entradas (para testes/investigação).
   *
   * @returns Todas as entradas bufferizadas com chaves, registros e idade atual.
   * @example
   * ```ts
   * const entries = orphanBuffer.getAll();
   * ```
   */
  getAll(): Array<{ key: string; record: TokenRecord; age: number }> {
    const now = Date.now();
    return Array.from(this.buffer.entries()).map(([key, entry]) => ({
      key,
      record: entry.record,
      age: now - entry.firstSeen,
    }));
  }
}
