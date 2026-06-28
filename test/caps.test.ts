import { describe, expect, it } from 'vitest';
import { createCapTracker } from '../src/router/caps.js';

describe('createCapTracker', () => {
  it('retorna métodos de rastreamento', () => {
    const tracker = createCapTracker();

    expect(typeof tracker.record).toBe('function');
    expect(typeof tracker.getBanner).toBe('function');
    expect(typeof tracker.cleanup).toBe('function');
  });

  it('incrementa o limite para ferramentas somente leitura', () => {
    const tracker = createCapTracker();
    const session = 'sessao-1';

    tracker.record(session, 'read', { path: '/a' });
    expect(tracker.getBanner(session, 'read', { path: '/a' })).toContain('[cap: 1/8]');

    tracker.record(session, 'grep', { pattern: 'x', path: '/b' });
    expect(tracker.getBanner(session, 'grep', { pattern: 'x', path: '/b' })).toContain('[cap: 2/8]');

    tracker.record(session, 'glob', { pattern: '*.ts' });
    expect(tracker.getBanner(session, 'glob', { pattern: '*.ts' })).toContain('[cap: 3/8]');

    tracker.record(session, 'ls', { path: '/c' });
    expect(tracker.getBanner(session, 'ls', { path: '/c' })).toContain('[cap: 4/8]');

    tracker.record(session, 'read', { path: '/a' });
    expect(tracker.getBanner(session, 'read', { path: '/a' })).toContain(
      '[⚠ REDUNDANT: this is the same read you ran at call #1]',
    );
    expect(tracker.getBanner(session, 'read', { path: '/a' })).toContain('[cap: 5/8]');
  });

  it('não incrementa o limite para ferramentas não somente leitura', () => {
    const tracker = createCapTracker();
    const session = 'sessao-1';

    tracker.record(session, 'write', { path: '/a' });
    tracker.record(session, 'execute', { command: 'npm test' });

    expect(tracker.getBanner(session, 'write', { path: '/a' })).toBe('');
    expect(tracker.getBanner(session, 'execute', { command: 'npm test' })).toBe('');
  });

  it('retorna banner abaixo do limite', () => {
    const tracker = createCapTracker();
    const session = 'sessao-1';

    for (let i = 0; i < 4; i++) {
      tracker.record(session, 'read', { path: `/file-${i}` });
    }

    expect(tracker.getBanner(session, 'read', { path: '/file-3' })).toContain('[cap: 4/8]');
  });

  it('retorna aviso quando o limite está próximo', () => {
    const tracker = createCapTracker();
    const session = 'sessao-1';

    for (let i = 0; i < 6; i++) {
      tracker.record(session, 'read', { path: `/file-${i}` });
    }

    expect(tracker.getBanner(session, 'read', { path: '/file-5' })).toContain('[⚠ CAP WARNING: 2 remaining]');
  });

  it('retorna aviso quando o limite é atingido', () => {
    const tracker = createCapTracker();
    const session = 'sessao-1';

    for (let i = 0; i < 8; i++) {
      tracker.record(session, 'read', { path: `/file-${i}` });
    }

    expect(tracker.getBanner(session, 'read', { path: '/file-7' })).toContain('[⚠ CAP REACHED (8/8)]');
  });

  it('mantém o aviso quando o limite é excedido', () => {
    const tracker = createCapTracker();
    const session = 'sessao-1';

    for (let i = 0; i < 10; i++) {
      tracker.record(session, 'read', { path: `/file-${i}` });
    }

    expect(tracker.getBanner(session, 'read', { path: '/file-9' })).toContain('[⚠ CAP REACHED (10/8)]');
  });

  it('detecta leituras redundantes pela impressão digital', () => {
    const tracker = createCapTracker();
    const session = 'sessao-1';

    tracker.record(session, 'read', { path: '/same' });
    tracker.record(session, 'read', { path: '/same' });

    expect(tracker.getBanner(session, 'read', { path: '/same' })).toContain(
      '[⚠ REDUNDANT: this is the same read you ran at call #1]',
    );
  });

  it('detecta greps redundantes por padrão e caminho', () => {
    const tracker = createCapTracker();
    const session = 'sessao-1';

    tracker.record(session, 'grep', { pattern: 'foo', path: '/src' });
    tracker.record(session, 'grep', { pattern: 'foo', path: '/src' });

    expect(tracker.getBanner(session, 'grep', { pattern: 'foo', path: '/src' })).toContain(
      '[⚠ REDUNDANT: this is the same grep you ran at call #1]',
    );
  });

  it('não sinaliza argumentos diferentes como redundantes', () => {
    const tracker = createCapTracker();
    const session = 'sessao-1';

    tracker.record(session, 'read', { path: '/a' });
    tracker.record(session, 'read', { path: '/b' });

    expect(tracker.getBanner(session, 'read', { path: '/b' })).not.toContain('REDUNDANT');
  });

  it('não sinaliza ferramentas diferentes com os mesmos argumentos como redundantes', () => {
    const tracker = createCapTracker();
    const session = 'sessao-1';

    tracker.record(session, 'read', { path: '/a' });
    tracker.record(session, 'grep', { path: '/a' });

    expect(tracker.getBanner(session, 'grep', { path: '/a' })).not.toContain('REDUNDANT');
  });

  it('rastreia números de chamada globalmente por sessão', () => {
    const tracker = createCapTracker();
    const session = 'sessao-1';

    tracker.record(session, 'read', { path: '/a' });
    tracker.record(session, 'read', { path: '/b' });
    tracker.record(session, 'read', { path: '/a' });

    expect(tracker.getBanner(session, 'read', { path: '/a' })).toContain(
      '[⚠ REDUNDANT: this is the same read you ran at call #1]',
    );
  });

  it('isola sessoes diferentes', () => {
    const tracker = createCapTracker();

    tracker.record('sessao-a', 'read', { path: '/shared' });
    tracker.record('sessao-b', 'read', { path: '/shared' });
    tracker.record('sessao-a', 'read', { path: '/shared' });

    expect(tracker.getBanner('sessao-a', 'read', { path: '/shared' })).toContain(
      '[⚠ REDUNDANT: this is the same read you ran at call #1]',
    );
    expect(tracker.getBanner('sessao-b', 'read', { path: '/shared' })).not.toContain('REDUNDANT');
  });

  it('suporta limite configuravel', () => {
    const tracker = createCapTracker(4);
    const session = 'sessao-1';

    for (let i = 0; i < 4; i++) {
      tracker.record(session, 'read', { path: `/file-${i}` });
    }

    expect(tracker.getBanner(session, 'read', { path: '/file-3' })).toContain('[⚠ CAP REACHED (4/4)]');
  });

  it('retorna vazio para sessao inexistente', () => {
    const tracker = createCapTracker();

    expect(tracker.getBanner('sessao-inexistente', 'read', { path: '/sem-sessao' })).toBe('');
  });

  it('remove sessoes registradas', () => {
    const tracker = createCapTracker();
    const session = 'sessao-a';

    tracker.record(session, 'read', { path: '/shared' });
    tracker.cleanup(session);

    expect(tracker.getBanner(session, 'read', { path: '/shared' })).toBe('');
  });
});
