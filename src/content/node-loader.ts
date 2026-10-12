import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { DATA_FILES, validateContent } from './validate.ts';
import type { ContentIssue, RawContentBundle, RawRoomFile, ValidationResult } from './validate.ts';

/**
 * Reads `data/` from the filesystem for build-time validation.
 *
 * Build-time only. The browser entry (`index.ts`) gets its content from the
 * bundler instead, so nothing in here is ever shipped; keep `node:` imports
 * confined to this file.
 */

/** Where a sprite key is expected to resolve to a file. */
export const SPRITE_DIR = 'assets/sprites';
export const SPRITE_EXTENSION = '.png';

function toPosix(path: string): string {
  return path.split(sep).join(posix.sep);
}

/** A file that could not be read or was not valid JSON. */
function readJsonFile(rootDir: string, relativePath: string): { data: unknown } | ContentIssue {
  const absolute = join(rootDir, relativePath);
  if (!existsSync(absolute)) {
    return { file: relativePath, path: '(file)', message: 'file is missing' };
  }
  let text: string;
  try {
    text = readFileSync(absolute, 'utf8');
  } catch (error) {
    return {
      file: relativePath,
      path: '(file)',
      message: `could not be read: ${(error as Error).message}`,
    };
  }
  try {
    return { data: JSON.parse(text) as unknown };
  } catch (error) {
    return {
      file: relativePath,
      path: '(file)',
      message: `is not valid JSON: ${(error as Error).message}`,
    };
  }
}

function isIssue(value: { data: unknown } | ContentIssue): value is ContentIssue {
  return 'message' in value;
}

export type DiskReadResult = {
  bundle: RawContentBundle;
  /** Problems reading or parsing files, before any schema ran. */
  issues: ContentIssue[];
};

/** Reads every content file, collecting read errors rather than throwing. */
export function readContentFromDisk(rootDir: string): DiskReadResult {
  const issues: ContentIssue[] = [];

  function read(relativePath: string): unknown {
    const result = readJsonFile(rootDir, relativePath);
    if (isIssue(result)) {
      issues.push(result);
      return undefined;
    }
    return result.data;
  }

  const rooms: RawRoomFile[] = [];
  const roomsDir = join(rootDir, DATA_FILES.roomsDir);
  if (existsSync(roomsDir)) {
    const roomFiles = readdirSync(roomsDir)
      .filter((name) => name.endsWith('.json'))
      .sort();
    for (const name of roomFiles) {
      const relativePath = toPosix(relative(rootDir, join(roomsDir, name)));
      const result = readJsonFile(rootDir, relativePath);
      if (isIssue(result)) issues.push(result);
      else rooms.push({ file: relativePath, data: result.data });
    }
  }

  return {
    bundle: {
      typechart: read(DATA_FILES.typechart),
      species: read(DATA_FILES.species),
      moves: read(DATA_FILES.moves),
      affixes: read(DATA_FILES.affixes),
      items: read(DATA_FILES.items),
      biomes: read(DATA_FILES.biomes),
      rooms,
    },
    issues,
  };
}

/** Resolves a sprite key against `assets/sprites/<key>.png`. */
export function createSpriteExists(rootDir: string): (spriteKey: string) => boolean {
  const spriteDir = join(rootDir, SPRITE_DIR);
  const present = existsSync(spriteDir)
    ? new Set(
        readdirSync(spriteDir)
          .filter((name) => name.endsWith(SPRITE_EXTENSION))
          .map((name) => name.slice(0, -SPRITE_EXTENSION.length)),
      )
    : new Set<string>();
  return (spriteKey) => present.has(spriteKey);
}

/** Reads and fully validates `data/`, including sprite files. */
export function validateContentOnDisk(rootDir: string): ValidationResult {
  const { bundle, issues } = readContentFromDisk(rootDir);
  // A file that would not parse cannot be schema-checked, so report the read
  // errors on their own rather than alongside a cascade of "expected array".
  if (issues.length > 0) return { ok: false, issues };
  return validateContent(bundle, { spriteExists: createSpriteExists(rootDir) });
}
