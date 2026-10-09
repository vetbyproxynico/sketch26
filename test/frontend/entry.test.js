import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entry, stamp } from '../../public/js/components/entry.js';
import { byClass, byTag, findAll, firstByClass, installFakeDom } from './fake-dom.js';

/*
 * One suggestion as a card: the stamp with its year, and what the card says
 * about the thing. Every name and sentence here is invented for these tests.
 */

let dom;
beforeEach(() => {
  dom = installFakeDom();
});
afterEach(() => {
  dom.restore();
});

const WINDOW = { fromYear: 1951, toYear: 1971 };
const entityOf = (domain, year, extra = {}) => ({ id: `INV-${domain}`, name: `Invented ${domain}`, entityType: `urn:entity:${domain}`, domain, ...(year === undefined ? {} : { year }), ...extra });
const itemOf = (domain, year, extra = {}) => ({ domain, entity: entityOf(domain, year), contributions: [], eraCheck: 'unchecked', tags: [], ...extra });

/** The words of a stamp in the order a sighted reader meets them, and those that only a screen reader gets. */
function readStamp(el) {
  const spans = el.children.filter((child) => child.tag === 'span');
  return {
    hidden: spans.filter((span) => span.classes.includes('visually-hidden')).map((span) => span.textContent),
    seen: spans.filter((span) => !span.classes.includes('visually-hidden')).map((span) => [span.classes[0], span.textContent]),
    ariaHidden: spans.filter((span) => span.getAttribute('aria-hidden') === 'true').map((span) => span.textContent),
  };
}

describe('the stamp', () => {
  it('reads "from" a year on a music card, and tells a screen reader they were performing from it', () => {
    const el = stamp(entityOf('music', 1958), 'music', false);
    expect(el.classes).toEqual(['stamp', 'stamp--music']);
    expect(readStamp(el)).toEqual({
      hidden: ['Performing from: '],
      seen: [
        ['stamp-lead', 'from'],
        ['stamp-year', '1958'],
      ],
      ariaHidden: ['from'],
    });
  });

  it('reads "founded" a year on a brand card, and tells a screen reader it was founded then', () => {
    const el = stamp(entityOf('brand', 1925), 'brand', false);
    expect(readStamp(el)).toEqual({
      hidden: ['Founded: '],
      seen: [
        ['stamp-lead', 'founded'],
        ['stamp-year', '1925'],
      ],
      ariaHidden: ['founded'],
    });
  });

  it('puts the word before the year and the kind after it, when the kind is shown', () => {
    const music = readStamp(stamp(entityOf('music', 1958), 'music', true));
    expect(music.seen).toEqual([
      ['stamp-lead', 'from'],
      ['stamp-year', '1958'],
      ['stamp-kind', 'Music'],
    ]);
    const brand = readStamp(stamp(entityOf('brand', 1925), 'brand', true));
    expect(brand.seen).toEqual([
      ['stamp-lead', 'founded'],
      ['stamp-year', '1925'],
      ['stamp-kind', 'Brand'],
    ]);
  });

  it('is read in order by a screen reader without saying "from" twice', () => {
    // The visible word is hidden from assistive technology; the hidden text says it once, ahead of the year.
    const el = stamp(entityOf('music', 1958), 'music', false);
    const spoken = el.children.filter((child) => child.getAttribute('aria-hidden') !== 'true').map((child) => child.textContent).join('');
    expect(spoken).toBe('Performing from: 1958');
  });

  it('keeps the older stamps as they were: the plain year for a film, television programme or book, "born" for a person', () => {
    for (const domain of ['film', 'tv', 'book']) {
      const el = stamp(entityOf(domain, 1960), domain, false);
      expect(readStamp(el)).toEqual({ hidden: ['Year: '], seen: [['stamp-year', '1960']], ariaHidden: [] });
    }
    expect(readStamp(stamp(entityOf('person', 1921), 'person', false))).toEqual({
      hidden: ['Born: '],
      seen: [
        ['stamp-year', '1921'],
        ['stamp-kind', 'born'],
      ],
      ariaHidden: [],
    });
    expect(readStamp(stamp(entityOf('person', 1921), 'person', true)).seen[1]).toEqual(['stamp-kind', 'Person, born']);
  });

  it('says "Year not known" and adds no word to a music or brand card that has no year', () => {
    for (const domain of ['music', 'brand']) {
      const el = stamp(entityOf(domain), domain, true);
      expect(el.classes).toContain('stamp--undated');
      expect(readStamp(el)).toEqual({
        hidden: [],
        seen: [
          ['stamp-none', 'Year not known'],
          ['stamp-kind', domain === 'music' ? 'Music' : 'Brand'],
        ],
        ariaHidden: [],
      });
    }
  });
});

describe('the era line of a card', () => {
  const eraOf = (item, window = WINDOW) => {
    const el = entry(item, { window });
    const era = firstByClass(el, 'era');
    return era ? { classes: era.classes, label: firstByClass(era, 'era-label').textContent, text: firstByClass(era, 'era-text').textContent } : null;
  };

  it('says on a dated music card that they were performing from that year, tied to the person\'s years', () => {
    expect(eraOf(itemOf('music', 1958, { eraCheck: 'dated' }))).toEqual({
      classes: ['era', 'era--filter'],
      label: 'Around in their years',
      text: 'Performing from 1958, in time for 1951 to 1971, when this person was about 10 to 30.',
    });
  });

  it('says on a dated brand card that it was founded in that year, tied to the person\'s years', () => {
    expect(eraOf(itemOf('brand', 1925, { eraCheck: 'dated' }))).toEqual({
      classes: ['era', 'era--filter'],
      label: 'Around in their years',
      text: 'Founded in 1925, in time for 1951 to 1971, when this person was about 10 to 30.',
    });
  });

  it('still reads the older checks as it did', () => {
    expect(eraOf(itemOf('music', undefined, { eraCheck: 'age_skew', ageSkew55Plus: 0.3 }))?.label).toBe('Popular with older people');
    expect(eraOf(itemOf('brand', undefined, { eraCheck: 'unchecked' }))?.label).toBe('Era not checked');
    expect(eraOf(itemOf('film', 1960, { eraCheck: 'filter' }))?.label).toBe('From their years');
  });

  it('is left off when the page asks for no era line', () => {
    expect(firstByClass(entry(itemOf('music', 1958, { eraCheck: 'dated' }), { showEra: false }), 'era')).toBeUndefined();
  });
});

describe('what a card says about the thing', () => {
  const LONG =
    'A longer invented description of the thing. It goes on for a while and says a good deal more than the short line does, so that it is worth keeping behind a button. It has more than a hundred and seventy characters, which is the point at which the card cuts a description short.';
  const bodyOf = (item) => firstByClass(entry(item, {}), 'entry-desc');

  it('shows the summary, and puts the long description behind "More about it"', () => {
    const desc = bodyOf(itemOf('film', 1960, { summary: 'A short invented line.', description: LONG }));
    expect(desc.tag).toBe('div');
    expect(firstByClass(desc, 'entry-desc-short').textContent).toBe('A short invented line.');
    const [details] = byTag(desc, 'details');
    expect(details.classes).toContain('entry-more');
    const [summary] = byTag(details, 'summary');
    expect(summary.textContent).toBe('More about it: Invented film');
    expect(byTag(details, 'p').map((p) => p.textContent)).toEqual([LONG]);
    // The long text is not on the card itself.
    expect(findAll(desc, (el) => el.tag === 'p' && el.classes.includes('entry-desc-short')).map((p) => p.textContent)).toEqual(['A short invented line.']);
  });

  it('keeps the long description behind the button even when it is short', () => {
    const desc = bodyOf(itemOf('film', 1960, { summary: 'A short invented line.', description: 'A little more.' }));
    expect(byTag(desc, 'details')).toHaveLength(1);
    expect(byTag(desc, 'details')[0].textContent).toContain('A little more.');
  });

  it('gives the screen reader the name of the thing after "More about it"', () => {
    const [summary] = byTag(bodyOf(itemOf('music', 1958, { summary: 'Short.', description: LONG })), 'summary');
    expect(summary.children.map((child) => child.textContent)).toEqual(['More about it', ': Invented music']);
    expect(summary.children[1].classes).toContain('visually-hidden');
  });

  it('shows the summary alone, with no button, when there is no other description', () => {
    const desc = bodyOf(itemOf('brand', 1925, { summary: 'A short invented line.' }));
    expect(desc.tag).toBe('p');
    expect(desc.textContent).toBe('A short invented line.');
    expect(byTag(desc, 'details')).toHaveLength(0);
  });

  it('shows it once, with no button, when the description only repeats the summary', () => {
    const same = bodyOf(itemOf('film', 1960, { summary: 'A short invented line.', description: '  A short  invented line.\n' }));
    expect(same.tag).toBe('p');
    expect(same.textContent).toBe('A short invented line.');
  });

  it('does what it always did when there is no summary: a short description in full, a long one cut with the rest behind the button', () => {
    const short = bodyOf(itemOf('film', 1960, { description: 'A short invented line.' }));
    expect(short.tag).toBe('p');
    expect(short.textContent).toBe('A short invented line.');

    const long = bodyOf(itemOf('film', 1960, { description: LONG }));
    expect(long.tag).toBe('div');
    expect(firstByClass(long, 'entry-desc-short').textContent.length).toBeLessThan(LONG.length);
    expect(byTag(long, 'details')[0].textContent).toContain(LONG);
  });

  it('shows nothing when there is neither', () => {
    expect(bodyOf(itemOf('film', 1960))).toBeUndefined();
    expect(bodyOf(itemOf('film', 1960, { summary: '   ', description: '' }))).toBeUndefined();
  });

  it('ignores a summary that is not text, and then does what it does without one', () => {
    for (const summary of [4, null, ['a line'], { line: 'a line' }, true]) {
      const desc = bodyOf(itemOf('film', 1960, { summary, description: 'A short invented line.' }));
      expect(desc.tag, JSON.stringify(summary)).toBe('p');
      expect(desc.textContent).toBe('A short invented line.');
    }
  });

  it('sits where the description sat: first in the body of the card, ahead of the reason', () => {
    const el = entry(itemOf('film', 1960, { summary: 'A short invented line.' }), { reason: 'Because they liked it', showEra: false });
    const body = firstByClass(el, 'entry-body');
    expect(body.children.map((child) => child.classes[0])).toEqual(['entry-desc', 'entry-reason']);
  });

  it('is on the cards of the plan and the room too, which use the same card', () => {
    const el = entry(itemOf('music', 1958, { summary: 'A short invented line.' }), { headingLevel: 4, showKind: true, showEra: false, showBecause: false, showFit: false, reason: 'A reason.' });
    expect(firstByClass(el, 'entry-desc').textContent).toBe('A short invented line.');
    expect(byClass(el, 'era')).toHaveLength(0);
  });
});
