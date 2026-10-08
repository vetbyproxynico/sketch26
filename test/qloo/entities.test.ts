import { describe, expect, it } from 'vitest';
import { countEntities, entitiesOf, hasEmptyEntities } from '../../src/qloo/entities';
import insights from '../fixtures/insights.json';
import insightsEmpty from '../fixtures/insights-empty.json';
import search from '../fixtures/search.json';

describe('entity helpers', () => {
  it('finds results.entities in an insights-shaped body', () => {
    expect(countEntities(insights)).toBe(3);
    expect(hasEmptyEntities(insights)).toBe(false);
  });

  it('finds a results array in a search-shaped body', () => {
    expect(countEntities(search)).toBe(2);
  });

  it('flags a 200 body with an empty entity list', () => {
    expect(hasEmptyEntities(insightsEmpty)).toBe(true);
    expect(hasEmptyEntities({ results: [] })).toBe(true);
    expect(countEntities(insightsEmpty)).toBe(0);
  });

  it('does not flag a body without any entity list', () => {
    expect(entitiesOf({ success: true })).toBeUndefined();
    expect(hasEmptyEntities({ success: true })).toBe(false);
    expect(countEntities({ success: true })).toBe(0);
  });

  it('tolerates non-object bodies', () => {
    for (const body of [null, undefined, 'text', 42, []]) {
      expect(hasEmptyEntities(body)).toBe(false);
      expect(countEntities(body)).toBe(0);
    }
  });
});
