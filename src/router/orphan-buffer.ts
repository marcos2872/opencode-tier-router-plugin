/**
 * OrphanBuffer — ✅ ERRO-002 CORRIGIDO
 *
 * Race condition fix: A step-finish event arrives before the routing decision is stored.
 * 
 * Problem: Plugin hook order is not guaranteed. Example:
 *   1. chat.message hook fires → event arrives → no routing decision yet in memory
 *   2. routing decision is stored seconds later
 *   Result: Event is recorded with delegatedTier='unknown' 
 *
 * Solution: Buffer orphan events for up to 5 seconds with retry logic.
 * After 5s, assign to 'unknown' tier and persist immediately.
 *
 * Implementation:
 * - Store events with timestamp and attempt count
 * - tryCorrelate(sessionId, decision) returns oldest orphan if found
 * - getExpired() returns all orphans exceeding MAX_WAIT_MS
 * - size() returns current buffer size (for monitoring)
 */

import type { TokenRecord, RoutingDecision } from './token-event-parser.js';

interface OrphanEntry {
  record: TokenRecord;
  attempts: number;
  firstSeen: number;
}

/**
 * OrphanBuffer — Temporary storage for events awaiting routing decisions
 *
 * Thread-safe in Node.js (single-threaded event loop).
 * Memory bounded: max ~100 orphans × 200 bytes = 20KB.
 */
export class OrphanBuffer {
  private buffer: Map<string, OrphanEntry> = new Map();
  private readonly MAX_ATTEMPTS = 5;
  private readonly RETRY_INTERVAL_MS = 1000; // 1s between retries
  private readonly MAX_WAIT_MS = 5000; // 5s total wait before marking as unknown

  /**
   * Add an orphaned record to the buffer.
   * Key: `sessionId:timestamp` (unique per event within session).
   */
  add(record: TokenRecord): void {
    const key = `${record.sessionId}:${record.timestamp}`;
    this.buffer.set(key, { record, attempts: 0, firstSeen: Date.now() });
  }

  /**
   * Try to correlate an orphan with a routing decision.
   * Returns the updated record (with tier filled in) if found, else undefined.
   * Removes the correlated entry from buffer.
   *
   * Strategy: Use oldest orphan for this session (FIFO fairness).
   * This ensures events are correlated in temporal order.
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
      estimatedCost: routingDecision.estimated && routingDecision.costRatio
        ? (routingDecision.costRatio * (routingDecision.estimated.input + routingDecision.estimated.output)) / 1000
        : undefined,
    };

    this.buffer.delete(oldestKey);
    return correlated;
  }

  /**
   * Get all orphans that have exceeded the max wait time (5s).
   * These will be saved with delegatedTier='unknown'.
   * Removes them from buffer.
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
   * Current buffer size (for monitoring/testing).
   */
  size(): number {
    return this.buffer.size;
  }

  /**
   * Clear all buffered entries (for testing/cleanup).
   */
  clear(): void {
    this.buffer.clear();
  }

  /**
   * Get all entries (for testing/inspection).
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
