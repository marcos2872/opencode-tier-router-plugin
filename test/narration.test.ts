import { describe, it, expect } from 'vitest';
import { NARRATION_PATTERNS, detectNarration } from '../src/narration.js';

describe('NARRATION_PATTERNS', () => {
  it('is a non-empty array of regular expressions', () => {
    expect(Array.isArray(NARRATION_PATTERNS)).toBe(true);
    expect(NARRATION_PATTERNS.length).toBeGreaterThan(0);
    for (const pattern of NARRATION_PATTERNS) {
      expect(pattern).toBeInstanceOf(RegExp);
    }
  });
});

describe('detectNarration', () => {
  it('returns null for clean text', () => {
    expect(detectNarration('The function is implemented and tested.')).toBeNull();
    expect(detectNarration('Here is the refactored code.')).toBeNull();
    expect(detectNarration('')).toBeNull();
  });

  it('detects "Still writing/implementing/working on the X" patterns', () => {
    expect(detectNarration('Still writing the auth function')).toContain('Still writing the auth function');
    expect(detectNarration('Still implementing the login flow')).toContain('Still implementing the login flow');
    expect(detectNarration('Still working on the parser')).toContain('Still working on the parser');
  });

  it('detects "Now I\'ll write/implement/add the X" patterns', () => {
    expect(detectNarration("Now I'll write the auth function")).toContain("Now I'll write the auth function");
    expect(detectNarration("Now I'll implement the login flow")).toContain("Now I'll implement the login flow");
    expect(detectNarration("Now I'll add the parser")).toContain("Now I'll add the parser");
  });

  it('detects "Let me write/implement/add the X" patterns', () => {
    expect(detectNarration('Let me write the auth function')).toContain('Let me write the auth function');
    expect(detectNarration('Let me implement the login flow')).toContain('Let me implement the login flow');
    expect(detectNarration('Let me add the parser')).toContain('Let me add the parser');
  });

  it('detects "I\'ll now write/implement the X" patterns', () => {
    expect(detectNarration("I'll now write the auth function")).toContain("I'll now write the auth function");
    expect(detectNarration("I'll now implement the login flow")).toContain("I'll now implement the login flow");
  });

  it('detects "Going to write/implement the X" patterns', () => {
    expect(detectNarration('Going to write the auth function')).toContain('Going to write the auth function');
    expect(detectNarration('Going to implement the login flow')).toContain('Going to implement the login flow');
    expect(detectNarration('I am going to write the parser')).toContain('going to write the parser');
  });

  it('is case-insensitive', () => {
    expect(detectNarration('STILL WRITING THE AUTH FUNCTION')).not.toBeNull();
    expect(detectNarration("now i'll implement the login")).not.toBeNull();
    expect(detectNarration('LET ME ADD THE PARSER')).not.toBeNull();
  });

  it('does not trigger on "reading and writing files"', () => {
    expect(detectNarration('reading and writing files')).toBeNull();
    expect(detectNarration('I was reading and writing files earlier')).toBeNull();
  });

  it('does not trigger on partial matches without narration structure', () => {
    expect(detectNarration('write the function now')).toBeNull();
    expect(detectNarration('implement the login please')).toBeNull();
    expect(detectNarration('add the parser here')).toBeNull();
    expect(detectNarration('the writing is good')).toBeNull();
  });
});
