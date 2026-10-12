import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createContentDatabase } from './database.ts';
import { validateContentOnDisk } from './node-loader.ts';
import { formatIssues } from './validate.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('the shipped content in data/', () => {
  const result = validateContentOnDisk(repoRoot);

  it('validates, including every cross-reference and sprite file', () => {
    if (!result.ok) throw new Error(`data/ is invalid:\n${formatIssues(result.issues)}`);
    expect(result.ok).toBe(true);
  });

  it('loads into a database whose accessors resolve', () => {
    if (!result.ok) return;
    const content = createContentDatabase(result.content);

    // Ids come from the data, never from a literal here, so this test keeps
    // working when the roster changes and never names a species in src/.
    for (const species of content.species) {
      expect(content.getSpecies(species.id)).toBe(species);
      for (const type of species.types) {
        expect(content.getType(type).id).toBe(type);
      }
      for (const learned of species.learnset) {
        expect(content.getMove(learned.moveId).id).toBe(learned.moveId);
      }
    }
    for (const move of content.moves) {
      expect(content.getMove(move.id)).toBe(move);
      expect(content.getType(move.type).id).toBe(move.type);
    }
  });

  it('throws rather than returning undefined for an id that does not exist', () => {
    if (!result.ok) return;
    const content = createContentDatabase(result.content);
    expect(() => content.getSpecies('no-such-species')).toThrow(/no-such-species/);
    expect(() => content.getMove('no-such-move')).toThrow(/no-such-move/);
    expect(content.tryGetSpecies('no-such-species')).toBeUndefined();
  });

  it('carries the seed content the rest of the milestones build on', () => {
    if (!result.ok) return;
    expect(result.content.species.length).toBeGreaterThanOrEqual(1);
    expect(result.content.moves.length).toBeGreaterThanOrEqual(1);
  });

  it('loads the same content through the bundler entry the game uses', async () => {
    // Exercises the browser path: static JSON imports plus the room glob. The
    // disk loader above and this one must agree, or the shipped build would be
    // validating something other than what it runs.
    const { content } = await import('./index.ts');
    if (!result.ok) return;
    expect(content.species.map((entry) => entry.id)).toEqual(
      result.content.species.map((entry) => entry.id),
    );
    expect(content.moves.map((entry) => entry.id)).toEqual(
      result.content.moves.map((entry) => entry.id),
    );
    expect(content.rooms.map((entry) => entry.id)).toEqual(
      result.content.rooms.map((entry) => entry.id),
    );
    expect(content.types).toHaveLength(18);
  });
});

/**
 * GDD 11.3: no species, move or type name is ever written in `src/`. That rule
 * is what keeps the game portable off the IP for the price of new art, and it
 * is too easy to break by accident for a code review to be the only guard.
 */
describe('src/ names no content', () => {
  /**
   * Engine words that happen to collide with a type id. Each is a real engine
   * concept from the GDD, not a reference to the type: water is a floor tile
   * and a hazard (5.3), poison is a status condition (4.5). Add to this list
   * only with the same justification.
   */
  const ENGINE_WORDS_THAT_COLLIDE_WITH_TYPE_IDS = new Set(['water', 'poison']);

  function readJson(relativePath: string): unknown {
    return JSON.parse(readFileSync(resolve(repoRoot, relativePath), 'utf8')) as unknown;
  }

  function collectSourceFiles(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) found.push(...collectSourceFiles(full));
      else if (entry.name.endsWith('.ts')) found.push(full);
    }
    return found;
  }

  const sourceFiles = collectSourceFiles(resolve(repoRoot, 'src')).map((file) => ({
    path: file.slice(repoRoot.length + 1).replace(/\\/g, '/'),
    text: readFileSync(file, 'utf8'),
  }));

  it('finds source files to check', () => {
    expect(sourceFiles.length).toBeGreaterThan(5);
  });

  it('never writes a species, move, item, biome or affix name', () => {
    const names = new Set<string>();
    for (const file of ['species', 'moves', 'items', 'biomes', 'affixes']) {
      const rows = readJson(`data/${file}.json`) as { id: string; displayName: string }[];
      for (const row of rows) {
        names.add(row.id);
        names.add(row.displayName);
      }
    }
    expect(names.size).toBeGreaterThan(0);

    const offences: string[] = [];
    for (const name of names) {
      const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      for (const file of sourceFiles) {
        if (pattern.test(file.text)) offences.push(`${file.path} names "${name}"`);
      }
    }
    expect(offences).toEqual([]);
  });

  it('never writes a type id as a string literal', () => {
    const chart = readJson('data/typechart.json') as { types: { id: string }[] };
    const offences: string[] = [];
    for (const { id } of chart.types) {
      if (ENGINE_WORDS_THAT_COLLIDE_WITH_TYPE_IDS.has(id)) continue;
      const pattern = new RegExp(`['"\`]${id}['"\`]`, 'i');
      for (const file of sourceFiles) {
        if (pattern.test(file.text)) offences.push(`${file.path} names the type "${id}"`);
      }
    }
    expect(offences).toEqual([]);
  });
});
