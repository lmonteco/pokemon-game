import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Enforces the rule that makes palette swapping work at all: every colour on
 * screen comes from `render/palette.ts`.
 *
 * A single `0xff0000` in a scene is a pixel that will not change when the
 * player swaps palette, and it will not look wrong until someone swaps. This
 * test is cheaper than finding that later.
 *
 * Test files are exempt: a test that pins the shade values written in GDD 8.1
 * has to name them, or it is testing nothing.
 */
const SRC = join(fileURLToPath(new URL('../', import.meta.url)));

const EXEMPT = new Set(['render/palette.ts']);

/** `0x` plus six hex digits, or a CSS hex colour inside a string. */
const COLOUR_LITERAL = /0x[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) {
      return [];
    }

    return [path];
  });

describe('palette discipline', () => {
  const files = sourceFiles(SRC).filter(
    (path) => !EXEMPT.has(relative(SRC, path).split('\\').join('/')),
  );

  it('found source files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('has no colour literal outside render/palette.ts', () => {
    const offenders: string[] = [];

    files.forEach((path) => {
      readFileSync(path, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (COLOUR_LITERAL.test(line)) {
            offenders.push(`${relative(SRC, path)}:${i + 1}: ${line.trim()}`);
          }
        });
    });

    expect(offenders).toEqual([]);
  });
});
