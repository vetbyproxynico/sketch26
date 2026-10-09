// One suggestion as a catalogue entry: a dated stamp on the left, the name,
// why it is here, and the favourites that led to it.

import { h, srOnly } from '../dom.js';
import { DOMAIN_SHORT, eraInfo, percent, shortDescription, yearMeaning } from '../format.js';
import { bar } from './meter.js';

/** Text compared without regard to spacing, so a summary that repeats the description is not shown twice. */
const squash = (value) => String(value || '').replace(/\s+/g, ' ').trim();

/**
 * What a card says about the thing. When the taste service gave a short summary,
 * the card shows that, and the long description (if there is one that says
 * something else) opens behind "More about it". Without a summary a description
 * as it comes from the taste service can run to several sentences: the card
 * shows its opening and the rest opens in place.
 */
function describe(item, name) {
  const summary = typeof item.summary === 'string' ? squash(item.summary) : '';
  const description = typeof item.description === 'string' ? item.description : '';
  if (summary !== '') {
    if (squash(description) === '' || squash(description) === summary) return h('p', { class: 'entry-desc' }, summary);
    return h(
      'div',
      { class: 'entry-desc' },
      h('p', { class: 'entry-desc-short' }, summary),
      h('details', { class: 'entry-more' }, h('summary', null, 'More about it', srOnly(`: ${name}`)), h('p', null, description)),
    );
  }
  if (!description) return null;
  const short = shortDescription(description);
  if (short === null) return h('p', { class: 'entry-desc' }, description);
  return h(
    'div',
    { class: 'entry-desc' },
    h('p', { class: 'entry-desc-short' }, short),
    h('details', { class: 'entry-more' }, h('summary', null, 'More about it', srOnly(`: ${name}`)), h('p', null, description)),
  );
}

export function stamp(entity, domain, showKind) {
  const known = Boolean(entity.year);
  // The year means something different for each kind. For a person it is when they were born, for a singer or band
  // when they began performing ("from"), for a brand when it was founded; the stamp says so.
  const meaning = yearMeaning(domain);
  const born = domain === 'person' && known;
  let kindText = null;
  if (showKind) kindText = born ? 'Person, born' : DOMAIN_SHORT[domain] || 'Other';
  else if (born) kindText = 'born';
  return h(
    'p',
    { class: `stamp stamp--${domain}${known ? '' : ' stamp--undated'}` },
    known ? srOnly(meaning.hidden) : null,
    // The word before the year is for the eye only: the hidden text above already says it to a screen reader.
    known && meaning.lead ? h('span', { class: 'stamp-lead', 'aria-hidden': 'true' }, meaning.lead) : null,
    known ? h('span', { class: 'stamp-year' }, String(entity.year)) : h('span', { class: 'stamp-none' }, 'Year not known'),
    kindText ? h('span', { class: 'stamp-kind' }, kindText) : null,
  );
}

/**
 * options: headingLevel, showKind, showEra, window (the years the map reports), showBecause, nickname, reason, footer (element)
 */
export function entry(item, options) {
  const o = options || {};
  const entity = item.entity;
  const domain = item.domain || entity.domain || 'film';
  const level = o.headingLevel || 3;
  const era = o.showEra === false ? null : eraInfo(item, o.window);

  const contributions = Array.isArray(item.contributions)
    ? item.contributions
        .slice()
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
    : [];

  const because =
    o.showBecause !== false && contributions.length > 0
      ? h(
          'div',
          { class: 'because' },
          h('p', { class: 'because-title' }, `Because ${o.nickname || 'they'} liked`),
          h(
            'ul',
            { class: 'because-list' },
            contributions.map((c) =>
              h(
                'li',
                { class: 'because-row' },
                h('span', { class: 'because-name' }, c.name),
                bar(c.score),
                h('span', { class: 'because-pct' }, `${percent(c.score)}%`, srOnly(' link strength')),
              ),
            ),
          ),
        )
      : null;

  return h(
    'article',
    { class: `entry entry--${domain}` },
    stamp(entity, domain, o.showKind),
    h(`h${level}`, { class: 'entry-name' }, entity.name),
    h(
      'div',
      { class: 'entry-body' },
      describe(item, entity.name),
      o.reason ? h('p', { class: 'entry-reason' }, o.reason) : null,
      era ? h('p', { class: `era era--${era.tone}` }, h('strong', { class: 'era-label' }, era.label), h('span', { class: 'era-text' }, era.text)) : null,
      typeof item.affinity === 'number' && o.showFit !== false ? h('p', { class: 'entry-fit' }, `How well it fits: ${percent(item.affinity)}%`) : null,
      because,
    ),
    o.footer ? h('div', { class: 'entry-foot' }, o.footer) : null,
  );
}
