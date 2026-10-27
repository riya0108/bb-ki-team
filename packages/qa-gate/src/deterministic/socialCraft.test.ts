import { describe, expect, it } from 'vitest';

import { lintSocialCraft, socialCraftRevisionNotes } from './socialCraft.js';

const codes = (text: string, platform: 'x' | 'linkedin' = 'x'): string[] => lintSocialCraft(text, platform).map((f) => f.code);

describe('lintSocialCraft', () => {
  it('passes a sharp, specific post', () => {
    const post = '"No-cost EMI" has a cost.\n\nIt\'s just not on the price tag.\n\nSo who pays it?';
    expect(lintSocialCraft(post, 'x')).toEqual([]);
    expect(socialCraftRevisionNotes(lintSocialCraft(post, 'x'))).toEqual([]);
  });

  it('flags engagement bait and hype', () => {
    expect(codes('UPI fees are coming.\n\nLet that sink in.')).toContain('cliche_or_bait');
    expect(codes('This is insane. A thread on UPI:')).toContain('cliche_or_bait');
    expect(codes('This Chinese model has done something that shocked everyone.')).toContain('cliche_or_bait');
  });

  it('flags announcement cringe only on LinkedIn', () => {
    expect(codes("I'm thrilled to share our new report.", 'linkedin')).toContain('cliche_or_bait');
  });

  it('accepts a compact-insight paragraph on X', () => {
    const post =
      "You don't have a savings problem. You have a visibility problem. Money you can see feels like money you are allowed to spend. Hide it, and the temptation goes with it.";
    expect(lintSocialCraft(post, 'x')).toEqual([]);
  });

  it('flags a throat-clearing opening', () => {
    expect(codes('So, the RBI changed UPI rules today.')).toContain('throat_clearing_opening');
    expect(codes('Did you know UPI is free?')).toContain('throat_clearing_opening');
  });

  it('flags a generic bait ending', () => {
    expect(codes('UPI is free for you.\n\nNot for the bank.\n\nThoughts?')).toContain('bait_ending');
  });

  it('treats a moderately long opening as a note and a very long one as a fix', () => {
    const moderate = Array.from({ length: 24 }, (_, i) => `word${i}`).join(' ');
    const long = Array.from({ length: 34 }, (_, i) => `word${i}`).join(' ');
    expect(lintSocialCraft(moderate, 'x').find((f) => f.code === 'long_opening')?.severity).toBe('note');
    expect(lintSocialCraft(long, 'x').find((f) => f.code === 'long_opening')?.severity).toBe('fix');
  });

  it('flags hashtags inside X copy and emoji clutter', () => {
    expect(codes('UPI is changing. #UPI #Fintech')).toContain('hashtags_in_copy');
    expect(codes('UPI is changing 🚀🔥')).toContain('emoji');
  });

  it('only asks for a rewrite when a fix-level finding exists', () => {
    const notesOnly = 'UPI is really very basically free.';
    expect(lintSocialCraft(notesOnly, 'x').map((f) => f.severity)).toEqual(['note']);
    expect(socialCraftRevisionNotes(lintSocialCraft(notesOnly, 'x'))).toEqual([]);
    expect(socialCraftRevisionNotes(lintSocialCraft('Let that sink in. UPI is really very basically free.', 'x')).length).toBe(2);
  });
});
