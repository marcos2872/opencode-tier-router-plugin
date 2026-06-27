import { describe, it, expect } from 'vitest';
import { createCapTracker } from '../src/router/caps.js';

describe('createCapTracker', () => {
  it('returns record and getBanner methods', () => {
    const tracker = createCapTracker();
    expect(typeof tracker.record).toBe('function');
    expect(typeof tracker.getBanner).toBe('function');
  });

  it('increments cap counter for read-only tool calls', () => {
    const tracker = createCapTracker();
    const session = 'session-1';

    tracker.record(session, 'read', { path: '/a' });
    expect(tracker.getBanner(session, 'read', { path: '/a' })).toContain('[cap: 1/8]');

    tracker.record(session, 'grep', { pattern: 'x', path: '/b' });
    expect(tracker.getBanner(session, 'grep', { pattern: 'x', path: '/b' })).toContain('[cap: 2/8]');

    tracker.record(session, 'glob', { pattern: '*.ts' });
    expect(tracker.getBanner(session, 'glob', { pattern: '*.ts' })).toContain('[cap: 3/8]');

    tracker.record(session, 'ls', { path: '/c' });
    expect(tracker.getBanner(session, 'ls', { path: '/c' })).toContain('[cap: 4/8]');
  });

  it('does not increment cap counter for non-read-only tools', () => {
    const tracker = createCapTracker();
    const session = 'session-1';

    tracker.record(session, 'write', { path: '/a' });
    expect(tracker.getBanner(session, 'write', { path: '/a' })).toBe('');

    tracker.record(session, 'execute', { command: 'npm test' });
    expect(tracker.getBanner(session, 'execute', { command: 'npm test' })).toBe('');
  });

  it('returns cap counter banner below cap', () => {
    const tracker = createCapTracker();
    const session = 'session-1';

    for (let i = 0; i < 4; i++) {
      tracker.record(session, 'read', { path: `/file-${i}` });
    }

    expect(tracker.getBanner(session, 'read', { path: '/file-3' })).toContain('[cap: 4/8]');
  });

  it('returns cap warning banner when approaching cap', () => {
    const tracker = createCapTracker();
    const session = 'session-1';

    for (let i = 0; i < 6; i++) {
      tracker.record(session, 'read', { path: `/file-${i}` });
    }

    expect(tracker.getBanner(session, 'read', { path: '/file-5' })).toContain('[⚠ CAP WARNING: 2 remaining]');
  });

  it('returns cap reached banner at cap', () => {
    const tracker = createCapTracker();
    const session = 'session-1';

    for (let i = 0; i < 8; i++) {
      tracker.record(session, 'read', { path: `/file-${i}` });
    }

    expect(tracker.getBanner(session, 'read', { path: '/file-7' })).toContain('[⚠ CAP REACHED (8/8)]');
  });

  it('keeps cap reached banner after exceeding cap', () => {
    const tracker = createCapTracker();
    const session = 'session-1';

    for (let i = 0; i < 10; i++) {
      tracker.record(session, 'read', { path: `/file-${i}` });
    }

    expect(tracker.getBanner(session, 'read', { path: '/file-9' })).toContain('[⚠ CAP REACHED (10/8)]');
  });

  it('detects redundant read calls by fingerprint', () => {
    const tracker = createCapTracker();
    const session = 'session-1';

    tracker.record(session, 'read', { path: '/same' });
    tracker.record(session, 'read', { path: '/same' });

    expect(tracker.getBanner(session, 'read', { path: '/same' })).toContain('[⚠ REDUNDANT: this is the same read you ran at call #1]');
  });

  it('detects redundant grep calls by pattern and path', () => {
    const tracker = createCapTracker();
    const session = 'session-1';

    tracker.record(session, 'grep', { pattern: 'foo', path: '/src' });
    tracker.record(session, 'grep', { pattern: 'foo', path: '/src' });

    expect(tracker.getBanner(session, 'grep', { pattern: 'foo', path: '/src' })).toContain('[⚠ REDUNDANT: this is the same grep you ran at call #1]');
  });

  it('does not flag different args as redundant', () => {
    const tracker = createCapTracker();
    const session = 'session-1';

    tracker.record(session, 'read', { path: '/a' });
    tracker.record(session, 'read', { path: '/b' });

    expect(tracker.getBanner(session, 'read', { path: '/b' })).not.toContain('REDUNDANT');
  });

  it('does not flag different tools with same args as redundant', () => {
    const tracker = createCapTracker();
    const session = 'session-1';

    tracker.record(session, 'read', { path: '/a' });
    tracker.record(session, 'grep', { path: '/a' });

    expect(tracker.getBanner(session, 'grep', { path: '/a' })).not.toContain('REDUNDANT');
  });

  it('tracks call numbers globally within session for redundancy', () => {
    const tracker = createCapTracker();
    const session = 'session-1';

    tracker.record(session, 'read', { path: '/a' });
    tracker.record(session, 'read', { path: '/b' });
    tracker.record(session, 'read', { path: '/a' });

    expect(tracker.getBanner(session, 'read', { path: '/a' })).toContain('[⚠ REDUNDANT: this is the same read you ran at call #1]');
  });

  it('isolates sessions', () => {
    const tracker = createCapTracker();

    tracker.record('session-a', 'read', { path: '/shared' });
    tracker.record('session-b', 'read', { path: '/shared' });
    tracker.record('session-a', 'read', { path: '/shared' });

    expect(tracker.getBanner('session-a', 'read', { path: '/shared' })).toContain('[⚠ REDUNDANT: this is the same read you ran at call #1]');
    expect(tracker.getBanner('session-b', 'read', { path: '/shared' })).not.toContain('REDUNDANT');
  });

  it('supports a configurable max cap', () => {
    const tracker = createCapTracker(4);
    const session = 'session-1';

    for (let i = 0; i < 4; i++) {
      tracker.record(session, 'read', { path: `/file-${i}` });
    }

    expect(tracker.getBanner(session, 'read', { path: '/file-3' })).toContain('[⚠ CAP REACHED (4/4)]');
  });
});
