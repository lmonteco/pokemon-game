import { describe, expect, it } from 'vitest';
import { formatIssues, validateContent } from './validate.ts';
import type { ContentIssue, RawContentBundle, ValidationResult } from './validate.ts';

/**
 * Validation tests, written against invented content.
 *
 * Every id below ("alpha", "creature-one") is made up. That is deliberate: it
 * keeps real content names out of `src/` (GDD 11.3) and it keeps these tests
 * from breaking every time someone adds a species.
 *
 * The cross-reference cases are the ones that matter. Per-field checks catch
 * typos; cross-reference checks are what make "add 20 moves following the
 * schema" a safe task to hand to an agent.
 */

/**
 * Fixture shapes, deliberately looser than the inferred content types: a test
 * has to be able to put a string where a number belongs. These are not a second
 * definition of the content model -- that lives only in `schema/`, and the
 * engine's types are inferred from it.
 */
type TestChart = {
  types: { id: string; displayName: string }[];
  multipliers: Record<string, Record<string, number>>;
};

type TestSpecies = {
  id: string;
  displayName: string;
  types: string[];
  baseStats: {
    hp: number;
    attack: number;
    defense: number;
    spAttack: number;
    spDefense: number;
    speed: number;
  };
  learnset: { moveId: string; level: number }[];
  evolution?: { method: string; into: string; level?: number; itemId?: string };
  spriteKey: string;
  aiArchetype: string;
};

type TestMove = {
  id: string;
  displayName: string;
  type: string;
  category: string;
  power: number;
  shape: string;
  cooldown: number;
  cast: number;
  projectile?: { speed?: number; radius?: number; range?: number; pierce?: number };
  effect?: { status: string; chance: number };
};

type TestBundle = {
  typechart: TestChart;
  species: TestSpecies[];
  moves: TestMove[];
  affixes: Record<string, unknown>[];
  items: Record<string, unknown>[];
  biomes: Record<string, unknown>[];
  rooms: { file: string; data: Record<string, unknown> }[];
};

const TYPE_IDS = ['alpha', 'beta', 'gamma'] as const;

function makeChart(): TestChart {
  const multipliers: Record<string, Record<string, number>> = {};
  for (const attacker of TYPE_IDS) {
    multipliers[attacker] = {};
    for (const defender of TYPE_IDS) {
      multipliers[attacker]![defender] = attacker === defender ? 0.5 : 1;
    }
  }
  multipliers['alpha']!['beta'] = 2;
  multipliers['beta']!['gamma'] = 0;
  return {
    types: TYPE_IDS.map((id) => ({ id, displayName: id.toUpperCase() })),
    multipliers,
  };
}

/** A bundle that validates cleanly; each test breaks exactly one thing. */
function makeBundle(): TestBundle {
  return {
    typechart: makeChart(),
    species: [
      {
        id: 'creature-one',
        displayName: 'Creature One',
        types: ['alpha'],
        baseStats: { hp: 39, attack: 52, defense: 43, spAttack: 60, spDefense: 50, speed: 65 },
        learnset: [{ moveId: 'strike-one', level: 1 }],
        evolution: { method: 'level', into: 'creature-two', level: 16 },
        spriteKey: 'creature-one',
        aiArchetype: 'chaser',
      },
      {
        id: 'creature-two',
        displayName: 'Creature Two',
        types: ['alpha', 'beta'],
        baseStats: { hp: 58, attack: 64, defense: 58, spAttack: 80, spDefense: 65, speed: 80 },
        learnset: [{ moveId: 'strike-one', level: 1 }],
        spriteKey: 'creature-two',
        aiArchetype: 'ranged',
      },
    ],
    moves: [
      {
        id: 'strike-one',
        displayName: 'Strike One',
        type: 'alpha',
        category: 'special',
        power: 40,
        shape: 'projectile',
        cooldown: 1.2,
        cast: 6,
        projectile: { speed: 180, radius: 3, range: 160, pierce: 0 },
        effect: { status: 'burn', chance: 0.1 },
      },
    ],
    affixes: [
      {
        id: 'alpha-damage',
        displayName: 'Alpha Damage',
        effect: 'type-damage',
        scopeTypeId: 'alpha',
        tiers: [{ rarity: 'common', min: 3, max: 6 }],
        slotWhitelist: ['held-item'],
      },
    ],
    items: [
      {
        kind: 'consumable',
        id: 'small-berry',
        displayName: 'Small Berry',
        spriteKey: 'small-berry',
        effect: 'heal',
        magnitude: 20,
      },
    ],
    biomes: [
      {
        id: 'first-biome',
        displayName: 'First Biome',
        floors: { from: 1, to: 5 },
        favouredTypes: ['alpha'],
        spawnTable: [{ speciesId: 'creature-one', weight: 1 }],
        bossSpeciesId: 'creature-two',
        weather: 'none',
        hazards: ['water'],
      },
    ],
    rooms: [
      {
        file: 'data/rooms/first-room.json',
        data: {
          id: 'first-room',
          displayName: 'First Room',
          biomeId: 'first-biome',
          kind: 'entrance',
          width: 5,
          height: 3,
          tiles: ['#####', '#.p.#', '#####'],
        },
      },
    ],
  };
}

function validate(bundle: TestBundle): ValidationResult {
  return validateContent(bundle as unknown as RawContentBundle, { spriteExists: () => true });
}

function issuesOf(bundle: TestBundle): ContentIssue[] {
  const result = validate(bundle);
  if (result.ok) throw new Error('expected validation to fail, but it passed');
  return result.issues;
}

function expectIssue(bundle: TestBundle, path: string, messagePattern: RegExp): ContentIssue {
  const issues = issuesOf(bundle);
  const match = issues.find((issue) => issue.path === path && messagePattern.test(issue.message));
  if (match === undefined) {
    throw new Error(
      `no issue at "${path}" matching ${messagePattern}. Got:\n${formatIssues(issues)}`,
    );
  }
  return match;
}

describe('a well-formed bundle', () => {
  it('validates and hands back typed content', () => {
    const result = validate(makeBundle());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content.species).toHaveLength(2);
    expect(result.content.moves).toHaveLength(1);
    expect(result.content.rooms).toHaveLength(1);
    expect(result.content.typechart.types).toHaveLength(3);
  });
});

describe('cross-reference checks', () => {
  it('rejects a type name that is not in the chart', () => {
    const bundle = makeBundle();
    bundle.species[0]!.types = ['not-a-type'];
    const issue = expectIssue(bundle, 'species[0].types[0]', /unknown reference.*typechart\.json/);
    expect(issue.value).toBe('not-a-type');
    expect(issue.file).toBe('data/species.json');
  });

  it('rejects a move whose type is not in the chart', () => {
    const bundle = makeBundle();
    bundle.moves[0]!.type = 'not-a-type';
    expect(expectIssue(bundle, 'moves[0].type', /unknown reference/).value).toBe('not-a-type');
  });

  it('rejects a learnset entry naming a move that does not exist', () => {
    const bundle = makeBundle();
    bundle.species[0]!.learnset = [{ moveId: 'no-such-move', level: 5 }];
    const issue = expectIssue(
      bundle,
      'species[0].learnset[0].moveId',
      /unknown reference.*moves\.json/,
    );
    expect(issue.value).toBe('no-such-move');
  });

  it('rejects an evolution pointing at a species that does not exist', () => {
    const bundle = makeBundle();
    bundle.species[0]!.evolution = { method: 'level', into: 'no-such-species', level: 16 };
    const issue = expectIssue(
      bundle,
      'species[0].evolution.into',
      /unknown reference.*species\.json/,
    );
    expect(issue.value).toBe('no-such-species');
  });

  it('rejects an evolution stone that is not in the item list', () => {
    const bundle = makeBundle();
    bundle.species[0]!.evolution = {
      method: 'item',
      into: 'creature-two',
      itemId: 'no-such-stone',
    };
    expect(expectIssue(bundle, 'species[0].evolution.itemId', /unknown reference/).value).toBe(
      'no-such-stone',
    );
  });

  it('rejects an evolution cycle', () => {
    const bundle = makeBundle();
    bundle.species[1]!.evolution = { method: 'level', into: 'creature-one', level: 32 };
    expectIssue(bundle, 'species[0].evolution.into', /cycle: creature-one -> creature-two/);
  });

  it('rejects a species that evolves into itself', () => {
    const bundle = makeBundle();
    bundle.species[0]!.evolution = { method: 'level', into: 'creature-one', level: 16 };
    expectIssue(bundle, 'species[0].evolution.into', /cycle/);
  });

  it('rejects a sprite key with no file behind it', () => {
    const bundle = makeBundle();
    const result = validateContent(bundle as unknown as RawContentBundle, {
      spriteExists: (key) => key !== 'creature-two',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.issues.find((entry) => entry.path === 'species[1].spriteKey');
    expect(issue?.message).toMatch(/no sprite file/);
    expect(issue?.value).toBe('creature-two');
  });

  it('rejects a biome spawning a species that does not exist', () => {
    const bundle = makeBundle();
    bundle.biomes[0]!['spawnTable'] = [{ speciesId: 'no-such-species', weight: 1 }];
    expectIssue(bundle, 'biomes[0].spawnTable[0].speciesId', /unknown reference/);
  });

  it('rejects a biome boss that does not exist', () => {
    const bundle = makeBundle();
    bundle.biomes[0]!['bossSpeciesId'] = 'no-such-species';
    expectIssue(bundle, 'biomes[0].bossSpeciesId', /unknown reference/);
  });

  it('rejects a room template pointing at a biome that does not exist', () => {
    const bundle = makeBundle();
    bundle.rooms[0]!.data['biomeId'] = 'no-such-biome';
    const issue = expectIssue(bundle, 'room.biomeId', /unknown reference.*biomes\.json/);
    expect(issue.file).toBe('data/rooms/first-room.json');
  });

  it('rejects an affix scoped to a type that does not exist', () => {
    const bundle = makeBundle();
    bundle.affixes[0]!['scopeTypeId'] = 'not-a-type';
    expectIssue(bundle, 'affixes[0].scopeTypeId', /unknown reference/);
  });
});

describe('per-field checks', () => {
  it('rejects an out-of-range base stat', () => {
    const bundle = makeBundle();
    bundle.species[0]!.baseStats.hp = 999;
    const issue = expectIssue(bundle, 'species[0].baseStats.hp', /255/);
    expect(issue.value).toBe(999);
  });

  it('rejects a base stat of zero', () => {
    const bundle = makeBundle();
    bundle.species[0]!.baseStats.speed = 0;
    expect(expectIssue(bundle, 'species[0].baseStats.speed', />=\s*1/).value).toBe(0);
  });

  it('rejects a fractional base stat', () => {
    const bundle = makeBundle();
    bundle.species[0]!.baseStats.attack = 52.5;
    expectIssue(bundle, 'species[0].baseStats.attack', /int/);
  });

  it('rejects a level above the cap', () => {
    const bundle = makeBundle();
    bundle.species[0]!.learnset = [{ moveId: 'strike-one', level: 99 }];
    expectIssue(bundle, 'species[0].learnset[0].level', /50/);
  });

  it('rejects a misspelled field name instead of silently dropping it', () => {
    const bundle = makeBundle();
    delete (bundle.species[0] as Record<string, unknown>)['spriteKey'];
    (bundle.species[0] as Record<string, unknown>)['spritKey'] = 'creature-one';
    const issues = issuesOf(bundle);
    expect(issues.some((issue) => /Unrecognized key/.test(issue.message))).toBe(true);
  });

  it('rejects an id that is not kebab-case', () => {
    const bundle = makeBundle();
    bundle.species[0]!.id = 'Creature One';
    expectIssue(bundle, 'species[0].id', /kebab-case/);
  });

  it('rejects a duplicate id', () => {
    const bundle = makeBundle();
    bundle.species[1]!.id = 'creature-one';
    expectIssue(bundle, 'species[1].id', /duplicate id/);
  });

  it('rejects the same move listed twice in one learnset', () => {
    const bundle = makeBundle();
    bundle.species[0]!.learnset = [
      { moveId: 'strike-one', level: 1 },
      { moveId: 'strike-one', level: 7 },
    ];
    expectIssue(bundle, 'species[0].learnset[1].moveId', /learned twice/);
  });

  it('rejects the same type listed twice on one species', () => {
    const bundle = makeBundle();
    bundle.species[1]!.types = ['alpha', 'alpha'];
    expectIssue(bundle, 'species[1].types[1]', /duplicate type/);
  });

  it('rejects a third type on one species', () => {
    const bundle = makeBundle();
    bundle.species[1]!.types = ['alpha', 'beta', 'gamma'];
    expectIssue(bundle, 'species[1].types', /2/);
  });

  it('rejects an unknown ai archetype', () => {
    const bundle = makeBundle();
    bundle.species[0]!.aiArchetype = 'wanderer';
    expectIssue(bundle, 'species[0].aiArchetype', /wanderer|option/i);
  });

  it('rejects an unknown move shape', () => {
    const bundle = makeBundle();
    bundle.moves[0]!.shape = 'boomerang';
    expectIssue(bundle, 'moves[0].shape', /boomerang|option/i);
  });

  it('rejects a status move that deals damage', () => {
    const bundle = makeBundle();
    bundle.moves[0]!.category = 'status';
    expectIssue(bundle, 'moves[0].power', /status moves deal no damage/);
  });

  it('rejects a damaging move with no power', () => {
    const bundle = makeBundle();
    bundle.moves[0]!.power = 0;
    expectIssue(bundle, 'moves[0].power', /needs power above 0/);
  });

  it('rejects a zero cooldown, which would fire every frame', () => {
    const bundle = makeBundle();
    bundle.moves[0]!.cooldown = 0;
    expectIssue(bundle, 'moves[0].cooldown', />\s*0/);
  });

  it('rejects an effect chance above 1', () => {
    const bundle = makeBundle();
    bundle.moves[0]!.effect = { status: 'burn', chance: 10 };
    expectIssue(bundle, 'moves[0].effect.chance', /1/);
  });

  it('rejects an affix tier whose range runs backwards', () => {
    const bundle = makeBundle();
    bundle.affixes[0]!['tiers'] = [{ rarity: 'common', min: 9, max: 2 }];
    expectIssue(bundle, 'affixes[0].tiers[0].min', /min must not exceed max/);
  });

  it('rejects a type-scoped affix with no type', () => {
    const bundle = makeBundle();
    delete bundle.affixes[0]!['scopeTypeId'];
    expectIssue(bundle, 'affixes[0].scopeTypeId', /requires scopeTypeId/);
  });

  it('rejects a biome whose floor range runs backwards', () => {
    const bundle = makeBundle();
    bundle.biomes[0]!['floors'] = { from: 9, to: 2 };
    expectIssue(bundle, 'biomes[0].floors.from', /runs backwards/);
  });
});

describe('room templates', () => {
  it('rejects a row that does not match the declared width', () => {
    const bundle = makeBundle();
    bundle.rooms[0]!.data['tiles'] = ['#####', '#.p.##', '#####'];
    expectIssue(bundle, 'room.tiles[1]', /expected 5 glyphs.*found 6/);
  });

  it('rejects a grid that does not match the declared height', () => {
    const bundle = makeBundle();
    bundle.rooms[0]!.data['height'] = 4;
    expectIssue(bundle, 'room.tiles', /expected 4 rows.*found 3/);
  });

  it('rejects a room smaller than the minimum', () => {
    const bundle = makeBundle();
    bundle.rooms[0]!.data['tiles'] = ['#####', '#.p.#'];
    expectIssue(bundle, 'room.tiles', />=\s*3 items/);
  });

  it('rejects an unknown tile glyph and says where it is', () => {
    const bundle = makeBundle();
    bundle.rooms[0]!.data['tiles'] = ['#####', '#.X.#', '#####'];
    expect(expectIssue(bundle, 'room.tiles[1][2]', /unknown tile glyph/).value).toBe('X');
  });
});

describe('the type chart itself', () => {
  it('rejects a missing cell', () => {
    const bundle = makeBundle();
    delete bundle.typechart.multipliers['alpha']!['gamma'];
    expectIssue(bundle, 'typechart.multipliers.alpha.gamma', /missing cell/);
  });

  it('rejects a missing attacker row', () => {
    const bundle = makeBundle();
    delete bundle.typechart.multipliers['beta'];
    expectIssue(bundle, 'typechart.multipliers.beta', /missing attacker row/);
  });

  it('rejects a row for a type that was never declared', () => {
    const bundle = makeBundle();
    bundle.typechart.multipliers['delta'] = { alpha: 1, beta: 1, gamma: 1 };
    expectIssue(bundle, 'typechart.multipliers.delta', /not a declared type/);
  });

  it('rejects a column for a type that was never declared', () => {
    const bundle = makeBundle();
    bundle.typechart.multipliers['alpha']!['delta'] = 2;
    expectIssue(bundle, 'typechart.multipliers.alpha.delta', /not a declared type/);
  });

  it('rejects a multiplier that is not one of the four legal cell values', () => {
    const bundle = makeBundle();
    bundle.typechart.multipliers['alpha']!['gamma'] = 4;
    expectIssue(bundle, 'typechart.multipliers.alpha.gamma', /0, 0\.5, 1, 2/);
  });

  it('reports a broken chart on its own, without a cascade from other files', () => {
    const bundle = makeBundle();
    delete bundle.typechart.multipliers['alpha']!['gamma'];
    bundle.species[0]!.types = ['not-a-type'];
    const issues = issuesOf(bundle);
    expect(issues.every((issue) => issue.file === 'data/typechart.json')).toBe(true);
  });
});

describe('error reporting', () => {
  it('names the file, the path and the rejected value', () => {
    const bundle = makeBundle();
    bundle.species[0]!.baseStats.hp = 999;
    const report = formatIssues(issuesOf(bundle));
    expect(report).toContain('data/species.json');
    expect(report).toContain('species[0].baseStats.hp');
    expect(report).toContain('999');
  });

  it('collects problems from several files in one run', () => {
    const bundle = makeBundle();
    bundle.species[0]!.types = ['not-a-type'];
    bundle.moves[0]!.power = 0;
    bundle.biomes[0]!['bossSpeciesId'] = 'no-such-species';
    const files = new Set(issuesOf(bundle).map((issue) => issue.file));
    expect(files).toEqual(new Set(['data/species.json', 'data/moves.json', 'data/biomes.json']));
  });

  it('still cross-references the files that parsed when one file is broken', () => {
    const bundle = makeBundle();
    // moves.json is the wrong shape entirely.
    const broken = { ...bundle, moves: { nope: true } } as unknown as RawContentBundle;
    const result = validateContent(broken, { spriteExists: () => true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((issue) => issue.file === 'data/moves.json')).toBe(true);
    // The biome still gets checked even though moves could not be parsed.
    expect(result.issues.some((issue) => issue.file === 'data/species.json')).toBe(false);
  });
});
