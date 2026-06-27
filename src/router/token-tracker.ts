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
import type { TokenEventParser, TokenRecord, RoutingDecision } from './token-event-parser.js';
import type { RouterConfig } from './config.js';

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
 * OrphanBuffer — ✅ ERRO-002 CORRIGIDO
 *
 * Race condition: A step-finish event arrives before the routing decision is stored.
 * Solution: Buffer orphan events for up to 5 seconds, then retry correlation.
 * After 5s, assign to 'unknown' tier and save immediately.
 */
class OrphanBuffer {
  private buffer: Map<string, { record: TokenRecord; attempts: number; firstSeen: number }> = new Map();
  private readonly MAX_ATTEMPTS = 5;
  private readonly RETRY_INTERVAL_MS = 1000; // 1s between retries
  private readonly MAX_WAIT_MS = 5000; // 5s total wait

  add(record: TokenRecord): void {
    const key = `${record.sessionId}:${record.timestamp}`;
    this.buffer.set(key, { record, attempts: 0, firstSeen: Date.now() });
  }

  /**
   * Try to correlate an orphan record with a routing decision.
   * Return the updated record if found, otherwise return undefined.
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

    // Correlate and remove from buffer
    const correlated: TokenRecord = {
      ...oldestRecord,
      delegatedTier: routingDecision.tier,
      estimatedTokens: routingDecision.estimated,
    };
    this.buffer.delete(oldestKey);
    return correlated;
  }

  /**
   * Get all orphans that have exceeded the max wait time.
   * These will be saved with delegatedTier='unknown'.
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

  size(): number {
    return this.buffer.size;
  }

  clear(): void {
    this.buffer.clear();
  }
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
  }

  /**
   * Record a token usage event, optionally with routing decision.
   * Automatically handles eviction, persistence, and orphan correlation.
   */
  async recordEvent(event: { sessionID: string; tokens: any; cost: number; timestamp?: number }, routing?: RoutingDecision): Promise<void> {
    try {
      // Parse event
      const record = this.eventParser.parse(
        {
          type: 'step-finish',
          sessionID: event.sessionID,
          tokens: event.tokens,
          cost: event.cost,
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

      // If routing decision is provided, add to records
      if (routing) {
        records.push(record);
        this.delegationCounts.set(sessionId, (this.delegationCounts.get(sessionId) ?? 0) + 1);

        // Try to correlate any orphans for this session
        const orphaned = this.orphanBuffer.tryCorrelate(sessionId, routing);
        if (orphaned) {
          records.push(orphaned);
        }
      } else {
        // No routing decision yet — buffer as orphan
        this.orphanBuffer.add(record);
      }

      // Aggregate and cache
      const summary = this.aggregator.aggregateSessionMetrics(records, this.config);
      this.cache.set(sessionId, summary, this.delegationCounts.get(sessionId) ?? 0);

      // Check for evictions
      await this.handleEvictions();
      
      // Check for expired orphans
      const expired = this.orphanBuffer.getExpired();
      for (const expiredRecord of expired) {
        records.push(expiredRecord);
      }
      if (expired.length > 0) {
        const updated = this.aggregator.aggregateSessionMetrics(records, this.config);
        this.cache.set(sessionId, updated, this.delegationCounts.get(sessionId) ?? 0);
      }
    } catch (err) {
      // ✅ best-effort: never crash the plugin
      console.error('[TokenTracker] Failed to record event:', err);
    }
  }

  /**
   * Get formatted report for a session.
   */
  async getSessionReport(sessionId: string): Promise<string> {
    try {
      const summary = this.cache.get(sessionId);
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
   */
  async getComparison(sessionId: string, tier: 'fast' | 'medium' | 'heavy'): Promise<string> {
    try {
      const summary = this.cache.get(sessionId);
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
      const sessions = await this.listSessions();
      return this.formatter.formatHistory(sessions);
    } catch (err) {
      console.error('[TokenTracker] Failed to get history:', err);
      return 'Error generating history';
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
   * Clear all in-memory data (for testing).
   */
  clear(): void {
    this.cache.clear();
    this.orphanBuffer.clear();
    this.sessionRecords.clear();
    this.delegationCounts.clear();
  }
}
