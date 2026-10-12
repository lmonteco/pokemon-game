import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createContentDatabase } from './database.ts';
import { validateContentOnDisk } from './node-loader.ts';

/**
 * The type chart is the heart of the game and a wrong cell is a balance bug
 * nobody finds for months (GDD 4.3). These tests check the shipped chart
 * against a table of matchups that are known-correct independently of it.
 *
 * The expectations live in `test/fixtures/` rather than here because they name
 * types, and `src/` must never name a type (GDD 11.3).
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

type EffectivenessCase = {
  attack: string;
  defenders: string[];
  expected: number;
  note: string;
};

const fixture = JSON.parse(
  readFileSync(resolve(repoRoot, 'test/fixtures/effectiveness-cases.json'), 'utf8'),
) as { cases: EffectivenessCase[] };

const result = validateContentOnDisk(repoRoot);
if (!result.ok) throw new Error('data/ must be valid before these tests can run');
const content = createContentDatabase(result.content);

describe('effectiveness', () => {
  it('has a spot-check table covering the interesting multipliers', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(25);
    const covered = new Set(fixture.cases.map((entry) => entry.expected));
    // 4x and 0.25x only exist as products, and 0 has to survive multiplication.
    expect([...covered].sort((a, b) => a - b)).toEqual([0, 0.25, 0.5, 1, 2, 4]);
  });

  it.each(fixture.cases)(
    '$attack vs $defenders is $expected ($note)',
    ({ attack, defenders, expected }) => {
      expect(content.effectiveness(attack, defenders)).toBe(expected);
    },
  );

  it('is 1 against a defender with no types at all', () => {
    const [first] = content.types;
    expect(first).toBeDefined();
    expect(content.effectiveness(first!.id, [])).toBe(1);
  });

  it('multiplies the two cells rather than taking the stronger one', () => {
    // Guards the single most likely implementation slip: using max() or the
    // first matching cell, which would quietly delete every 4x in the game.
    for (const { attack, defenders, expected } of fixture.cases) {
      if (defenders.length !== 2) continue;
      const [firstDefender, secondDefender] = defenders;
      const product =
        content.effectiveness(attack, [firstDefender!]) *
        content.effectiveness(attack, [secondDefender!]);
      expect(product).toBe(expected);
    }
  });

  it('does not care what order the defending types are written in', () => {
    for (const { attack, defenders, expected } of fixture.cases) {
      if (defenders.length !== 2) continue;
      expect(content.effectiveness(attack, [...defenders].reverse())).toBe(expected);
    }
  });

  it('throws on a type id that is not in the chart, rather than returning 1', () => {
    const [first] = content.types;
    expect(() => content.effectiveness('not-a-type', [first!.id])).toThrow(/not-a-type/);
    expect(() => content.effectiveness(first!.id, ['not-a-type'])).toThrow(/not-a-type/);
  });
});

describe('the shipped type chart', () => {
  it('is square and complete over every declared type', () => {
    const ids = content.types.map((type) => type.id);
    expect(ids.length).toBe(18);
    expect(new Set(ids).size).toBe(ids.length);

    let cells = 0;
    for (const attacker of ids) {
      for (const defender of ids) {
        const value = content.effectiveness(attacker, [defender]);
        expect([0, 0.5, 1, 2]).toContain(value);
        cells += 1;
      }
    }
    expect(cells).toBe(18 * 18);
  });

  it('gives every type a display name for the UI to read', () => {
    for (const type of content.types) {
      expect(type.displayName.length).toBeGreaterThan(0);
    }
    expect(new Set(content.types.map((type) => type.displayName)).size).toBe(18);
  });
});

describe('stab', () => {
  it('applies only when the move type is one of the attacker types', () => {
    const [first, second] = content.types;
    expect(content.stab(first!.id, [first!.id])).toBe(1.5);
    expect(content.stab(first!.id, [second!.id, first!.id])).toBe(1.5);
    expect(content.stab(first!.id, [second!.id])).toBe(1);
    expect(content.stab(first!.id, [])).toBe(1);
  });
});
