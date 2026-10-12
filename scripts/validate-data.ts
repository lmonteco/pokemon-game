import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { formatIssues } from '../src/content/validate.ts';
import { validateContentOnDisk } from '../src/content/node-loader.ts';

/**
 * `npm run validate:data` (GDD 9.2).
 *
 * Wired into both `npm run build` and `npm test`, so invalid content cannot
 * reach a build. Exits 1 and prints every problem with its file, its path and
 * the value that was rejected.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = validateContentOnDisk(repoRoot);

if (!result.ok) {
  console.error(`data/ is invalid - ${result.issues.length} problem(s):\n`);
  console.error(formatIssues(result.issues));
  console.error('\nSee data/README.md for the schema of each file.');
  process.exit(1);
}

const { content } = result;
console.log(
  [
    'data/ is valid:',
    `  ${content.typechart.types.length} types (${content.typechart.types.length ** 2} chart cells)`,
    `  ${content.species.length} species`,
    `  ${content.moves.length} moves`,
    `  ${content.items.length} items`,
    `  ${content.affixes.length} affixes`,
    `  ${content.biomes.length} biomes`,
    `  ${content.rooms.length} room templates`,
  ].join('\n'),
);
