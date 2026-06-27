/**
 * Rastreador de Tokens — Camada de aplicação/orquestração
 *
 * Responsabilidade: Orquestrar todos os componentes de rastreamento de tokens
 * - Manter cache de sessões em memória (LRU + TTL)
 * - Correlacionar eventos com decisões de roteamento (✅ ERRO-002 correção: OrphanBuffer)
 * - Persistir sessões em disco ao serem evitadas (✅ ERRO-004 correção: LRU + TTL)
 * - Aplicar limites de configuração ao cálculo de acurácia (✅ ERRO-003 correção)
 * - Limpar arquivos antigos automaticamente (✅ ERRO-005 correção)
 *
 * ✅ SOLID: Depende de interfaces (MetricsStorage, MetricsAggregator, MetricsFormatter)
 * Sem lógica de negócio aqui — apenas orquestração
 */

import type { MetricsStorage } from './metrics-storage.js';
import type { MetricsAggregator, SessionTokenSummary } from './metrics-aggregator.js';
import type { MetricsFormatter } from './metrics-formatter.js';
import type {
  TokenEventParser,
  TokenRecord,
  RoutingDecision,
  StepFinishEvent,
  TokenUsage,
} from './token-event-parser.js';
import type { RouterConfig } from './config.js';
import { OrphanBuffer } from './orphan-buffer.js';
import {
  LRU_MAX_SESSIONS,
  MILLISECONDS_PER_MINUTE,
  MAX_HISTORY_FILES,
  MINUTES_PER_HOUR,
  SESSION_TTL_MINUTES,
} from '../constants.js';
import { safeJsonParse } from '../utils/safe-json.js';

/**
 * PersistedTokenSession — Formato para salvar em disco
 *
 * Adiciona metadados necessários para restaurar e entender sessões persistidas.
 */
/**
 * Sessão de rastreamento de tokens persistida em disco.
 */
export interface PersistedTokenSession {
  /**
   * Versão do formato de persistência.
   */
  version: string;

  /**
   * Identificador da sessão do OpenCode representado por este registro.
   */
  sessionId: string;

  /**
   * Número de decisões de roteamento correlacionadas com esta sessão.
   */
  delegationCount: number;

  /**
   * Marca de tempo Unix em que a sessão foi salva.
   */
  savedAt: number;

  /**
   * Métricas agregadas para esta sessão.
   */
  summary: SessionTokenSummary;
}

/**
 * SessionCache — Cache LRU em memória com TTL
 *
 * Armazena sessões ativas. Quando evitadas (LRU ou TTL), sessões são persistidas em disco.
 */
class SessionCache {
  /**
   * Armazenamento interno usando Map, que preserva a ordem de inserção.
   * Map.delete(key) + Map.set(key, value) move uma entrada para o fim em O(1).
   * A primeira entrada na ordem de iteração é a menos recentemente usada (LRU).
   */
  private cache: Map<string, { summary: SessionTokenSummary; lastAccess: number; delegationCount: number }> = new Map();
  private isEvictionLocked = false;

  constructor(
    private readonly maxSessions: number,
    private readonly ttlMinutes: number,
  ) {}

  set(sessionId: string, summary: SessionTokenSummary, delegationCount: number): void {
    const existing = this.cache.get(sessionId);
    if (existing) {
      // Update and touch LRU — delete + set moves to end (O(1))
      existing.summary = summary;
      existing.lastAccess = Date.now();
      existing.delegationCount = delegationCount;
      this.cache.delete(sessionId);
      this.cache.set(sessionId, existing);
    } else {
      // New session — set adds at end
      this.cache.set(sessionId, { summary, lastAccess: Date.now(), delegationCount });
    }
  }

  get(sessionId: string): SessionTokenSummary | undefined {
    const entry = this.cache.get(sessionId);
    if (entry) {
      entry.lastAccess = Date.now();
      // Touch LRU — delete + set moves to end (O(1))
      this.cache.delete(sessionId);
      this.cache.set(sessionId, entry);
      return entry.summary;
    }
    return undefined;
  }

  /**
   * Obtém sessões que devem ser evitadas:
   * - Excedeu TTL
   * - Acima da capacidade (LRU)
   *
   * Usa a ordem nativa de inserção do Map para rastreamento LRU em O(1):
   * - As primeiras entradas na iteração são as mais antigas (LRU)
   * - touchLRU move a entrada para o fim via delete+set
   */
  getEvictionCandidates(options?: {
    skipLock?: boolean;
  }): { sessionId: string; summary: SessionTokenSummary; delegationCount: number }[] {
    const shouldSkipLock = options?.skipLock ?? false;
    const wasLocked = this.isEvictionLocked;
    if (!shouldSkipLock && this.isEvictionLocked) return [];

    this.isEvictionLocked = true;
    try {
      return this.collectEvictionCandidates();
    } finally {
      if (!wasLocked) this.isEvictionLocked = false;
    }
  }

  async withEvictionLock<T>(callback: () => Promise<T>): Promise<T | undefined> {
    if (this.isEvictionLocked) return undefined;

    this.isEvictionLocked = true;
    try {
      return await callback();
    } finally {
      this.isEvictionLocked = false;
    }
  }

  private collectEvictionCandidates(): { sessionId: string; summary: SessionTokenSummary; delegationCount: number }[] {
    const now = Date.now();
    const ttlMs = this.ttlMinutes * MINUTES_PER_HOUR * MILLISECONDS_PER_MINUTE;
    const candidates: { sessionId: string; summary: SessionTokenSummary; delegationCount: number }[] = [];
    const evictedSessionIds = new Set<string>();

    // TTL-based eviction
    for (const [sessionId, entry] of Array.from(this.cache.entries())) {
      if (!this.cache.has(sessionId)) continue;
      if (now - entry.lastAccess >= ttlMs) {
        candidates.push({
          sessionId,
          summary: entry.summary,
          delegationCount: entry.delegationCount,
        });
        evictedSessionIds.add(sessionId);
      }
    }

    // LRU-based eviction (if over capacity)
    // Iterate in insertion order — first entries are oldest
    if (this.cache.size + candidates.length > this.maxSessions) {
      const toEvict = Math.max(0, this.cache.size + candidates.length - this.maxSessions);
      for (const [sessionId] of this.cache.entries()) {
        if (evictedSessionIds.size >= toEvict) break;
        if (evictedSessionIds.has(sessionId)) continue;

        const entry = this.cache.get(sessionId);
        if (!entry) continue;

        candidates.push({
          sessionId,
          summary: entry.summary,
          delegationCount: entry.delegationCount,
        });
        evictedSessionIds.add(sessionId);
      }
    }

    // Remove from cache
    for (const candidate of candidates) {
      if (!this.cache.has(candidate.sessionId)) continue;
      this.cache.delete(candidate.sessionId);
    }

    return candidates;
  }

  list(): { sessionId: string; summary: SessionTokenSummary }[] {
    return Array.from(this.cache.entries()).map(([sessionId, entry]) => ({
      sessionId,
      summary: entry.summary,
    }));
  }

  size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }

  /**
   * Toca LRU movendo uma entrada para o fim do Map.
   * O(1) — Map.delete + Map.set preserva a ordem nativa de inserção.
   */
  private touchLRU(sessionId: string): void {
    const entry = this.cache.get(sessionId);
    if (entry) {
      this.cache.delete(sessionId);
      this.cache.set(sessionId, entry);
    }
  }
}

/**
 * TokenTracker — Orquestrador principal
 *
 * API pública:
 * - recordEvent(event, routing?) — Registrar evento de uso de token
 * - getSessionReport(sessionId) — Obtém relatório formatado para uma sessão
 * - listSessions() — Lista todas as sessões persistidas
 * - getComparison(sessionId, tier) — Compara roteamento contra camada hipotética
 */
export class TokenTracker {
  private cache: SessionCache;
  private orphanBuffer: OrphanBuffer;
  private sessionRecords: Map<string, TokenRecord[]> = new Map();
  private delegationCounts: Map<string, number> = new Map();

  /**
   * Cria um rastreador de tokens usando componentes compartilhados de armazenamento, análise, agregação e formatação.
   *
   * @param storage - Adaptador de armazenamento de métricas de token.
   * @param eventParser - Analisador de eventos de tokens de execução de ferramenta.
   * @param aggregator - Agregador de métricas da sessão.
   * @param formatter - Formatador de relatórios e saída de histórico.
   * @param config - Configuração de roteador usada para limites e razões de custo.
   * @param storageDir - Diretório usado para arquivos de métricas de token persistidas.
   */
  constructor(
    private readonly storage: MetricsStorage,
    private readonly eventParser: TokenEventParser,
    private readonly aggregator: MetricsAggregator,
    private readonly formatter: MetricsFormatter,
    private readonly config: RouterConfig,
    private readonly storageDir: string = '.token-tracking',
  ) {
    const ttConfig = config.tokenTracking;
    this.cache = new SessionCache(
      ttConfig?.maxSessionsMemory ?? LRU_MAX_SESSIONS,
      ttConfig?.sessionTTLMinutes ?? SESSION_TTL_MINUTES,
    );
    this.orphanBuffer = new OrphanBuffer();
    this.orphanBuffer.startCleanup(() => {
      try {
        this.processExpiredOrphans();
      } catch (err) {
        console.error('[TokenTracker] Failed to process expired orphans:', err);
      }
    });
  }

  /**
   * Registra um evento de uso de token, opcionalmente com a decisão de roteamento que selecionou a camada.
   *
   * O método analisa o evento, armazena-o em memória, correlaciona eventos órfãos,
   * atualiza a agregação da sessão, lida com evicção LRU/TTL e expira registros órfãos
   * depois da janela de retentativa.
   *
   * @param event - Registro de token analisado ou evento step-finish a ser registrado.
   * @param routing - Decisão de roteamento usada para correlação.
   * @returns Nada; falhas são registradas no log e absorvidas para operação de melhor esforço.
   * @example
   * ```ts
   * await tracker.recordEvent({
   *   sessionId: 'sess-1',
   *   timestamp: Date.now(),
   *   actualTokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
   *   realCost: 0.00025,
   *   delegatedTier: 'medium',
   *   modelUsed: 'unknown',
   *   tierAccuracy: 'UNKNOWN',
   *   estimationError: { input: 0, output: 0 },
   *   totalTokensUsed: 150,
   * });
   * ```
   */
  async recordEvent(event: TokenRecord, routing?: RoutingDecision): Promise<void>;
  async recordEvent(event: StepFinishEvent, routing?: RoutingDecision): Promise<void>;
  async recordEvent(event: TokenRecord | StepFinishEvent, routing?: RoutingDecision): Promise<void> {
    try {
      const isTokenRecord = 'sessionId' in event;
      const record = this.eventParser.parse(
        {
          type: 'step-finish',
          sessionID: isTokenRecord ? event.sessionId : event.sessionID,
          tokens: isTokenRecord ? event.actualTokens : event.tokens,
          cost: isTokenRecord ? event.realCost : event.cost,
          timestamp: event.timestamp,
        },
        routing,
      );

      const sessionId = record.sessionId;
      let records = this.sessionRecords.get(sessionId);
      if (!records) {
        records = [];
        this.sessionRecords.set(sessionId, records);
        this.delegationCounts.set(sessionId, 0);
      }

      // Always add record to session records
      records.push(record);

      // If routing decision is provided, increment delegation count
      if (routing) {
        this.delegationCounts.set(sessionId, (this.delegationCounts.get(sessionId) ?? 0) + 1);

        // Try to correlate any orphans for this session
        const orphaned = this.orphanBuffer.tryCorrelate(sessionId, routing);
        if (orphaned) {
          records.push(orphaned);
        }
      } else {
        // No routing decision yet — also buffer as orphan for later correlation
        this.orphanBuffer.add(record);
      }

      // Aggregate and cache
      const summary = this.aggregator.aggregateSessionMetrics(records, this.config);
      this.cache.set(sessionId, summary, this.delegationCounts.get(sessionId) ?? 0);

      // Check for evictions
      await this.handleEvictions();

      // Check for expired orphans
      this.processExpiredOrphans();
    } catch (err) {
      // ✅ best-effort: never crash the plugin
      console.error('[TokenTracker] Failed to record event:', err);
    }
  }

  private isStepFinishEvent(event: StepFinishEvent | null | undefined): event is StepFinishEvent {
    return (
      !!event &&
      typeof event === 'object' &&
      typeof event.sessionID === 'string' &&
      typeof event.tokens?.input === 'number' &&
      typeof event.tokens?.output === 'number'
    );
  }

  private toTokenRecord(event: StepFinishEvent): TokenRecord {
    const tokens: TokenUsage = {
      input: event.tokens.input,
      output: event.tokens.output,
      reasoning: event.tokens.reasoning ?? 0,
      cache: {
        read: event.tokens.cache?.read ?? 0,
        write: event.tokens.cache?.write ?? 0,
      },
    };

    return {
      sessionId: event.sessionID,
      timestamp: event.timestamp ?? Date.now(),
      actualTokens: tokens,
      realCost: event.cost,
      delegatedTier: 'unknown',
      modelUsed: 'unknown',
      tierAccuracy: 'UNKNOWN',
      estimationError: { input: 0, output: 0 },
      totalTokensUsed: tokens.input + tokens.output + tokens.reasoning + tokens.cache.read,
    };
  }

  /**
   * Registra um evento step-finish com uso real de tokens.
   *
   * @param event - Evento step-finish contendo ID de sessão, tokens e custo.
   * @returns Nada; eventos inválidos são ignorados e falhas são absorvidas.
   * @example
   * ```ts
   * await tracker.recordStepFinish({
   *   sessionID: 'sess-1',
   *   timestamp: Date.now(),
   *   cost: 0.00025,
   *   tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
   * });
   * ```
   */
  async recordStepFinish(event: StepFinishEvent): Promise<void> {
    if (!this.isStepFinishEvent(event)) return;

    await this.recordEvent(this.toTokenRecord(event));
  }

  /**
   * Registra uma decisão de roteamento para uma sessão e correlaciona eventos órfãos pendentes.
   *
   * @param sessionId - Identificador da sessão do OpenCode que selecionou a camada.
   * @param routingDecision - Camada e razão de custo selecionadas para correlação.
   * @returns Nada; falhas são registradas no log e absorvidas para operação de melhor esforço.
   * @example
   * ```ts
   * await tracker.recordRoutingDecision('sess-1', { tier: 'medium', costRatio: 5 });
   * ```
   */
  async recordRoutingDecision(sessionId: string, routingDecision: RoutingDecision): Promise<void> {
    try {
      let records = this.sessionRecords.get(sessionId);
      if (!records) {
        records = [];
        this.sessionRecords.set(sessionId, records);
        this.delegationCounts.set(sessionId, 0);
      }

      // Try to correlate any orphans for this session
      const orphaned = this.orphanBuffer.tryCorrelate(sessionId, routingDecision);
      if (orphaned) {
        records.push(orphaned);
        this.delegationCounts.set(sessionId, (this.delegationCounts.get(sessionId) ?? 0) + 1);
      }

      // Aggregate and cache
      const summary = this.aggregator.aggregateSessionMetrics(records, this.config);
      this.cache.set(sessionId, summary, this.delegationCounts.get(sessionId) ?? 0);

      // Check for evictions
      await this.handleEvictions();
    } catch (err) {
      console.error('[TokenTracker] Failed to record routing decision:', err);
    }
  }

  private processExpiredOrphans(): void {
    const expired = this.orphanBuffer.getExpired();
    if (expired.length === 0) return;

    for (const expiredRecord of expired) {
      const records = this.sessionRecords.get(expiredRecord.sessionId);
      if (!records) continue;
      records.push(expiredRecord);
    }

    for (const expiredRecord of expired) {
      const records = this.sessionRecords.get(expiredRecord.sessionId);
      if (!records) continue;
      const updated = this.aggregator.aggregateSessionMetrics(records, this.config);
      this.cache.set(expiredRecord.sessionId, updated, this.delegationCounts.get(expiredRecord.sessionId) ?? 0);
    }
  }

  /**
   * Obtém um relatório Markdown formatado para uma sessão de rastreamento de tokens.
   *
   * O relatório é lido primeiro do cache em memória e depois dos dados persistidos em disco.
   * Sessões ausentes retornam uma mensagem concisa de não encontrado.
   *
   * @param sessionId - Identificador da sessão do OpenCode.
   * @returns Texto do relatório Markdown, ou uma mensagem de não encontrado quando não há dados.
   * @example
   * ```ts
   * const report = await tracker.getSessionReport('sess-abc123');
   * ```
   */
  async getSessionReport(sessionId: string): Promise<string> {
    try {
      let summary = this.cache.get(sessionId);
      if (!summary) {
        const persisted = await this.loadPersistedTokenMetrics(sessionId);
        if (persisted) {
          summary = persisted;
        }
      }
      if (!summary) {
        return `No data for session ${sessionId}`;
      }
      return this.formatter.formatReport(summary);
    } catch (err) {
      console.error('[TokenTracker] Failed to get report:', err);
      return 'Error generating report';
    }
  }

  /**
   * Lista todas as sessões de rastreamento de tokens persistidas em disco.
   *
   * Arquivos JSON malformados são pulados e erros de armazenamento são registrados no log sem
   * serem lançados para a camada de comando.
   *
   * @returns Sessões de token persistidas, em um array vazio quando nenhuma existir.
   * @example
   * ```ts
   * const sessions = await tracker.listSessions();
   * ```
   */
  async listSessions(): Promise<PersistedTokenSession[]> {
    try {
      const files = await this.storage.listFiles(this.storageDir);
      const sessions: PersistedTokenSession[] = [];

      for (const file of files) {
        if (file.startsWith('token-') && file.endsWith('.json')) {
          const path = `${this.storageDir}/${file}`;
          const content = await this.storage.load(path);
          if (content) {
            const session = safeJsonParse<PersistedTokenSession>(content);
            if (session) {
              sessions.push(session);
            }
          }
        }
      }

      return sessions;
    } catch (err) {
      console.error('[TokenTracker] Failed to list sessions:', err);
      return [];
    }
  }

  /**
   * Obtém comparação de custo formatada para uma sessão contra uma camada hipotética.
   *
   * A comparação é lida primeiro do cache em memória e depois dos dados persistidos
   * em disco. Sessões ausentes retornam uma mensagem concisa de não encontrado.
   *
   * @param sessionId - Identificador da sessão do OpenCode.
   * @param tier - Camada hipotética para comparar.
   * @returns Texto da comparação, ou uma mensagem de não encontrado quando não há dados.
   * @example
   * ```ts
   * const comparison = await tracker.getComparison('sess-abc123', 'heavy');
   * ```
   */
  async getComparison(sessionId: string, tier: 'fast' | 'medium' | 'heavy'): Promise<string> {
    try {
      let summary = this.cache.get(sessionId);
      if (!summary) {
        const persisted = await this.loadPersistedTokenMetrics(sessionId);
        if (persisted) {
          summary = persisted;
        }
      }
      if (!summary) {
        return `No data for session ${sessionId}`;
      }
      return this.formatter.formatComparison(summary, tier);
    } catch (err) {
      console.error('[TokenTracker] Failed to get comparison:', err);
      return 'Error generating comparison';
    }
  }

  /**
   * Formata histórico para todas as sessões persistidas mais sessões recentes em memória.
   *
   * @returns Texto de histórico Markdown, ou uma mensagem de erro quando a formatação falhar.
   * @example
   * ```ts
   * const history = await tracker.getHistory();
   * ```
   */
  async getHistory(): Promise<string> {
    try {
      // Get persisted sessions from disk
      const persistedSessions = await this.listSessions();

      // Also include in-memory sessions that haven't been persisted yet
      const allSessions: PersistedTokenSession[] = [...persistedSessions];

      // Add in-memory sessions (convert cache to PersistedTokenSession format)
      // This is useful for testing and development
      for (const sessionId of this.sessionRecords.keys()) {
        const cached = this.cache.get(sessionId);
        if (cached && !persistedSessions.some((s) => s.sessionId === sessionId)) {
          allSessions.push({
            version: '1.0',
            sessionId,
            delegationCount: this.delegationCounts.get(sessionId) ?? 0,
            savedAt: Date.now(),
            summary: cached,
          });
        }
      }

      return this.formatter.formatHistory(allSessions);
    } catch (err) {
      console.error('[TokenTracker] Failed to get history:', err);
      return 'Error generating history';
    }
  }

  /**
   * Obtém métricas agregadas para uma sessão a partir de memória ou disco.
   *
   * @param sessionId - Identificador da sessão do OpenCode.
   * @returns Métricas agregadas da sessão, ou `null` quando não há dados ou o carregamento falha.
   * @example
   * ```ts
   * const summary = await tracker.getSummary('sess-abc123');
   * ```
   */
  async getSummary(sessionId: string): Promise<SessionTokenSummary | null> {
    try {
      // Try in-memory cache first
      const cached = this.cache.get(sessionId);
      if (cached) {
        return cached;
      }

      // If not in cache, try to load from disk
      return await this.loadPersistedTokenMetrics(sessionId);
    } catch (err) {
      console.error('[TokenTracker] Failed to get summary:', err);
      return null;
    }
  }

  /**
   * Persiste explicitamente métricas de token de uma sessão em disco.
   *
   * @param sessionId - Identificador da sessão do OpenCode.
   * @returns Nada; dados ausentes registram um aviso e falhas são absorvidas.
   * @example
   * ```ts
   * await tracker.persistTokenMetrics('sess-abc123');
   * ```
   */
  async persistTokenMetrics(sessionId: string): Promise<void> {
    try {
      const summary = this.cache.get(sessionId);
      if (!summary) {
        console.warn(`[TokenTracker] No session data to persist for ${sessionId}`);
        return;
      }

      const delegationCount = this.delegationCounts.get(sessionId) ?? 0;
      await this.persistSession(sessionId, summary, delegationCount);
      await this.cleanupOldFiles();
    } catch (err) {
      console.error('[TokenTracker] Failed to persist metrics:', err);
    }
  }

  /**
   * Carrega métricas de token persistidas de uma sessão a partir do arquivo de disco correspondente mais recente.
   *
   * @param sessionId - Identificador da sessão do OpenCode.
   * @returns Resumo persistido agregado, ou `null` quando não existe arquivo correspondente ou o carregamento falha.
   * @example
   * ```ts
   * const persisted = await tracker.loadPersistedTokenMetrics('sess-abc123');
   * ```
   */
  async loadPersistedTokenMetrics(sessionId: string): Promise<SessionTokenSummary | null> {
    try {
      const files = await this.storage.listFiles(this.storageDir);
      const sessionFiles = files
        .filter((f) => f.startsWith(`token-${sessionId.slice(0, 8)}-`) && f.endsWith('.json'))
        .sort()
        .reverse(); // Newest first

      if (sessionFiles.length === 0) {
        return null;
      }

      // Load the most recent file
      const latestFile = sessionFiles[0];
      const path = `${this.storageDir}/${latestFile}`;
      const content = await this.storage.load(path);

      if (!content) {
        return null;
      }

      const persisted = safeJsonParse<PersistedTokenSession>(content);
      return persisted?.summary ?? null;
    } catch (err) {
      console.error('[TokenTracker] Failed to load persisted metrics:', err);
      return null;
    }
  }

  /**
   * Lida com evicções de sessão (TTL + LRU).
   * Persiste sessões evitadas em disco e aplica limpeza.
   */
  private async handleEvictions(): Promise<void> {
    const candidates = await this.cache.withEvictionLock(async () => {
      const candidates = this.cache.getEvictionCandidates({ skipLock: true });

      for (const candidate of candidates) {
        await this.persistSession(candidate.sessionId, candidate.summary, candidate.delegationCount);
        if (this.sessionRecords.has(candidate.sessionId)) {
          this.sessionRecords.delete(candidate.sessionId);
          this.delegationCounts.delete(candidate.sessionId);
        }
      }

      return candidates;
    });

    if (candidates === undefined) return;

    // Clean up old files if needed
    await this.cleanupOldFiles();
  }

  /**
   * Persiste uma sessão em disco.
   */
  private async persistSession(
    sessionId: string,
    summary: SessionTokenSummary,
    delegationCount: number,
  ): Promise<void> {
    try {
      const persisted: PersistedTokenSession = {
        version: '1.0',
        sessionId,
        delegationCount,
        savedAt: Date.now(),
        summary,
      };

      const filename = `${this.storageDir}/token-${sessionId.slice(0, 8)}-${Date.now()}.json`;
      const content = JSON.stringify(persisted, null, 2);
      await this.storage.save(filename, content);
    } catch (err) {
      console.error('[TokenTracker] Failed to persist session:', err);
    }
  }

  /**
   * Limpa arquivos antigos se a contagem exceder maxHistoryFiles.
   * Mantém os arquivos mais recentes e exclui os mais antigos.
   */
  private async cleanupOldFiles(): Promise<void> {
    try {
      const ttConfig = this.config.tokenTracking;
      const maxFiles = ttConfig?.maxHistoryFiles ?? MAX_HISTORY_FILES;

      const files = await this.storage.listFiles(this.storageDir);
      const tokenFiles = files.filter((f) => f.startsWith('token-') && f.endsWith('.json')).sort();

      if (tokenFiles.length > maxFiles) {
        const toDelete = tokenFiles.length - maxFiles;
        for (let i = 0; i < toDelete; i++) {
          const path = `${this.storageDir}/${tokenFiles[i]}`;
          await this.storage.delete(path);
        }
      }
    } catch (err) {
      console.error('[TokenTracker] Cleanup failed:', err);
    }
  }

  /**
   * Para temporizadores de limpeza de órfãos e limpa todos os dados em memória.
   *
   * @returns Nada.
   * @example
   * ```ts
   * tracker.dispose();
   * ```
   */
  dispose(): void {
    this.orphanBuffer.stopCleanup();
    this.clear();
  }

  /**
   * Limpa sessões em memória, registros, contagens de delegação e buffer de órfãos.
   *
   * @returns Nada.
   * @example
   * ```ts
   * tracker.clear();
   * ```
   */
  clear(): void {
    this.cache.clear();
    this.orphanBuffer.clear();
    this.sessionRecords.clear();
    this.delegationCounts.clear();
  }
}
