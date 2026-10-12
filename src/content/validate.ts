import type { z } from 'zod';
import {
  affixesFileSchema,
  biomesFileSchema,
  itemsFileSchema,
  movesFileSchema,
  roomTemplateSchema,
  speciesFileSchema,
  typeChartSchema,
  ROOM_GLYPHS,
  STAT_SCOPED_AFFIX_EFFECTS,
  STATUS_SCOPED_AFFIX_EFFECTS,
  TYPE_SCOPED_AFFIX_EFFECTS,
} from './schema/index.ts';
import type { Affix, Biome, Item, Move, RoomTemplate, Species, TypeChart } from './schema/index.ts';

/**
 * Build-time validation of everything under `data/` (GDD 9.2).
 *
 * Two passes, and the second one is the point of this module:
 *
 *  1. Per-field parsing against the Zod schemas. Catches typos and bad ranges.
 *  2. Cross-reference checks. Catches the errors content authors actually make:
 *     a learnset naming a move that does not exist, an evolution pointing at a
 *     missing species, a type name that is not in the chart. This is what makes
 *     "add 20 Water moves following the schema" a safe task to delegate.
 *
 * Nothing here knows the name of a single species, move or type.
 */

export const DATA_FILES = {
  typechart: 'data/typechart.json',
  species: 'data/species.json',
  moves: 'data/moves.json',
  affixes: 'data/affixes.json',
  items: 'data/items.json',
  biomes: 'data/biomes.json',
  roomsDir: 'data/rooms',
} as const;

/** One problem, located precisely enough to fix without searching. */
export type ContentIssue = {
  /** Repository-relative file the problem is in. */
  file: string;
  /** Dotted path to the offending field, e.g. `species[0].learnset[1].moveId`. */
  path: string;
  message: string;
  /** The value that was rejected, when there is one. */
  value?: unknown;
};

export type RawRoomFile = {
  /** Repository-relative path, used in error messages. */
  file: string;
  data: unknown;
};

/** Raw parsed JSON, as read from disk or imported by the bundler. */
export type RawContentBundle = {
  typechart: unknown;
  species: unknown;
  moves: unknown;
  affixes: unknown;
  items: unknown;
  biomes: unknown;
  rooms: readonly RawRoomFile[];
};

export type ValidatedContent = {
  typechart: TypeChart;
  species: readonly Species[];
  moves: readonly Move[];
  affixes: readonly Affix[];
  items: readonly Item[];
  biomes: readonly Biome[];
  rooms: readonly RoomTemplate[];
};

export type ValidateOptions = {
  /**
   * Reports whether a sprite key resolves to a real asset file. Omitted when no
   * filesystem is available (in the browser the bundler has already resolved
   * the assets), in which case sprite keys are not checked.
   */
  spriteExists?: (spriteKey: string) => boolean;
};

export type ValidationResult =
  { ok: true; content: ValidatedContent } | { ok: false; issues: ContentIssue[] };

// --- issue plumbing ---------------------------------------------------------

function formatPath(root: string, segments: readonly PropertyKey[]): string {
  let out = root;
  for (const segment of segments) {
    out += typeof segment === 'number' ? `[${segment}]` : `.${String(segment)}`;
  }
  return out;
}

function valueAtPath(raw: unknown, segments: readonly PropertyKey[]): unknown {
  let cursor: unknown = raw;
  for (const segment of segments) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<PropertyKey, unknown>)[segment];
  }
  return cursor;
}

function issuesFromZod(
  file: string,
  root: string,
  error: z.ZodError,
  raw: unknown,
): ContentIssue[] {
  return error.issues.map((issue) => {
    const value = valueAtPath(raw, issue.path);
    return value === undefined
      ? { file, path: formatPath(root, issue.path), message: issue.message }
      : { file, path: formatPath(root, issue.path), message: issue.message, value };
  });
}

/** Renders issues as a report a human can act on without opening a debugger. */
export function formatIssues(issues: readonly ContentIssue[]): string {
  const byFile = new Map<string, ContentIssue[]>();
  for (const issue of issues) {
    const bucket = byFile.get(issue.file);
    if (bucket === undefined) byFile.set(issue.file, [issue]);
    else bucket.push(issue);
  }

  const lines: string[] = [];
  for (const [file, fileIssues] of byFile) {
    lines.push(file);
    for (const issue of fileIssues) {
      let line = `  ${issue.path}: ${issue.message}`;
      if ('value' in issue) line += ` (got ${previewValue(issue.value)})`;
      lines.push(line);
    }
  }
  return lines.join('\n');
}

function previewValue(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

// --- generic checks ---------------------------------------------------------

function checkUniqueIds(
  file: string,
  root: string,
  rows: readonly { id: string }[],
): ContentIssue[] {
  const firstSeenAt = new Map<string, number>();
  const issues: ContentIssue[] = [];
  rows.forEach((row, index) => {
    const previous = firstSeenAt.get(row.id);
    if (previous === undefined) {
      firstSeenAt.set(row.id, index);
      return;
    }
    issues.push({
      file,
      path: formatPath(root, [index, 'id']),
      message: `duplicate id, already used by ${root}[${previous}]`,
      value: row.id,
    });
  });
  return issues;
}

function checkReference(
  file: string,
  root: string,
  segments: readonly PropertyKey[],
  value: string,
  known: ReadonlySet<string>,
  referencedFile: string,
): ContentIssue | undefined {
  if (known.has(value)) return undefined;
  return {
    file,
    path: formatPath(root, segments),
    message: `unknown reference: no such entry in ${referencedFile}`,
    value,
  };
}

// --- the type chart ---------------------------------------------------------

/** Squareness, completeness and uniqueness. A missing cell is a balance bug. */
function checkTypeChart(chart: TypeChart): ContentIssue[] {
  const file = DATA_FILES.typechart;
  const issues: ContentIssue[] = [];

  issues.push(...checkUniqueIds(file, 'typechart.types', chart.types));

  const seenNames = new Map<string, number>();
  chart.types.forEach((type, index) => {
    const previous = seenNames.get(type.displayName);
    if (previous === undefined) {
      seenNames.set(type.displayName, index);
      return;
    }
    issues.push({
      file,
      path: formatPath('typechart.types', [index, 'displayName']),
      message: `duplicate displayName, already used by typechart.types[${previous}]`,
      value: type.displayName,
    });
  });

  const typeIds = chart.types.map((type) => type.id);
  const typeIdSet = new Set(typeIds);

  for (const extraRow of Object.keys(chart.multipliers)) {
    if (!typeIdSet.has(extraRow)) {
      issues.push({
        file,
        path: formatPath('typechart.multipliers', [extraRow]),
        message: 'row is not a declared type; remove it or add it to typechart.types',
        value: extraRow,
      });
    }
  }

  for (const attacker of typeIds) {
    const row = chart.multipliers[attacker];
    if (row === undefined) {
      issues.push({
        file,
        path: formatPath('typechart.multipliers', [attacker]),
        message: 'missing attacker row; the chart must be square over typechart.types',
      });
      continue;
    }
    for (const extraColumn of Object.keys(row)) {
      if (!typeIdSet.has(extraColumn)) {
        issues.push({
          file,
          path: formatPath('typechart.multipliers', [attacker, extraColumn]),
          message: 'column is not a declared type; remove it or add it to typechart.types',
          value: extraColumn,
        });
      }
    }
    for (const defender of typeIds) {
      if (row[defender] === undefined) {
        issues.push({
          file,
          path: formatPath('typechart.multipliers', [attacker, defender]),
          message: 'missing cell; every type needs a multiplier against every type',
        });
      }
    }
  }

  return issues;
}

// --- per-file cross-references ---------------------------------------------

function checkSpecies(
  species: readonly Species[],
  typeIds: ReadonlySet<string>,
  moves: readonly Move[] | undefined,
  items: readonly Item[] | undefined,
  options: ValidateOptions,
): ContentIssue[] {
  const file = DATA_FILES.species;
  const root = 'species';
  const issues: ContentIssue[] = [];
  const speciesIds = new Set(species.map((entry) => entry.id));
  const moveIds = moves === undefined ? undefined : new Set(moves.map((move) => move.id));
  const itemIds = items === undefined ? undefined : new Set(items.map((item) => item.id));

  issues.push(...checkUniqueIds(file, root, species));

  species.forEach((entry, index) => {
    entry.types.forEach((typeId, typeIndex) => {
      const issue = checkReference(
        file,
        root,
        [index, 'types', typeIndex],
        typeId,
        typeIds,
        DATA_FILES.typechart,
      );
      if (issue !== undefined) issues.push(issue);
      if (entry.types.indexOf(typeId) !== typeIndex) {
        issues.push({
          file,
          path: formatPath(root, [index, 'types', typeIndex]),
          message: 'duplicate type on one species',
          value: typeId,
        });
      }
    });

    const seenMoves = new Map<string, number>();
    entry.learnset.forEach((learned, learnIndex) => {
      if (moveIds !== undefined) {
        const issue = checkReference(
          file,
          root,
          [index, 'learnset', learnIndex, 'moveId'],
          learned.moveId,
          moveIds,
          DATA_FILES.moves,
        );
        if (issue !== undefined) issues.push(issue);
      }
      const previous = seenMoves.get(learned.moveId);
      if (previous === undefined) {
        seenMoves.set(learned.moveId, learnIndex);
        return;
      }
      issues.push({
        file,
        path: formatPath(root, [index, 'learnset', learnIndex, 'moveId']),
        message: `move learned twice, already at ${root}[${index}].learnset[${previous}]`,
        value: learned.moveId,
      });
    });

    const evolution = entry.evolution;
    if (evolution !== undefined) {
      const issue = checkReference(
        file,
        root,
        [index, 'evolution', 'into'],
        evolution.into,
        speciesIds,
        DATA_FILES.species,
      );
      if (issue !== undefined) issues.push(issue);
      if (evolution.method === 'item' && itemIds !== undefined) {
        const itemIssue = checkReference(
          file,
          root,
          [index, 'evolution', 'itemId'],
          evolution.itemId,
          itemIds,
          DATA_FILES.items,
        );
        if (itemIssue !== undefined) issues.push(itemIssue);
      }
    }

    if (options.spriteExists !== undefined && !options.spriteExists(entry.spriteKey)) {
      issues.push({
        file,
        path: formatPath(root, [index, 'spriteKey']),
        message: 'no sprite file for this key under assets/',
        value: entry.spriteKey,
      });
    }
  });

  issues.push(...checkEvolutionCycles(species));
  return issues;
}

/** An evolution cycle would loop the shrine animation forever (GDD 6.2). */
function checkEvolutionCycles(species: readonly Species[]): ContentIssue[] {
  const nextOf = new Map<string, string>();
  for (const entry of species) {
    if (entry.evolution !== undefined) nextOf.set(entry.id, entry.evolution.into);
  }

  const issues: ContentIssue[] = [];
  species.forEach((entry, index) => {
    const evolution = entry.evolution;
    if (evolution === undefined) return;
    const chain = [entry.id];
    const seen = new Set<string>([entry.id]);
    let cursor: string | undefined = nextOf.get(entry.id);
    while (cursor !== undefined) {
      chain.push(cursor);
      if (seen.has(cursor)) {
        issues.push({
          file: DATA_FILES.species,
          path: formatPath('species', [index, 'evolution', 'into']),
          message: `evolution chain forms a cycle: ${chain.join(' -> ')}`,
          value: evolution.into,
        });
        return;
      }
      seen.add(cursor);
      cursor = nextOf.get(cursor);
    }
  });
  return issues;
}

function checkMoves(moves: readonly Move[], typeIds: ReadonlySet<string>): ContentIssue[] {
  const file = DATA_FILES.moves;
  const root = 'moves';
  const issues: ContentIssue[] = [];

  issues.push(...checkUniqueIds(file, root, moves));

  moves.forEach((move, index) => {
    const issue = checkReference(
      file,
      root,
      [index, 'type'],
      move.type,
      typeIds,
      DATA_FILES.typechart,
    );
    if (issue !== undefined) issues.push(issue);

    // Category and power have to agree, or the damage formula treats a zero
    // power physical move as a free hit (GDD 4.2, 4.3).
    if (move.category === 'status' && move.power !== 0) {
      issues.push({
        file,
        path: formatPath(root, [index, 'power']),
        message: 'status moves deal no damage, so power must be 0',
        value: move.power,
      });
    }
    if (move.category !== 'status' && move.power === 0) {
      issues.push({
        file,
        path: formatPath(root, [index, 'power']),
        message: `a ${move.category} move needs power above 0; use category "status" for a move that deals no damage`,
        value: move.power,
      });
    }
  });

  return issues;
}

function checkAffixes(affixes: readonly Affix[], typeIds: ReadonlySet<string>): ContentIssue[] {
  const file = DATA_FILES.affixes;
  const root = 'affixes';
  const issues: ContentIssue[] = [];

  const scopeRequirements: readonly (readonly [
    readonly string[],
    'scopeTypeId' | 'scopeStat' | 'scopeStatus',
  ])[] = [
    [TYPE_SCOPED_AFFIX_EFFECTS, 'scopeTypeId'],
    [STAT_SCOPED_AFFIX_EFFECTS, 'scopeStat'],
    [STATUS_SCOPED_AFFIX_EFFECTS, 'scopeStatus'],
  ];

  issues.push(...checkUniqueIds(file, root, affixes));

  affixes.forEach((affix, index) => {
    if (affix.scopeTypeId !== undefined) {
      const issue = checkReference(
        file,
        root,
        [index, 'scopeTypeId'],
        affix.scopeTypeId,
        typeIds,
        DATA_FILES.typechart,
      );
      if (issue !== undefined) issues.push(issue);
    }

    for (const [effects, field] of scopeRequirements) {
      if (effects.includes(affix.effect) && affix[field] === undefined) {
        issues.push({
          file,
          path: formatPath(root, [index, field]),
          message: `effect "${affix.effect}" requires ${field}`,
        });
      }
    }

    const seenRarities = new Map<string, number>();
    affix.tiers.forEach((tier, tierIndex) => {
      const previous = seenRarities.get(tier.rarity);
      if (previous === undefined) {
        seenRarities.set(tier.rarity, tierIndex);
        return;
      }
      issues.push({
        file,
        path: formatPath(root, [index, 'tiers', tierIndex, 'rarity']),
        message: `rarity listed twice, already at ${root}[${index}].tiers[${previous}]`,
        value: tier.rarity,
      });
    });
  });

  return issues;
}

function checkItems(items: readonly Item[], options: ValidateOptions): ContentIssue[] {
  const file = DATA_FILES.items;
  const root = 'items';
  const issues: ContentIssue[] = [];

  issues.push(...checkUniqueIds(file, root, items));

  items.forEach((item, index) => {
    if (options.spriteExists !== undefined && !options.spriteExists(item.spriteKey)) {
      issues.push({
        file,
        path: formatPath(root, [index, 'spriteKey']),
        message: 'no sprite file for this key under assets/',
        value: item.spriteKey,
      });
    }
  });

  return issues;
}

function checkBiomes(
  biomes: readonly Biome[],
  typeIds: ReadonlySet<string>,
  species: readonly Species[] | undefined,
): ContentIssue[] {
  const file = DATA_FILES.biomes;
  const root = 'biomes';
  const issues: ContentIssue[] = [];
  const speciesIds = species === undefined ? undefined : new Set(species.map((entry) => entry.id));

  issues.push(...checkUniqueIds(file, root, biomes));

  biomes.forEach((biome, index) => {
    if (biome.floors.from > biome.floors.to) {
      issues.push({
        file,
        path: formatPath(root, [index, 'floors', 'from']),
        message: `floor range runs backwards; from must not exceed to (${biome.floors.to})`,
        value: biome.floors.from,
      });
    }

    biome.favouredTypes.forEach((typeId, typeIndex) => {
      const issue = checkReference(
        file,
        root,
        [index, 'favouredTypes', typeIndex],
        typeId,
        typeIds,
        DATA_FILES.typechart,
      );
      if (issue !== undefined) issues.push(issue);
    });

    const seenSpecies = new Map<string, number>();
    biome.spawnTable.forEach((entry, entryIndex) => {
      if (speciesIds !== undefined) {
        const issue = checkReference(
          file,
          root,
          [index, 'spawnTable', entryIndex, 'speciesId'],
          entry.speciesId,
          speciesIds,
          DATA_FILES.species,
        );
        if (issue !== undefined) issues.push(issue);
      }
      const previous = seenSpecies.get(entry.speciesId);
      if (previous === undefined) {
        seenSpecies.set(entry.speciesId, entryIndex);
        return;
      }
      issues.push({
        file,
        path: formatPath(root, [index, 'spawnTable', entryIndex, 'speciesId']),
        message: `species listed twice; merge the weights (already at ${root}[${index}].spawnTable[${previous}])`,
        value: entry.speciesId,
      });
    });

    if (speciesIds !== undefined && biome.bossSpeciesId !== undefined) {
      const issue = checkReference(
        file,
        root,
        [index, 'bossSpeciesId'],
        biome.bossSpeciesId,
        speciesIds,
        DATA_FILES.species,
      );
      if (issue !== undefined) issues.push(issue);
    }
  });

  return issues;
}

function checkRooms(
  rooms: readonly { file: string; template: RoomTemplate }[],
  biomes: readonly Biome[] | undefined,
): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const biomeIds = biomes === undefined ? undefined : new Set(biomes.map((biome) => biome.id));
  const glyphs = new Set(ROOM_GLYPHS);

  const seenIds = new Map<string, string>();
  for (const { file, template } of rooms) {
    const previous = seenIds.get(template.id);
    if (previous === undefined) {
      seenIds.set(template.id, file);
    } else {
      issues.push({
        file,
        path: 'room.id',
        message: `duplicate room template id, already used by ${previous}`,
        value: template.id,
      });
    }

    if (biomeIds !== undefined) {
      const issue = checkReference(
        file,
        'room',
        ['biomeId'],
        template.biomeId,
        biomeIds,
        DATA_FILES.biomes,
      );
      if (issue !== undefined) issues.push(issue);
    }

    if (template.tiles.length !== template.height) {
      issues.push({
        file,
        path: 'room.tiles',
        message: `expected ${template.height} rows to match height, found ${template.tiles.length}`,
      });
    }

    template.tiles.forEach((row, rowIndex) => {
      if (row.length !== template.width) {
        issues.push({
          file,
          path: formatPath('room.tiles', [rowIndex]),
          message: `expected ${template.width} glyphs to match width, found ${row.length}`,
          value: row,
        });
      }
      for (let column = 0; column < row.length; column += 1) {
        const glyph = row[column];
        if (glyph !== undefined && !glyphs.has(glyph)) {
          issues.push({
            file,
            path: `room.tiles[${rowIndex}][${column}]`,
            message: `unknown tile glyph; allowed glyphs are ${ROOM_GLYPHS.join(' ')}`,
            value: glyph,
          });
        }
      }
    });
  }

  return issues;
}

// --- entry point ------------------------------------------------------------

export function validateContent(
  bundle: RawContentBundle,
  options: ValidateOptions = {},
): ValidationResult {
  // The chart defines the universe of type ids, so it is validated alone first.
  // Reporting a broken chart on its own beats burying it under a hundred
  // "unknown type" errors raised by every other file.
  const chartParsed = typeChartSchema.safeParse(bundle.typechart);
  if (!chartParsed.success) {
    return {
      ok: false,
      issues: issuesFromZod(DATA_FILES.typechart, 'typechart', chartParsed.error, bundle.typechart),
    };
  }
  const chartIssues = checkTypeChart(chartParsed.data);
  if (chartIssues.length > 0) return { ok: false, issues: chartIssues };

  const typechart = chartParsed.data;
  const typeIds = new Set(typechart.types.map((type) => type.id));

  const issues: ContentIssue[] = [];

  function parseFile<T>(
    schema: z.ZodType<T>,
    file: string,
    root: string,
    raw: unknown,
  ): T | undefined {
    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
    issues.push(...issuesFromZod(file, root, parsed.error, raw));
    return undefined;
  }

  const species = parseFile(speciesFileSchema, DATA_FILES.species, 'species', bundle.species);
  const moves = parseFile(movesFileSchema, DATA_FILES.moves, 'moves', bundle.moves);
  const affixes = parseFile(affixesFileSchema, DATA_FILES.affixes, 'affixes', bundle.affixes);
  const items = parseFile(itemsFileSchema, DATA_FILES.items, 'items', bundle.items);
  const biomes = parseFile(biomesFileSchema, DATA_FILES.biomes, 'biomes', bundle.biomes);

  const rooms: { file: string; template: RoomTemplate }[] = [];
  for (const room of bundle.rooms) {
    const template = parseFile(roomTemplateSchema, room.file, 'room', room.data);
    if (template !== undefined) rooms.push({ file: room.file, template });
  }

  // Each cross-reference pass runs on whatever parsed, so one broken file does
  // not hide the problems in the others.
  if (species !== undefined) {
    issues.push(...checkSpecies(species, typeIds, moves, items, options));
  }
  if (moves !== undefined) issues.push(...checkMoves(moves, typeIds));
  if (affixes !== undefined) issues.push(...checkAffixes(affixes, typeIds));
  if (items !== undefined) issues.push(...checkItems(items, options));
  if (biomes !== undefined) issues.push(...checkBiomes(biomes, typeIds, species));
  issues.push(...checkRooms(rooms, biomes));

  if (
    issues.length > 0 ||
    species === undefined ||
    moves === undefined ||
    affixes === undefined ||
    items === undefined ||
    biomes === undefined
  ) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    content: {
      typechart,
      species,
      moves,
      affixes,
      items,
      biomes,
      rooms: rooms.map((room) => room.template),
    },
  };
}
