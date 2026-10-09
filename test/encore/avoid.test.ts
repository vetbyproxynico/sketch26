import { describe, expect, it } from 'vitest';
import {
  AVOID_THEMES,
  GENTLE_THEMES,
  avoidMentionedIn,
  compileAvoidNotes,
  gentleMatch,
  matchAvoid,
  mustAvoid,
  normalise,
  whyLeftOut,
} from '../../src/encore/avoid';
import type { Domain, MapItem } from '../../src/encore/types';
import { deepFreeze } from './plan/builders';

/*
 * Everything here is hand-written. The titles, descriptions and tags are
 * invented to exercise the matching rules. None of it is, or is meant to look
 * like, data from Qloo.
 */

interface Shape {
  domain?: Domain;
  tags?: string[];
  description?: string;
  summary?: string;
}

/** An invented item. Each tag gets an ID made from its name, as `urn:tag:test:<name>`. */
function thing(name: string, shape: Shape = {}): MapItem {
  const built: MapItem = {
    entity: { id: `test-${name}`, name, entityType: 'urn:entity:movie' },
    domain: shape.domain ?? 'film',
    contributions: [],
    eraCheck: 'filter',
    tags: (shape.tags ?? []).map((tag) => ({ id: `urn:tag:test:${tag.toLowerCase().replace(/\s+/g, '_')}`, name: tag })),
  };
  if (shape.description !== undefined) built.description = shape.description;
  if (shape.summary !== undefined) built.summary = shape.summary;
  return built;
}

const avoided = (notes: string[], item: MapItem) => mustAvoid(notes, item);

describe('normalise', () => {
  it.each([
    ['The WAR!', 'the war'],
    ['  war,   and\tpeace ', 'war and peace'],
    ['Café', 'cafe'],
    ['Zoë and Chloé', 'zoe and chloe'],
    ['Œuvre', 'oeuvre'],
    ['Straße', 'strasse'],
    ['Ångström', 'angstrom'],
    ['anti-war', 'anti war'],
    ['world_war_ii', 'world war ii'],
    ["children's", 'children'],
    ["don't", 'dont'],
    ["I'll", 'i'],
    ["we've", 'we'],
    ['it’s', 'it'],
    ["rock 'n' roll", 'rock n roll'],
    ['', ''],
    ['!!!', ''],
  ])('turns %j into %j', (input, expected) => {
    expect(normalise(input)).toBe(expected);
  });

  it('keeps letters from other alphabets, so a note in another language is not erased', () => {
    expect(normalise('מלחמה!')).toBe('מלחמה');
    expect(avoided(['מלחמה'], thing('סרט', { description: 'סרט על מלחמה' }))?.field).toBe('description');
  });
});

describe('what the carer types', () => {
  const militaryTag = thing('A quiet film', { tags: ['Military'] });

  it.each([
    'war',
    'War',
    'WAR',
    'the war',
    'The War.',
    'nothing about the war',
    'Nothing about the war please',
    'no war',
    'no war films please',
    'anything to do with the war',
    'Anything to do with war!',
    'any war',
    'war films',
    'a war film',
    'war scenes',
    'upsetting war scenes',
    'wars',
    'Vietnam war films',
    "I'd rather not see the war",
    'war, please',
  ])('reads %j as the war theme', (note) => {
    const match = avoided([note], militaryTag);
    expect(match).toMatchObject({ note, theme: 'war', found: 'military', field: 'tag' });
  });

  it('keeps the note as typed (trimmed) so it can be quoted back', () => {
    expect(avoided(['  Nothing about the war please  '], militaryTag)?.note).toBe('Nothing about the war please');
  });

  it('splits a note on "and", "or" and punctuation, and each part counts', () => {
    const crime = thing('A', { tags: ['Crime'] });
    const horror = thing('B', { tags: ['Horror'] });
    const dull = thing('C', { tags: ['Gardening'] });
    for (const note of ['war and violence', 'war or violence', 'war, violence', 'war; violence', 'war/violence', 'war & violence', 'war + violence']) {
      expect(avoided([note], militaryTag)?.theme).toBe('war');
      expect(avoided([note], crime)?.theme).toBe('violence and crime');
      expect(avoided([note], horror)).toBeUndefined();
      expect(avoided([note], dull)).toBeUndefined();
    }
  });

  it('ignores a note that says nothing usable', () => {
    for (const note of ['', '   ', 'no', 'please', 'nothing about it', 'no films please', 'films', 'any shows', 'TV programmes']) {
      expect(compileAvoidNotes([note])).toEqual([]);
    }
    expect(avoided(['no films please'], thing('Any film at all', { description: 'A film about films' }))).toBeUndefined();
  });

  it('drops the word for the kind of thing but keeps the rest of a title', () => {
    expect(avoided(['The Truman Show'], thing('The Truman Show'))?.found).toBe('truman');
    expect(avoided(['Pride and Prejudice'], thing('Pride and Prejudice'))).toBeDefined();
  });

  it('keeps every word of a longer note, which then must all be present', () => {
    const both = thing('A', { description: 'A story about horse racing in the north.' });
    const one = thing('B', { description: 'A story about a horse called Dobbin.' });
    expect(avoided(['horse racing'], both)).toMatchObject({ found: 'horse racing', field: 'description' });
    expect(avoided(['horse racing'], one)).toBeUndefined();
    // The words need not be side by side.
    expect(avoided(['racing horses'], thing('C', { description: 'Racing, and a horse.' }))).toBeDefined();
  });

  it('gives the credit to the first note that matches, in the order given', () => {
    const item = thing('A', { tags: ['Western', 'Horror'] });
    expect(avoided(['horror', 'westerns'], item)?.note).toBe('horror');
    expect(avoided(['westerns', 'horror'], item)?.note).toBe('westerns');
  });

  it('returns nothing when there are no notes', () => {
    expect(avoided([], militaryTag)).toBeUndefined();
    expect(matchAvoid([], militaryTag)).toBeUndefined();
  });
});

describe('whole words and simple variants', () => {
  const inName = (name: string) => thing(name);

  it.each([
    ['western', 'Westerns'],
    ['westerns', 'Western'],
    ['westerns', 'westerns'],
    ['box', 'boxing'],
    ['box', 'boxer'],
    ['box', 'boxers'],
    ['box', 'boxes'],
    ['boxing', 'box'],
    ['boxing', 'boxer'],
    ['boxing', 'Boxes'],
    ['boxer', 'boxing'],
    ['comedy', 'comedies'],
    ['comedies', 'comedy'],
    ['zombie', 'zombies'],
    ['zombies', 'zombie'],
    ['hike', 'hiking'],
    ['hiking', 'hiker'],
    ['hiker', 'hike'],
    ['racing', 'race'],
    ['race', 'racing'],
    ['sing', 'singer'],
    ['singing', 'sing'],
    ['kill', 'killing'],
    ['kill', 'killer'],
    ['kill', 'killed'],
    ['murder', 'murdered'],
    ['murdered', 'murderer'],
    ['church', 'churches'],
    ['hospital', 'hospitals'],
    ['stab', 'stabbed'],
    ['abuse', 'abused'],
    ['army', 'armies'],
    ['soldier', 'soldiers'],
    ['café', 'Cafe'],
  ])('the note %j meets the word %j', (note, word) => {
    expect(avoided([note], inName(`The ${word} Show`))).toBeDefined();
    expect(avoided([note], thing('X', { tags: [word] }))).toBeDefined();
    expect(avoided([note], thing('X', { description: `Something about ${word}, mostly.` }))).toBeDefined();
  });

  it.each([
    ['war', 'Warwick'],
    ['war', 'The Award'],
    ['war', 'Awards Night'],
    ['war', 'Software'],
    ['war', 'Warm Bodies'],
    ['war', 'Warner Brothers'],
    ['war', 'Warning Signs'],
    ['war', 'Swarm'],
    ['war', 'Toward the Sun'],
    ['war', 'Warsaw'],
    ['war', 'Warrior Queen'],
    ['war', 'Wardrobe'],
    ['the war', 'Warwick'],
    ['nothing about the war please', 'The Award'],
    ['box', 'Boxwood'],
    ['box', 'Inbox'],
    ['box', 'Boxtrolls'],
    ['kill', 'Skill Tester'],
    ['gin', 'Ginger Rogers'],
    ['gin', 'Beginning'],
    ['rum', 'Rumour Has It'],
    ['god', 'Godfrey'],
    ['pope', 'Popeye'],
    ['nun', 'Nunhead'],
    ['monk', 'Monkey Business'],
    ['die', 'Diet Club'],
    ['grave', 'Gravy Train'],
    ['nurse', 'Nursery Rhymes'],
    ['army', 'Armchair Detectives'],
    ['ill', "I'll Be Home"],
    ['ill', 'Illustrated Man'],
  ])('the note %j does not meet %j', (note, title) => {
    // Items have no tags or description here: only the name is in play.
    expect(avoided([note], thing(title))).toBeUndefined();
  });

  it('matches a whole word in the middle of a sentence, never part of a longer word', () => {
    const note = ['war'];
    expect(avoided(note, thing('X', { description: 'A farmer in the war years.' }))).toBeDefined();
    expect(avoided(note, thing('X', { description: 'A farmer in the Warwickshire years, with an award.' }))).toBeUndefined();
  });

  it('treats punctuation and hyphens as gaps between words', () => {
    expect(avoided(['war'], thing('X', { tags: ['Anti-War'] }))).toBeDefined();
    expect(avoided(['war'], thing('X', { tags: ['post_war_britain'] }))).toBeDefined();
    expect(avoided(['war'], thing('Peace (and war)'))).toBeDefined();
  });

  it('reads the last part of a tag ID when the tag name does not say it', () => {
    const item: MapItem = {
      ...thing('X'),
      tags: [{ id: 'urn:tag:genre:media:horror', name: 'Spine chillers' }],
    };
    expect(avoided(['horror'], item)).toMatchObject({ field: 'tag', theme: 'horror' });
  });

  it('does not use the year, the domain or the affinity as words', () => {
    const item: MapItem = { ...thing('X'), affinity: 0.9, entity: { id: 'x', name: 'X', entityType: 'urn:entity:movie', year: 1945 } };
    expect(avoided(['1945'], item)).toBeUndefined();
    expect(avoided(['film'], item)).toBeUndefined();
  });
});

describe('the summary is read as part of the description', () => {
  it('finds a word the carer asked to avoid in the summary alone', () => {
    const item = thing('Quiet title', { summary: 'A boxing match in a village hall.' });
    expect(avoided(['boxing'], item)).toMatchObject({ found: 'boxing', field: 'description' });
    expect(avoided(['boxing'], thing('Quiet title'))).toBeUndefined();
    expect(avoided(['boxing'], thing('Quiet title', { description: 'A tea dance.', summary: 'A boxing match.' }))?.field).toBe('description');
  });

  it('finds it in the description when the summary says something else', () => {
    expect(avoided(['boxing'], thing('Quiet title', { description: 'A boxing match.', summary: 'A village hall.' }))?.field).toBe('description');
  });

  it('follows a related word of a theme into the summary', () => {
    expect(avoided(['the war'], thing('Quiet title', { summary: 'Soldiers come home.' }))).toBeDefined();
  });

  it('applies Gentle mode to the summary, with the strong words only', () => {
    expect(gentleMatch(thing('Quiet title', { summary: 'A horror film about a lighthouse.' }))).toMatchObject({ theme: 'horror', field: 'description' });
    expect(gentleMatch(thing('Quiet title', { summary: 'A farmer returns from the war.' }))).toBeUndefined();
    expect(whyLeftOut([], true, thing('Quiet title', { summary: 'A true crime series.' }))).toMatchObject({ by: 'gentle', match: { theme: 'murder and true crime' } });
  });

  it('does not find a phrase across the end of the description and the start of the summary', () => {
    const rule = compileAvoidNotes(['wild west']);
    expect(matchAvoid(rule, thing('X', { description: 'A story of the wild', summary: 'west coast ferries.' }))).toBeUndefined();
    expect(matchAvoid(rule, thing('X', { description: 'A story of the wild', summary: 'The wild west.' }))).toBeDefined();
  });

  it('leaves out an item that is clean without the summary and not with it, and keeps one that is clean with it', () => {
    expect(whyLeftOut(compileAvoidNotes(['boxing']), true, thing('Quiet title', { description: 'A tea dance.' }))).toBeUndefined();
    expect(whyLeftOut(compileAvoidNotes(['boxing']), true, thing('Quiet title', { description: 'A tea dance.', summary: 'Boxing returns.' }))?.by).toBe('avoid');
    expect(whyLeftOut(compileAvoidNotes(['boxing']), true, thing('Quiet title', { description: 'A tea dance.', summary: 'A tea dance.' }))).toBeUndefined();
  });
});

describe('where a word is found', () => {
  it('says whether it came from a tag, the name or the description', () => {
    expect(avoided(['boxing'], thing('X', { tags: ['Boxing'] }))?.field).toBe('tag');
    expect(avoided(['boxing'], thing('Boxing Day'))?.field).toBe('name');
    expect(avoided(['boxing'], thing('X', { description: 'Two boxers meet.' }))?.field).toBe('description');
  });

  it('matches a phrase only when its words are side by side in one place', () => {
    const rule = compileAvoidNotes(['wild west']);
    expect(rule).toHaveLength(1);
    expect(matchAvoid(rule, thing('X', { description: 'Life in the wild west.' }))).toBeDefined();
    // "wild" in the name and "west" in the description are not the phrase.
    expect(matchAvoid(rule, thing('Wild', { description: 'The west is quiet.' }))).toBeUndefined();
    // A theme phrase is a phrase: its words must be side by side as well.
    const war = compileAvoidNotes(['world war']);
    expect(matchAvoid(war, thing('X', { description: 'The first world war ended.' }))).toBeDefined();
  });
});

describe('themes', () => {
  it('has the themes the brief asks for, and no more than a dozen', () => {
    const labels = AVOID_THEMES.map((theme) => theme.label);
    for (const wanted of [
      'war',
      'death and funerals',
      'illness and hospitals',
      'violence and crime',
      'horror',
      'religion',
      'politics',
      'alcohol',
      'animals being hurt',
    ]) {
      expect(labels).toContain(wanted);
    }
    expect(AVOID_THEMES.length).toBeLessThanOrEqual(12);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it.each(['wartime', 'world war', 'military', 'soldier', 'army', 'battle'])('"the war" also catches %s', (word) => {
    expect(avoided(['the war'], thing('X', { tags: [word] }))?.theme).toBe('war');
    expect(avoided(['the war'], thing('X', { description: `It is about ${word} life.` }))?.theme).toBe('war');
  });

  it.each(AVOID_THEMES.map((theme) => [theme.label, theme] as const))('theme %s: every term is found, and every term can be typed', (_label, theme) => {
    const domain: Domain = theme.domains?.[0] ?? 'film';
    for (const term of theme.terms) {
      // Typed alone, a term picks its own theme ...
      const rule = compileAvoidNotes([term]);
      expect(rule, `typing "${term}"`).toHaveLength(1);
      expect(rule[0]?.clauses.every((clause) => clause.theme === theme.label), `typing "${term}"`).toBe(true);
      // ... and is then found in each place an item shows it.
      expect(avoided([term], thing('X', { domain, tags: [term] })), `tag "${term}"`).toMatchObject({ theme: theme.label, field: 'tag' });
      expect(avoided([term], thing(`Title with ${term} in it`, { domain })), `name "${term}"`).toMatchObject({ theme: theme.label });
      expect(avoided([term], thing('X', { domain, description: `A story, ${term}, and more.` })), `description "${term}"`).toMatchObject({
        theme: theme.label,
        field: 'description',
      });
    }
  });

  it.each(AVOID_THEMES.map((theme) => [theme.label, theme] as const))('theme %s: the first term finds every other term', (_label, theme) => {
    const domain: Domain = theme.domains?.[0] ?? 'film';
    const typed = theme.terms[0] ?? '';
    for (const term of theme.terms) {
      expect(avoided([typed], thing('X', { domain, tags: [term] })), `"${typed}" -> tag "${term}"`).toMatchObject({ theme: theme.label });
    }
  });

  it.each(AVOID_THEMES.filter((theme) => (theme.alsoTyped ?? []).length > 0).map((theme) => [theme.label, theme] as const))(
    'theme %s: everything else a carer might type picks the theme',
    (_label, theme) => {
      const domain: Domain = theme.domains?.[0] ?? 'film';
      const found = theme.terms[0] ?? '';
      for (const typed of theme.alsoTyped ?? []) {
        expect(avoided([typed], thing('X', { domain, tags: [found] })), `typing "${typed}"`).toMatchObject({ theme: theme.label });
      }
    },
  );

  it('lets a carer write the words of a phrase in any order', () => {
    const item = thing('X', { description: 'Shows the cruelty to animals of the old days.' });
    for (const note of ['animals being hurt', 'hurt animals', 'no cruelty to animals', 'animal cruelty', 'animals suffering', 'animal abuse']) {
      expect(avoided([note], item), note).toMatchObject({ theme: 'animals being hurt' });
    }
  });

  it('does not make the bare word "animals" a theme', () => {
    const bullfight = thing('X', { description: 'A bullfight in the old town.' });
    expect(avoided(['animals being hurt'], bullfight)).toMatchObject({ theme: 'animals being hurt' });
    expect(avoided(['animals'], bullfight)).toBeUndefined();
    expect(avoided(['animals'], thing('X', { description: 'Many animals.' }))).toMatchObject({ found: 'animals' });
  });

  it('applies genre themes only to the kinds of item they make sense for', () => {
    const musicianWestern = thing('X', { domain: 'music', description: 'A country and western singer.' });
    const filmWestern = thing('X', { domain: 'film', description: 'A western about a sheriff.' });
    const bookWestern = thing('X', { domain: 'book', tags: ['Western'] });
    expect(avoided(['westerns'], musicianWestern)).toBeUndefined();
    expect(avoided(['westerns'], thing('X', { domain: 'person', tags: ['Western'] }))).toBeUndefined();
    expect(avoided(['westerns'], filmWestern)).toBeDefined();
    expect(avoided(['westerns'], bookWestern)).toBeDefined();

    const bandWithMusicalGift = thing('X', { domain: 'music', description: 'A musical group with a musical gift.' });
    expect(avoided(['musicals'], bandWithMusicalGift)).toBeUndefined();
    expect(avoided(['musicals'], thing('X', { domain: 'film', tags: ['Musical'] }))).toBeDefined();
    expect(avoided(['musicals'], thing('X', { domain: 'tv', tags: ['Musical'] }))).toBeDefined();
    expect(avoided(['musicals'], thing('X', { domain: 'book', tags: ['Musical'] }))).toBeUndefined();
  });

  it('does not apply a domain limit to a word the carer typed that is not in a theme', () => {
    expect(avoided(['banjos'], thing('X', { domain: 'music', description: 'The banjo sings.' }))).toBeDefined();
    // A theme word typed on its own is read as the theme, so the limit applies to it.
    expect(avoided(['sheriffs'], thing('X', { domain: 'music', description: 'The sheriff sings.' }))).toBeUndefined();
  });

  it('keeps themes apart: typing a term from one theme does not bring in another', () => {
    // A word that two themes both list (there are none today) would have to be named here.
    const sharedOnPurpose: Record<string, string[]> = {};
    for (const theme of AVOID_THEMES) {
      for (const term of theme.terms) {
        const labels = new Set(compileAvoidNotes([term]).flatMap((rule) => rule.clauses.map((clause) => clause.theme)));
        expect([...labels], `"${term}"`).toEqual(sharedOnPurpose[term] ?? [theme.label]);
      }
    }
  });

  it('lets the more specific phrase win when one word is shared', () => {
    const labels = (note: string) => [...new Set(compileAvoidNotes([note]).flatMap((rule) => rule.clauses.map((clause) => clause.theme)))];
    expect(labels('animal abuse')).toEqual(['animals being hurt']);
    expect(labels('abuse')).toEqual(['violence and crime']);
    // Two themes that each hold a different word of the note are both brought in.
    expect(labels('war and wine')).toEqual(['war', 'alcohol']);
  });

  it('puts every word in the tables in the simplest form that the matcher can meet', () => {
    // A word listed in the table must find itself, so a typo or a double space cannot hide in the table.
    for (const theme of AVOID_THEMES) {
      for (const term of [...theme.terms, ...(theme.alsoTyped ?? [])]) {
        expect(normalise(term), `"${term}"`).toBe(term.replace(/-/g, ' '));
        expect(term, `"${term}"`).toBe(term.toLowerCase());
        expect(term.trim(), `"${term}"`).toBe(term);
      }
    }
  });

  it('does not bring in the whole war theme for "Star Wars" unless the item says so (a known limit)', () => {
    // The note "war" meets the word "wars": that is a known false positive, documented in the README.
    expect(avoided(['war'], thing('Star Wars'))).toBeDefined();
    expect(avoided(['war'], thing('Star Trek'))).toBeUndefined();
  });
});

describe('Gentle mode', () => {
  it('has the eight themes of the brief, in order', () => {
    expect(GENTLE_THEMES.map((theme) => theme.label)).toEqual([
      'war',
      'graphic violence',
      'horror',
      'murder and true crime',
      'abuse',
      'disaster',
      'terminal illness',
      'suicide',
    ]);
  });

  // Where two themes list the same word, or one holds a longer phrase that contains
  // the other's word, the first theme in the table that lists the word is the one named.
  const firstListing = (word: string, where: 'tags' | 'strong' | 'both'): string =>
    GENTLE_THEMES.find((theme) => (where === 'strong' ? theme.strong : where === 'tags' ? theme.tags : [...theme.tags, ...theme.strong]).includes(word))
      ?.label ?? '';

  it.each(GENTLE_THEMES.map((theme) => [theme.label, theme] as const))('theme %s: every tag word is found in a tag', (_label, theme) => {
    for (const word of theme.tags) {
      expect(gentleMatch(thing('Quiet title', { tags: [word] })), `tag "${word}"`).toMatchObject({
        theme: firstListing(word, 'both'),
        field: 'tag',
      });
    }
  });

  it.each(GENTLE_THEMES.map((theme) => [theme.label, theme] as const))('theme %s: every strong word is found in a name, a description and a tag', (_label, theme) => {
    for (const word of theme.strong) {
      expect(gentleMatch(thing(`A ${word} story`)), `name "${word}"`).toMatchObject({ theme: firstListing(word, 'strong'), field: 'name' });
      expect(gentleMatch(thing('Quiet title', { description: `It has ${word}, sadly.` })), `description "${word}"`).toMatchObject({
        theme: firstListing(word, 'strong'),
        field: 'description',
      });
      expect(gentleMatch(thing('Quiet title', { tags: [word] })), `tag "${word}"`).toMatchObject({ theme: firstListing(word, 'both'), field: 'tag' });
    }
  });

  it('names the theme of the longer phrase when two themes both match a tag', () => {
    expect(gentleMatch(thing('X', { tags: ['Domestic Violence'] }))?.theme).toBe('abuse');
    expect(gentleMatch(thing('X', { tags: ['Violence'] }))?.theme).toBe('graphic violence');
    expect(gentleMatch(thing('X', { tags: ['Assisted Suicide'] }))?.theme).toBe('suicide');
    // Equal length: the theme that comes first in the table.
    expect(gentleMatch(thing('X', { tags: ['Slasher'] }))?.theme).toBe('graphic violence');
  });

  it('looks at tags before the name, and the name before the description', () => {
    const item = thing('A zombie story', { description: 'A famine in the north.', tags: ['Earthquake'] });
    expect(gentleMatch(item)).toMatchObject({ field: 'tag', theme: 'disaster' });
    expect(gentleMatch({ ...item, tags: [] })).toMatchObject({ field: 'name', theme: 'horror' });
    expect(gentleMatch({ ...item, tags: [], entity: { ...item.entity, name: 'Quiet title' } })).toMatchObject({ field: 'description', theme: 'disaster' });
  });

  it.each(GENTLE_THEMES.map((theme) => [theme.label, theme] as const))('theme %s: a word that is only for tags is not enough in a description', (_label, theme) => {
    const everyStrong = GENTLE_THEMES.flatMap((other) => other.strong).map(normalise);
    const strong = new Set(theme.strong);
    const tagOnly = theme.tags.filter((word) => !strong.has(word));
    for (const word of tagOnly) {
      // "child abuse" holds the strong word "abuse", so a description is right to catch it.
      const holdsStrong = everyStrong.some((phrase) => ` ${normalise(word)} `.includes(` ${phrase} `));
      if (holdsStrong) continue;
      expect(gentleMatch(thing('Quiet title', { description: `Something about ${word} here.` })), `description "${word}"`).toBeUndefined();
      expect(gentleMatch(thing(`The ${word} Club`)), `name "${word}"`).toBeUndefined();
    }
  });

  it('checks tags with every word of a theme', () => {
    for (const [tag, theme] of [
      ['War', 'war'],
      ['Military', 'war'],
      ['Gory', 'graphic violence'],
      ['Horror', 'horror'],
      ['Zombie Horror', 'horror'],
      ['True Crime', 'murder and true crime'],
      ['Murder Mystery', 'murder and true crime'],
      ['Disaster', 'disaster'],
      ['Cancer', 'terminal illness'],
      ['Dementia', 'terminal illness'],
      ['Suicide', 'suicide'],
    ] as const) {
      expect(gentleMatch(thing('Quiet title', { tags: [tag] }))?.theme, tag).toBe(theme);
    }
  });

  it('is careful with descriptions: a bare "war" or a cosy mystery does not count', () => {
    for (const description of [
      'During the war a bar owner in Casablanca meets an old flame.',
      'A farmer returns from the war and finds the village changed.',
      'A battle of wits between two sisters.',
      'A military band plays at the fete.',
      'To her horror, the cake collapsed.',
      'A detective investigates the murder of the vicar.',
      'A comedy of errors at the funeral parlour.',
      'He is dying to see the sea.',
      'A disaster of a wedding.',
      'The soldier falls in love with a farmer.',
    ]) {
      expect(gentleMatch(thing('Quiet title', { description })), description).toBeUndefined();
    }
  });

  it('is strong about strong words in a description', () => {
    for (const [description, theme] of [
      ['A family in wartime Britain.', 'war'],
      ['A story of the First World War.', 'war'],
      ['A horror film about a lighthouse.', 'horror'],
      ['A true crime series about a small town.', 'murder and true crime'],
      ['A serial killer stalks the city.', 'murder and true crime'],
      ['A drama about child abuse.', 'abuse'],
      ['A man with terminal illness decides to travel.', 'terminal illness'],
      ['A natural disaster strikes the coast.', 'disaster'],
    ] as const) {
      expect(gentleMatch(thing('Quiet title', { description }))?.theme, description).toBe(theme);
    }
  });

  it('matches whole words and simple variants', () => {
    expect(gentleMatch(thing('X', { tags: ['Zombies'] }))?.theme).toBe('horror');
    expect(gentleMatch(thing('X', { description: 'The abused child.' }))?.theme).toBe('abuse');
    expect(gentleMatch(thing('X', { tags: ['Warwick'] }))).toBeUndefined();
    expect(gentleMatch(thing('X', { tags: ['Award Winners'] }))).toBeUndefined();
    expect(gentleMatch(thing('X', { tags: ['Grape Harvest'] }))).toBeUndefined();
    expect(gentleMatch(thing('X', { description: 'A pirate from Cancun.' }))).toBeUndefined();
  });

  it('reads the last part of a tag ID too', () => {
    const item: MapItem = { ...thing('X'), tags: [{ id: 'urn:tag:genre:media:war', name: 'Conflict' }] };
    expect(gentleMatch(item)).toMatchObject({ theme: 'war', field: 'tag' });
  });

  it('lets a harmless item through', () => {
    expect(gentleMatch(thing('Example Film Alpha', { tags: ['Comedy', 'Romance'], description: 'An invented story about a lighthouse.' }))).toBeUndefined();
    expect(gentleMatch(thing('X'))).toBeUndefined();
  });
});

describe('both together', () => {
  const warFilm = thing('X', { tags: ['War'] });
  const westernFilm = thing('Y', { tags: ['Western'] });

  it('tries the avoid list first, then Gentle mode when it is on', () => {
    const rules = compileAvoidNotes(['war']);
    expect(whyLeftOut(rules, true, warFilm)).toMatchObject({ by: 'avoid', match: { note: 'war' } });
    expect(whyLeftOut(rules, false, warFilm)).toMatchObject({ by: 'avoid' });
    expect(whyLeftOut([], true, warFilm)).toMatchObject({ by: 'gentle', match: { theme: 'war' } });
    expect(whyLeftOut([], false, warFilm)).toBeUndefined();
    expect(whyLeftOut(rules, true, westernFilm)).toBeUndefined();
  });

  it('with Gentle mode off, only the avoid list applies', () => {
    const horror = thing('X', { tags: ['Horror'] });
    expect(whyLeftOut([], false, horror)).toBeUndefined();
    expect(whyLeftOut(compileAvoidNotes(['westerns']), false, horror)).toBeUndefined();
    expect(whyLeftOut(compileAvoidNotes(['horror']), false, horror)).toMatchObject({ by: 'avoid' });
  });

  it('can test a line of wording against the avoid list', () => {
    const rules = compileAvoidNotes(['the war']);
    expect(avoidMentionedIn(rules, "Let's talk about the songs of the war years.")).toMatchObject({ theme: 'war' });
    expect(avoidMentionedIn(rules, 'Who sang along with you in the kitchen?')).toBeUndefined();
    expect(avoidMentionedIn([], 'The war.')).toBeUndefined();
  });
});

describe('purity', () => {
  it('gives the same answer every time and changes nothing it is given', () => {
    const notes = deepFreeze(['Nothing about the war please', 'westerns', 'boxing']);
    const item = deepFreeze(thing('Rio', { tags: ['Western', 'Military'], description: 'A boxer rides west.' }));
    const first = mustAvoid(notes, item);
    for (let i = 0; i < 5; i += 1) expect(mustAvoid(notes, item)).toEqual(first);
    expect(first).toMatchObject({ note: 'Nothing about the war please', theme: 'war' });
    expect(gentleMatch(item)).toEqual(gentleMatch(item));
    expect(notes).toEqual(['Nothing about the war please', 'westerns', 'boxing']);
  });

  it('compiles notes without keeping state between calls', () => {
    const a = compileAvoidNotes(['war']);
    const b = compileAvoidNotes(['war']);
    expect(a).toEqual(b);
    expect(compileAvoidNotes(['boxing'])).not.toEqual(a);
  });
});
