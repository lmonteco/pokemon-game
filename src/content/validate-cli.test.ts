import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * End-to-end over `npm run validate:data` (GDD 9.2).
 *
 * `validate.test.ts` covers the rules themselves in memory. This file covers
 * the thing the build actually depends on: the script exits non-zero and says
 * which file, which path and which value it rejected. An exit code of 0 on
 * broken data would let bad content reach a build silently.
 *
 * Each case copies the real `data/` to a throwaway directory and breaks exactly
 * one thing. The broken values below ("not-a-type") are invented, so no content
 * name is written into `src/` (GDD 11.3).
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const script = join(repoRoot, 'scripts/validate-data.ts');

/** Deliberately loose: a test has to be able to put 9999 where 1..255 belongs. */
type MutableSpecies = {
  types: string[];
  baseStats: Record<string, number>;
  learnset: { moveId: string; level: number }[];
  evolution?: { method: string; into: string; level: number };
};

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'deepwild-data-'));
  cpSync(join(repoRoot, 'data'), join(root, 'data'), { recursive: true });
  cpSync(join(repoRoot, 'assets'), join(root, 'assets'), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function runValidate(): { status: number | null; output: string } {
  const run = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

/** Breaks one field of the first species in the copied `data/species.json`. */
function breakFirstSpecies(edit: (species: MutableSpecies) => void): void {
  const file = join(root, 'data/species.json');
  const species = JSON.parse(readFileSync(file, 'utf8')) as MutableSpecies[];
  const first = species[0];
  expect(first).toBeDefined();
  edit(first!);
  writeFileSync(file, JSON.stringify(species, null, 2));
}

describe('validate:data on good data', () => {
  it('exits 0 and reports what it loaded', () => {
    const { status, output } = runValidate();
    expect(output).toContain('data/ is valid');
    expect(status).toBe(0);
  });
});

describe('validate:data on broken data', () => {
  it('rejects an unknown type name', () => {
    breakFirstSpecies((species) => {
      species.types = ['not-a-type'];
    });
    const { status, output } = runValidate();
    expect(status).toBe(1);
    expect(output).not.toContain('data/ is valid');
    expect(output).toContain('data/species.json');
    expect(output).toContain('species[0].types[0]');
    expect(output).toContain('typechart.json');
    expect(output).toContain('"not-a-type"');
  });

  it('rejects a learnset move that is not in moves.json', () => {
    breakFirstSpecies((species) => {
      species.learnset = [{ moveId: 'no-such-move', level: 1 }];
    });
    const { status, output } = runValidate();
    expect(status).toBe(1);
    expect(output).toContain('data/species.json');
    expect(output).toContain('species[0].learnset[0].moveId');
    expect(output).toContain('moves.json');
    expect(output).toContain('"no-such-move"');
  });

  it('rejects an evolution pointing at a species that does not exist', () => {
    breakFirstSpecies((species) => {
      species.evolution = { method: 'level', into: 'no-such-species', level: 16 };
    });
    const { status, output } = runValidate();
    expect(status).toBe(1);
    expect(output).toContain('data/species.json');
    expect(output).toContain('species[0].evolution.into');
    expect(output).toContain('"no-such-species"');
  });

  it('rejects an out-of-range base stat', () => {
    breakFirstSpecies((species) => {
      species.baseStats['hp'] = 9999;
    });
    const { status, output } = runValidate();
    expect(status).toBe(1);
    expect(output).toContain('data/species.json');
    expect(output).toContain('species[0].baseStats.hp');
    expect(output).toContain('9999');
  });

  it('reports a missing file rather than loading an empty game', () => {
    rmSync(join(root, 'data/species.json'));
    const { status, output } = runValidate();
    expect(status).toBe(1);
    expect(output).toContain('data/species.json');
    expect(output).toContain('file is missing');
  });
});

describe('the npm scripts', () => {
  it('gate the build and the test run on validation, before anything else runs', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    // Order matters: validation has to run before tsc and vite, or a broken
    // data/ only shows up after a build has already been produced.
    expect(pkg.scripts['build']).toMatch(/^npm run validate:data &&/);
    expect(pkg.scripts['test']).toMatch(/^npm run validate:data &&/);
  });
});
