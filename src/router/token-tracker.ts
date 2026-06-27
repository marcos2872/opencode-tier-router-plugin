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
export interface PersistedTokenSession {
  version: string; // "1.0" for future compatibility
  sessionId: string;
  delegationCount: number;
  savedAt: number; // timestamp
  summary: SessionTokenSummary;
}

/**
 * SessionCache — In-memory LRU cache with TTL
 *
 * Stores active sessions. When evicted (LRU or TTL), sessions are persisted to disk.
 */
class SessionCache {
  private cache: Map<string, { summary: SessionTokenSummary; lastAccess: number; delegationCount: number }> =
    new Map();
  private accessOrder: string[] = []; // Track LRU order

  constructor(
    private readonly maxSessions: number,
    private readonly ttlMinutes: number,
  ) {}

  set(sessionId: string, summary: SessionTokenSummary, delegationCount: number): void {
    const existing = this.cache.get(sessionId);
    if (existing) {
      // Update and touch LRU
      existing.summary = summary;
      existing.lastAccess = Date.now();
      existing.delegationCount = delegationCount;
      this.touchLRU(sessionId);
    } else {
      // New session
      this.cache.set(sessionId, { summary, lastAccess: Date.now(), delegationCount });
      this.accessOrder.push(sessionId);
    }
  }

  get(sessionId: string): SessionTokenSummary | undefined {
    const entry = this.cache.get(sessionId);
    if (entry) {
      entry.lastAccess = Date.now();
      this.touchLRU(sessionId);
      return entry.summary;
    }
    return undefined;
  }

  /**
   * Get sessions that should be evicted:
   * - Exceeded TTL
   * - Over capacity (LRU)
   */
  getEvictionCandidates(): { sessionId: string; summary: SessionTokenSummary; delegationCount: number }[] {
    const now = Date.now();
    const ttlMs = this.ttlMinutes * 60 * 1000;
    const candidates: { sessionId: string; summary: SessionTokenSummary; delegationCount: number }[] = [];

    // TTL-based eviction
    for (const [sessionId, entry] of this.cache.entries()) {
      if (now - entry.lastAccess >= ttlMs) {
        candidates.push({
          sessionId,
          summary: entry.summary,
          delegationCount: entry.delegationCount,
        });
      }
    }

    // LRU-based eviction (if over capacity)
    if (this.cache.size + candidates.length > this.maxSessions) {
      const toEvict = this.cache.size + candidates.length - this.maxSessions;
      for (let i = 0; i < toEvict && this.accessOrder.length > 0; i++) {
        const sessionId = this.accessOrder.shift()!;
        if (!candidates.some(c => c.sessionId === sessionId)) {
          const entry = this.cache.get(sessionId);
          if (entry) {
            candidates.push({
              sessionId,
              summary: entry.summary,
              delegationCount: entry.delegationCount,
            });
          }
        }
      }
    }

    // Remove from cache
    for (const candidate of candidates) {
      this.cache.delete(candidate.sessionId);
      this.accessOrder = this.accessOrder.filter(s => s !== candidate.sessionId);
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
    this.accessOrder = [];
  }

  private touchLRU(sessionId: string): void {
    this.accessOrder = this.accessOrder.filter(s => s !== sessionId);
    this.accessOrder.push(sessionId);
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
   * Record a token usage event, optionally with routing decision.
   * Automatically handles eviction, persistence, and orphan correlation.
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

  /**
   * Record a step-finish event with real token usage.
   * Called after model response with input/output tokens and cost.
   */
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

  async recordStepFinish(event: StepFinishEvent): Promise<void> {
    if (!this.isStepFinishEvent(event)) return;

    await this.recordEvent(this.toTokenRecord(event));
  }

  /**
   * Record a routing decision for a session.
   * Stores which tier was selected and enables correlation with subsequent events.
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
   * Get formatted report for a session.
   * RTT-T9: Checks cache first, then disk
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
   * List all persisted sessions from disk.
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
   * Get formatted comparison for a session vs hypothetical tier.
   * RTT-T11: Checks cache first, then disk
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
   * Format history of all persisted sessions.
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
   * Get aggregated summary for a session (in-memory or from disk).
   * RTT-T6: getSummary() aggregates metrics.
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
   * RTT-T7: persistTokenMetrics() saves aggregated metrics.
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
   * Load persisted token metrics from disk for a session.
   * RTT-T7: loadPersistedTokenMetrics() restores from disk.
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
    const candidates = this.cache.getEvictionCandidates();

    for (const candidate of candidates) {
      await this.persistSession(candidate.sessionId, candidate.summary, candidate.delegationCount);
      this.sessionRecords.delete(candidate.sessionId);
      this.delegationCounts.delete(candidate.sessionId);
    }

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
   * Stop cleanup timers and clear all in-memory data.
   */
  dispose(): void {
    this.orphanBuffer.stopCleanup();
    this.clear();
  }

  /**
   * Clear all in-memory data (for testing).
   */
  clear(): void {
    this.cache.clear();
    this.orphanBuffer.clear();
    this.sessionRecords.clear();
    this.delegationCounts.clear();
  }
}
