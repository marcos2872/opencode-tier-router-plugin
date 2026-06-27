/**
 * Token Tracker — Application/Orchestration Layer
 *
 * Responsibility: Orchestrate all token tracking components
 * - Maintain in-memory session cache (LRU + TTL)
 * - Correlate events with routing decisions (✅ ERRO-002 fix: OrphanBuffer)
 * - Persist sessions to disk on eviction (✅ ERRO-004 fix: LRU + TTL)
 * - Apply config thresholds to accuracy calculation (✅ ERRO-003 fix)
 * - Clean up old files automatically (✅ ERRO-005 fix)
 *
 * ✅ SOLID: Depends on interfaces (MetricsStorage, MetricsAggregator, MetricsFormatter)
 * Zero business logic here — just orchestration
 */

import type { MetricsStorage } from './metrics-storage.js';
import type { MetricsAggregator, SessionTokenSummary } from './metrics-aggregator.js';
import type { MetricsFormatter } from './metrics-formatter.js';
import type { TokenEventParser, TokenRecord, RoutingDecision, StepFinishEvent, TokenUsage } from './token-event-parser.js';
import type { RouterConfig } from './config.js';
import { OrphanBuffer } from './orphan-buffer.js';

/**
 * PersistedTokenSession — Format for saving to disk
 *
 * Adds metadata needed to restore and understand persisted sessions.
 */
/**
 * Persisted token tracking session saved to disk.
 */
export interface PersistedTokenSession {
  /**
   * Persistence format version.
   */
  version: string;

  /**
   * OpenCode session ID represented by this record.
   */
  sessionId: string;

  /**
   * Number of routing decisions correlated with this session.
   */
  delegationCount: number;

  /**
   * Unix timestamp when the session was saved.
   */
  savedAt: number;

  /**
   * Aggregated metrics for this session.
   */
  summary: SessionTokenSummary;
}

/**
 * SessionCache — In-memory LRU cache with TTL
 *
 * Stores active sessions. When evicted (LRU or TTL), sessions are persisted to disk.
 */
class SessionCache {
  /**
   * Internal storage using Map which preserves insertion order.
   * Map.delete(key) + Map.set(key, value) moves an entry to the end in O(1).
   * The first entry in iteration order is the least recently used (LRU).
   */
  private cache: Map<string, { summary: SessionTokenSummary; lastAccess: number; delegationCount: number }> =
    new Map();
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
   * Get sessions that should be evicted:
   * - Exceeded TTL
   * - Over capacity (LRU)
   *
   * Uses Map's native insertion order for O(1) LRU tracking:
   * - First entries in iteration are oldest (LRU)
   * - touchLRU moves entry to end via delete+set
   */
  getEvictionCandidates(options?: { skipLock?: boolean }): { sessionId: string; summary: SessionTokenSummary; delegationCount: number }[] {
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
    const ttlMs = this.ttlMinutes * 60 * 1000;
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
   * Touch LRU by moving an entry to the end of the Map.
   * O(1) — Map.delete + Map.set preserves native insertion order.
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
 * TokenTracker — Main orchestrator
 *
 * Public API:
 * - recordEvent(event, routing?) — Record a token usage event
 * - getSessionReport(sessionId) — Get formatted report for a session
 * - listSessions() — List all persisted sessions
 * - getComparison(sessionId, tier) — Compare routing vs hypothetical tier
 */
export class TokenTracker {
  private cache: SessionCache;
  private orphanBuffer: OrphanBuffer;
  private sessionRecords: Map<string, TokenRecord[]> = new Map();
  private delegationCounts: Map<string, number> = new Map();

  /**
   * Create a token tracker using shared storage, parsing, aggregation, and formatting components.
   *
   * @param storage - Token metrics storage adapter.
   * @param eventParser - Parser for tool execution token events.
   * @param aggregator - Aggregator for session metrics.
   * @param formatter - Formatter for reports and history output.
   * @param config - Router config used for thresholds and cost ratios.
   * @param storageDir - Directory used for persisted token metric files.
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
      ttConfig?.maxSessionsMemory ?? 100,
      ttConfig?.sessionTTLMinutes ?? 30,
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
   * Record a token usage event, optionally with the routing decision that selected the tier.
   *
   * The method parses the event, stores it in memory, correlates orphaned events,
   * updates session aggregation, handles LRU/TTL eviction, and expires orphaned
   * records after the retry window.
   *
   * @param event - Parsed token record or step-finish event to record.
   * @param routing - Routing decision used for correlation.
   * @returns Nothing; failures are logged and swallowed for best-effort operation.
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
    return !!event &&
      typeof event === 'object' &&
      typeof event.sessionID === 'string' &&
      typeof event.tokens?.input === 'number' &&
      typeof event.tokens?.output === 'number';
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
   * Record a step-finish event with real token usage.
   *
   * @param event - Step-finish event containing session ID, tokens, and cost.
   * @returns Nothing; invalid events are ignored and failures are swallowed.
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
   * Record a routing decision for a session and correlate pending orphaned events.
   *
   * @param sessionId - OpenCode session ID that selected the tier.
   * @param routingDecision - Tier and cost ratio selected for correlation.
   * @returns Nothing; failures are logged and swallowed for best-effort operation.
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
   * Get a formatted Markdown report for one token tracking session.
   *
   * The report is read from in-memory cache first and then from persisted disk
   * data. Missing sessions return a concise not-found message.
   *
   * @param sessionId - OpenCode session ID.
   * @returns Markdown report text, or a not-found message when no data exists.
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
   * List all persisted token tracking sessions from disk.
   *
   * Malformed JSON files are skipped and storage errors are logged without
   * throwing into the command layer.
   *
   * @returns Persisted token sessions, in an empty array when none exist.
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
            try {
              const session = JSON.parse(content) as PersistedTokenSession;
              sessions.push(session);
            } catch {
              // Skip malformed files
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
   * Get formatted cost comparison for a session versus a hypothetical tier.
   *
   * The comparison is read from in-memory cache first and then from persisted
   * disk data. Missing sessions return a concise not-found message.
   *
   * @param sessionId - OpenCode session ID.
   * @param tier - Hypothetical tier to compare against.
   * @returns Comparison text, or a not-found message when no data exists.
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
   * Format history for all persisted sessions plus recent in-memory sessions.
   *
   * @returns Markdown history text, or an error message when formatting fails.
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
        if (cached && !persistedSessions.some(s => s.sessionId === sessionId)) {
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
   * Get aggregated metrics for a session from memory or disk.
   *
   * @param sessionId - OpenCode session ID.
   * @returns Aggregated session metrics, or `null` when no data exists or loading fails.
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
   * Explicitly persist token metrics for a session to disk.
   *
   * @param sessionId - OpenCode session ID.
   * @returns Nothing; missing data logs a warning and failures are swallowed.
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
   * Load persisted token metrics for a session from the newest matching disk file.
   *
   * @param sessionId - OpenCode session ID.
   * @returns Aggregated persisted summary, or `null` when no matching file exists or loading fails.
   * @example
   * ```ts
   * const persisted = await tracker.loadPersistedTokenMetrics('sess-abc123');
   * ```
   */
  async loadPersistedTokenMetrics(sessionId: string): Promise<SessionTokenSummary | null> {
    try {
      const files = await this.storage.listFiles(this.storageDir);
      const sessionFiles = files
        .filter(f => f.startsWith(`token-${sessionId.slice(0, 8)}-`) && f.endsWith('.json'))
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

      const persisted = JSON.parse(content) as PersistedTokenSession;
      return persisted.summary;
    } catch (err) {
      console.error('[TokenTracker] Failed to load persisted metrics:', err);
      return null;
    }
  }

  /**
   * Handle session evictions (TTL + LRU).
   * Persist evicted sessions to disk and apply cleanup.
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
   * Persist a session to disk.
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
   * Clean up old files if count exceeds maxHistoryFiles.
   * Keeps newest files, deletes oldest.
   */
  private async cleanupOldFiles(): Promise<void> {
    try {
      const ttConfig = this.config.tokenTracking;
      const maxFiles = ttConfig?.maxHistoryFiles ?? 50;

      const files = await this.storage.listFiles(this.storageDir);
      const tokenFiles = files.filter(f => f.startsWith('token-') && f.endsWith('.json')).sort();

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
   * Stop orphan cleanup timers and clear all in-memory data.
   *
   * @returns Nothing.
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
   * Clear in-memory sessions, records, delegation counts, and orphan buffer.
   *
   * @returns Nothing.
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
