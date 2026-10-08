import { describe, expect, it } from 'vitest';
import type { SessionDraft } from '../../../src/encore/ports';
import type { Domain } from '../../../src/encore/types';
import {
  fallbackDressing,
  fallbackDressings,
  fallbackIntake,
  fallbackNote,
  fallbackSharedGround,
  joinNames,
} from '../../../src/encore/words/fallbacks';
import { findClinicalClaim } from '../../../src/encore/words/schemas';
import { item } from '../plan/builders';

function draftOf(...items: Array<{ id: string; name: string; domain: Domain; tags?: string[] }>): SessionDraft {
  return {
    id: 's1',
    day: 1,
    items: items.map((i) => ({ item: item(i), reason: 'a reason' })),
  };
}

describe('fallbackIntake', () => {
  it('names the person "the resident" and splits favourites on commas, semicolons and line breaks', () => {
    const result = fallbackIntake('Frank Sinatra, Casablanca; The Archers\nVera Lynn\r\n  Brylcreem  ');
    expect(result).toEqual({
      nickname: 'the resident',
      favourites: ['Frank Sinatra', 'Casablanca', 'The Archers', 'Vera Lynn', 'Brylcreem'],
      avoid: [],
      gentle: true,
    });
  });

  it('drops empty parts and repeats', () => {
    expect(fallbackIntake(',, Casablanca ;; casablanca,\n\n').favourites).toEqual(['Casablanca']);
  });

  it('keeps at most 12 favourites of at most 200 characters', () => {
    const many = Array.from({ length: 20 }, (_, n) => `Fav ${n}`).join(', ');
    expect(fallbackIntake(many).favourites).toHaveLength(12);
    expect(fallbackIntake('y'.repeat(500)).favourites[0]).toHaveLength(200);
  });

  it('uses only the first 2,000 characters', () => {
    const text = `${'a'.repeat(1990)}, ${'b'.repeat(10)}, late favourite`;
    const { favourites } = fallbackIntake(text);
    expect(favourites.join('|')).not.toContain('late favourite');
  });

  it('returns an empty list for blank text', () => {
    expect(fallbackIntake('   \n ').favourites).toEqual([]);
  });

  it('never guesses a country or a place', () => {
    const result = fallbackIntake('Born in 1941 in Leeds, loves Sinatra');
    expect(result).not.toHaveProperty('country');
    expect(result).not.toHaveProperty('place');
  });
});

describe('fallbackIntake on a note written as sentences', () => {
  const note =
    "My dad Bernard was born in 1938 in Glasgow. He loved Frank Sinatra, The Great Escape and Hancock's Half Hour. Nothing about the war please.";

  it('reads the favourites that follow "loved"', () => {
    expect(fallbackIntake(note).favourites).toEqual(['Frank Sinatra', 'The Great Escape', "Hancock's Half Hour"]);
  });

  it('reads the year that follows "born"', () => {
    expect(fallbackIntake(note).birthYear).toBe(1938);
    expect(fallbackIntake('Born in 1941 in Leeds, loves Sinatra').birthYear).toBe(1941);
  });

  it('does not take a year that is not a birth year', () => {
    expect(fallbackIntake('She loved the 1966 World Cup')).not.toHaveProperty('birthYear');
    expect(fallbackIntake('Born in Leeds. She moved in 1960 and loved dancing.')).not.toHaveProperty('birthYear');
  });

  it('reads the things to avoid and drops a trailing "please"', () => {
    expect(fallbackIntake(note).avoid).toEqual(['the war']);
    expect(fallbackIntake('She likes Vera Lynn. She hated westerns and boxing.').avoid).toEqual(['westerns', 'boxing']);
  });

  it('never puts a real name in the nickname', () => {
    expect(fallbackIntake(note).nickname).toBe('the resident');
  });

  it('stops a list at "but"', () => {
    const result = fallbackIntake('He loved Frank Sinatra and Dean Martin but hated westerns.');
    expect(result.favourites).toEqual(['Frank Sinatra', 'Dean Martin']);
    expect(result.avoid).toEqual(['westerns']);
  });

  it('gathers favourites from several sentences without repeats', () => {
    const result = fallbackIntake('Mum enjoyed Coronation Street. She was a big fan of Cliff Richard. She loved coronation street.');
    expect(result.favourites).toEqual(['Coronation Street', 'Cliff Richard']);
  });

  it('returns no favourites when the note names none, and never the whole sentence', () => {
    expect(fallbackIntake('She was born in 1930, in the countryside.').favourites).toEqual([]);
  });

  it('keeps at most 12 favourites', () => {
    const many = Array.from({ length: 20 }, (_, n) => `Singer ${n}`).join(', ');
    expect(fallbackIntake(`He loved ${many}.`).favourites).toHaveLength(12);
  });
});

describe('fallbackDressing', () => {
  it('names a mixed session after its two main domains', () => {
    const draft = draftOf(
      { id: 'a', name: 'Casablanca', domain: 'film' },
      { id: 'b', name: 'Frank Sinatra', domain: 'music' },
    );
    expect(fallbackDressing(draft).theme).toBe('Films and music');
  });

  it('puts the more common domain first', () => {
    const draft = draftOf(
      { id: 'a', name: 'A', domain: 'music' },
      { id: 'b', name: 'B', domain: 'tv' },
      { id: 'c', name: 'C', domain: 'tv' },
    );
    expect(fallbackDressing(draft).theme).toBe('Television and music');
  });

  it('uses a shared tag for a single-domain session', () => {
    const draft = draftOf(
      { id: 'a', name: 'A', domain: 'film', tags: ['urn:tag:genre:comedy'] },
      { id: 'b', name: 'B', domain: 'film', tags: ['urn:tag:genre:comedy', 'urn:tag:genre:war'] },
      { id: 'c', name: 'C', domain: 'film', tags: ['urn:tag:genre:war'] },
    );
    // Comedy and war are both on two items; the first seen wins the tie.
    expect(fallbackDressing(draft).theme).toBe('Comedy films');
  });

  it('falls back to the domain alone when no tag is shared', () => {
    const draft = draftOf({ id: 'a', name: 'A', domain: 'book' }, { id: 'b', name: 'B', domain: 'book' });
    expect(fallbackDressing(draft).theme).toBe('Remembering books');
  });

  it('keeps every theme to six words or fewer', () => {
    const domains: Domain[] = ['film', 'tv', 'music', 'book', 'person', 'brand'];
    for (const a of domains) {
      for (const b of domains) {
        const theme = fallbackDressing(draftOf({ id: 'a', name: 'A', domain: a }, { id: 'b', name: 'B', domain: b })).theme;
        expect(theme.split(' ').length).toBeLessThanOrEqual(6);
      }
    }
  });

  it('opens by naming the items', () => {
    const draft = draftOf(
      { id: 'a', name: 'Casablanca', domain: 'film' },
      { id: 'b', name: 'Frank Sinatra', domain: 'music' },
      { id: 'c', name: 'Vera Lynn', domain: 'music' },
    );
    expect(fallbackDressing(draft).opener).toBe(
      "Let's spend a few minutes with Casablanca, Frank Sinatra and Vera Lynn, and see what comes to mind.",
    );
  });

  it('writes four different open questions from templates', () => {
    const draft = draftOf(
      { id: 'a', name: 'Casablanca', domain: 'film' },
      { id: 'b', name: 'Frank Sinatra', domain: 'music' },
      { id: 'c', name: 'The Archers', domain: 'tv' },
    );
    const { prompts } = fallbackDressing(draft);
    expect(prompts).toHaveLength(4);
    expect(new Set(prompts).size).toBe(4);
    for (const prompt of prompts) expect(prompt.endsWith('?')).toBe(true);
    expect(prompts[0]).toBe('What do you remember about Casablanca?');
  });

  it('includes the stock memory questions', () => {
    const music = draftOf({ id: 'b', name: 'Frank Sinatra', domain: 'music' });
    const { prompts } = fallbackDressing(music);
    expect(prompts).toContain('What do you remember about Frank Sinatra?');
    expect(prompts).toContain('Who were you with when you first heard Frank Sinatra?');
  });

  it('writes four different prompts however many items a session has', () => {
    const domains: Domain[] = ['film', 'tv', 'music', 'book', 'person', 'brand'];
    for (const count of [1, 2, 3, 4, 5, 6]) {
      const draft = draftOf(
        ...Array.from({ length: count }, (_, n) => ({ id: `i${n}`, name: `Item ${n}`, domain: domains[n % 6] as Domain })),
      );
      const { prompts } = fallbackDressing(draft);
      expect(prompts).toHaveLength(4);
      expect(new Set(prompts).size).toBe(4);
    }
  });

  it('mentions only the item names, so it states no facts', () => {
    const draft = draftOf({ id: 'a', name: 'Casablanca', domain: 'film' });
    const text = JSON.stringify(fallbackDressing(draft));
    expect(text).not.toMatch(/\b(19|20)\d\d\b/);
  });

  it('copes with a session that has no items', () => {
    const empty: SessionDraft = { id: 's1', day: 1, items: [] };
    const result = fallbackDressing(empty);
    expect(result.theme).not.toBe('');
    expect(result.prompts).toHaveLength(4);
    expect(new Set(result.prompts).size).toBe(4);
  });

  it('dresses a list of drafts in order', () => {
    const drafts = [draftOf({ id: 'a', name: 'A', domain: 'film' }), draftOf({ id: 'b', name: 'B', domain: 'book' })];
    expect(fallbackDressings(drafts)).toEqual(drafts.map((d) => fallbackDressing(d)));
  });
});

describe('fallbackSharedGround', () => {
  const tags = [
    { id: 't1', name: 'Swing' },
    { id: 't2', name: 'Black and white films' },
    { id: 't3', name: 'Radio comedy' },
    { id: 't4', name: 'Knitting' },
  ];

  it('names the people and the first three tags', () => {
    expect(fallbackSharedGround(tags, ['Ann', 'Bea', 'Cyd'])).toEqual([
      'Ann, Bea and Cyd share a taste for Swing, Black and white films and Radio comedy.',
    ]);
    expect(fallbackSharedGround(tags.slice(0, 2), ['Ann', 'Bea'])).toEqual([
      'Ann and Bea share a taste for Swing and Black and white films.',
    ]);
  });

  it('copes with one name, no names and no tags', () => {
    expect(fallbackSharedGround(tags.slice(0, 1), ['Ann'])).toEqual(['Ann has a taste for Swing.']);
    expect(fallbackSharedGround(tags.slice(0, 1), [])).toEqual(['These residents share a taste for Swing.']);
    expect(fallbackSharedGround([], ['Ann', 'Bea'])).toEqual([]);
    expect(fallbackSharedGround([{ id: 'x', name: ' ' }], ['Ann', 'Bea'])).toEqual([]);
  });

  it('skips repeated tag names', () => {
    const repeated = [{ id: 'a', name: 'Swing' }, { id: 'b', name: 'swing' }, { id: 'c', name: 'Jazz' }];
    expect(fallbackSharedGround(repeated, ['Ann', 'Bea'])).toEqual(['Ann and Bea share a taste for Swing and Jazz.']);
  });
});

describe('small helpers', () => {
  it('fallbackNote claims nothing to avoid', () => {
    expect(fallbackNote()).toEqual({ avoidNotes: [] });
  });

  it('joinNames reads naturally', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['A'])).toBe('A');
    expect(joinNames(['A', 'B'])).toBe('A and B');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C');
  });
});

describe('findClinicalClaim', () => {
  it('finds medical and therapeutic wording', () => {
    for (const text of [
      'This is good therapy for you',
      'It may improve your memory',
      'A treatment for dementia',
      'This will help to heal',
      'Because of her Alzheimer\'s',
      'to slow memory loss',
    ]) {
      expect(findClinicalClaim(text, [])).toBeDefined();
    }
  });

  it('leaves ordinary words alone', () => {
    for (const text of ['What was the healthy food like?', 'Who sat with you?', 'It was a treat', 'Do you recall the cinema?']) {
      expect(findClinicalClaim(text, [])).toBeUndefined();
    }
  });

  it('allows a term that is part of a supplied name', () => {
    expect(findClinicalClaim('Did you ever hear The Cure on the radio?', ['The Cure'])).toBeUndefined();
    expect(findClinicalClaim('Did you ever hear The Cure on the radio?', [])).toBe('Cure');
    expect(findClinicalClaim('The Cure is a cure for boredom', ['The Cure'])).toBe('cure');
  });
});
