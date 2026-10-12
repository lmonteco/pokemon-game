/**
 * The lint rule for determinism (GDD 9.3, 9.4).
 *
 * One unseeded random call or one wall-clock read inside a simulation path and
 * a run stops being reproducible - and the symptom is not a crash, it is a
 * balance report that quietly disagrees with itself. That class of bug is
 * cheap to prevent and expensive to find, so it is a build failure.
 *
 * This is a test rather than an ESLint rule on purpose: it needs no new
 * dependency, it fails the same `npm test` that CI already runs, and the
 * message it prints names the fix. `npm run lint:determinism` runs it alone.
 *
 * The rule:
 *   - unseeded randomness is banned everywhere in `src/`. There is no
 *     legitimate use in this codebase; even a cosmetic sparkle belongs on the
 *     `cosmetic` random stream so that a recorded run reproduces exactly.
 *   - wall-clock reads are banned in the simulation paths. The renderer may
 *     read a clock, because the renderer may not change simulation state.
 *
 * Comments are not scanned, so prose may name the banned calls. For a line of
 * code that genuinely needs an exception, write `determinism-ok:` and a reason
 * in a comment on the same line; one grep then finds every exception.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The simulation directories from the repository shape in GDD 9.5. Everything
 * not listed is render or entry-point code, where a clock is allowed.
 */
/** Render-side directories: Phaser scenes may read a clock. */
const RENDER_DIRS = ['render', 'hub'];

const SIM_DIRS = ['core', 'combat', 'content', 'dungeon', 'entities', 'loot', 'progression', 'sim'];

interface Rule {
  readonly pattern: RegExp;
  readonly label: string;
  /** Checked everywhere in `src/`, or only in the simulation paths. */
  readonly scope: 'src' | 'sim';
  readonly fix: string;
}

const RULES: readonly Rule[] = [
  {
    pattern: /\bMath\s*\.\s*random\b/,
    label: 'unseeded randomness',
    scope: 'src',
    fix: 'draw from a seeded stream, e.g. world.rng.combat.nextFloat()',
  },
  {
    pattern: /\bcrypto\s*\.\s*getRandomValues\b/,
    label: 'unseeded randomness',
    scope: 'src',
    fix: 'draw from a seeded stream, e.g. world.rng.loot.nextInt(n)',
  },
  {
    pattern: /\bDate\s*\.\s*now\b/,
    label: 'wall-clock read',
    scope: 'sim',
    fix: 'read simulated time: world.timeMs, or the tick index',
  },
  {
    pattern: /\bnew\s+Date\b/,
    label: 'wall-clock read',
    scope: 'sim',
    fix: 'read simulated time: world.timeMs, or the tick index',
  },
  {
    pattern: /\bperformance\s*\.\s*now\b/,
    label: 'wall-clock read',
    scope: 'sim',
    fix: 'read simulated time: world.timeMs, or the tick index',
  },
];

function listSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...listSourceFiles(full));
    } else if (entry.endsWith('.ts')) {
      found.push(full);
    }
  }
  return found.sort();
}

/**
 * Blanks out comments, keeping the line count intact so reported line numbers
 * still point at the right place. Deliberately simple: this codebase is
 * prettier-formatted, so a `//` inside a string literal is the only false
 * positive available and there are none.
 */
function stripComments(lines: readonly string[]): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of lines) {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end === -1) {
        out.push('');
        continue;
      }
      line = line.slice(end + 2);
      inBlock = false;
    }
    const blockStart = line.indexOf('/*');
    if (blockStart !== -1) {
      const blockEnd = line.indexOf('*/', blockStart + 2);
      if (blockEnd === -1) {
        inBlock = true;
        line = line.slice(0, blockStart);
      } else {
        line = line.slice(0, blockStart) + line.slice(blockEnd + 2);
      }
    }
    const lineComment = line.indexOf('//');
    out.push(lineComment === -1 ? line : line.slice(0, lineComment));
  }
  return out;
}

function isSimulationPath(relativePath: string): boolean {
  const [top] = relativePath.split(sep);
  return top !== undefined && SIM_DIRS.includes(top);
}

function scan(): string[] {
  const violations: string[] = [];
  for (const file of listSourceFiles(SRC_DIR)) {
    const relativePath = relative(SRC_DIR, file);
    const isSim = isSimulationPath(relativePath);
    const rawLines = readFileSync(file, 'utf8').split(/\r?\n/);
    const codeLines = stripComments(rawLines);

    codeLines.forEach((code, index) => {
      if ((rawLines[index] ?? '').includes('determinism-ok:')) {
        return;
      }
      for (const rule of RULES) {
        if (rule.scope === 'sim' && !isSim) {
          continue;
        }
        if (rule.pattern.test(code)) {
          const where = `src/${relativePath.split(sep).join('/')}:${index + 1}`;
          violations.push(`${where}: ${rule.label} /${rule.pattern.source}/ -> ${rule.fix}`);
        }
      }
    });
  }
  return violations;
}

describe('determinism lint', () => {
  it('finds no unseeded randomness and no wall clock in the simulation paths', () => {
    expect(scan()).toEqual([]);
  });

  // A lint rule nobody has watched fire is a lint rule that does not work.
  // These two check the matcher against the exact text it must reject and the
  // text it must leave alone.
  it('rejects the calls it is supposed to reject', () => {
    const banned = [
      'const roll = Math.random();', // determinism-ok: the rule's own fixture
      'const roll = Math . random ();', // determinism-ok: the rule's own fixture
      'const bytes = crypto.getRandomValues(buffer);', // determinism-ok: fixture
      'const t = Date.now();', // determinism-ok: the rule's own fixture
      'const t = performance.now();', // determinism-ok: the rule's own fixture
      'const stamp = new Date();', // determinism-ok: the rule's own fixture
    ];
    for (const line of banned) {
      expect(RULES.some((rule) => rule.pattern.test(line))).toBe(true);
    }
  });

  it('leaves legitimate code alone', () => {
    const allowed = [
      'const roll = world.rng.loot.nextFloat();',
      'const elapsed = world.timeMs;',
      'const rounded = Math.round(value);',
      'const clamped = Math.min(a, b);',
      "const label = 'randomise';",
      'const updated = record.dateNow;',
    ];
    for (const line of allowed) {
      expect(RULES.some((rule) => rule.pattern.test(line))).toBe(false);
    }
  });

  it('does not scan comments, so prose can name the banned calls', () => {
    const [code] = stripComments(['const x = 1; // see Math.random, which is banned']);
    expect(code).toBe('const x = 1; ');
    expect(stripComments(['/**', ' * Date.now() is banned here', ' */'])).toEqual(['', '', '']);
    expect(stripComments(['/* Date.now()', 'still comment', 'end */ const y = 2;'])).toEqual([
      '',
      '',
      ' const y = 2;',
    ]);
  });

  it('covers every simulation directory that exists on disk', () => {
    // If a new simulation directory appears and nobody adds it to SIM_DIRS,
    // the rule silently stops covering it. So the list is checked against the
    // directories that are actually there.
    const onDisk = readdirSync(SRC_DIR).filter((entry) =>
      statSync(join(SRC_DIR, entry)).isDirectory(),
    );
    const uncovered = onDisk.filter((dir) => !SIM_DIRS.includes(dir) && !RENDER_DIRS.includes(dir));
    expect(uncovered).toEqual([]);
  });
});
