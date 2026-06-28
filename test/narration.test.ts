import { describe, expect, it } from 'vitest';
import { NARRATION_PATTERNS, detectNarration } from '../src/narration.js';

describe('NARRATION_PATTERNS', () => {
  it('é um array não vazio de expressões regulares', () => {
    expect(Array.isArray(NARRATION_PATTERNS)).toBe(true);
    expect(NARRATION_PATTERNS.length).toBeGreaterThan(0);

    for (const pattern of NARRATION_PATTERNS) {
      expect(pattern).toBeInstanceOf(RegExp);
    }
  });
});

describe('detectNarration', () => {
  it('retorna null para texto limpo', () => {
    expect(detectNarration('The function is implemented and tested.')).toBeNull();
    expect(detectNarration('Here is the refactored code.')).toBeNull();
    expect(detectNarration('')).toBeNull();
  });

  it('detecta padrões "Still writing/implementing/working on the X"', () => {
    expect(detectNarration('Still writing the auth function')).toContain('Still writing the auth function');
    expect(detectNarration('Still implementing the login flow')).toContain('Still implementing the login flow');
    expect(detectNarration('Still working on the parser')).toContain('Still working on the parser');
  });

  it('detecta padrões "Now I\'ll write/implement/add the X"', () => {
    expect(detectNarration("Now I'll write the auth function")).toContain("Now I'll write the auth function");
    expect(detectNarration("Now I'll implement the login flow")).toContain("Now I'll implement the login flow");
    expect(detectNarration("Now I'll add the parser")).toContain("Now I'll add the parser");
  });

  it('detecta padrões "Let me write/implement/add the X"', () => {
    expect(detectNarration('Let me write the auth function')).toContain('Let me write the auth function');
    expect(detectNarration('Let me implement the login flow')).toContain('Let me implement the login flow');
    expect(detectNarration('Let me add the parser')).toContain('Let me add the parser');
  });

  it('detecta padrões "I\'ll now write/implement the X"', () => {
    expect(detectNarration("I'll now write the auth function")).toContain("I'll now write the auth function");
    expect(detectNarration("I'll now implement the login flow")).toContain("I'll now implement the login flow");
  });

  it('detecta padrões "Going to write/implement the X"', () => {
    expect(detectNarration('Going to write the auth function')).toContain('Going to write the auth function');
    expect(detectNarration('Going to implement the login flow')).toContain('Going to implement the login flow');
    expect(detectNarration('I am going to write the parser')).toContain('going to write the parser');
  });

  it('é insensível a maiúsculas e minúsculas', () => {
    expect(detectNarration('STILL WRITING THE AUTH FUNCTION')).not.toBeNull();
    expect(detectNarration("now i'll implement the login")).not.toBeNull();
    expect(detectNarration('LET ME ADD THE PARSER')).not.toBeNull();
  });

  it('não aciona leitura e escrita de arquivos', () => {
    expect(detectNarration('reading and writing files')).toBeNull();
    expect(detectNarration('I was reading and writing files earlier')).toBeNull();
  });

  it('não aciona trechos sem estrutura narrativa', () => {
    expect(detectNarration('write the function now')).toBeNull();
    expect(detectNarration('implement the login please')).toBeNull();
    expect(detectNarration('add the parser here')).toBeNull();
    expect(detectNarration('the writing is good')).toBeNull();
  });
});
