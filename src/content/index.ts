import affixesData from '../../data/affixes.json';
import biomesData from '../../data/biomes.json';
import itemsData from '../../data/items.json';
import movesData from '../../data/moves.json';
import speciesData from '../../data/species.json';
import typechartData from '../../data/typechart.json';
import { createContentDatabase } from './database.ts';
import type { ContentDatabase } from './database.ts';
import { formatIssues, validateContent } from './validate.ts';
import type { RawRoomFile } from './validate.ts';

/**
 * The game's content, bundled and validated (GDD 9.2).
 *
 * This is the browser entry: the bundler inlines `data/` at build time, so the
 * shipped game carries no file reads. Validation runs again here because it is
 * cheap and it turns a bad hand edit during `vite dev` into an immediate,
 * located error instead of a strange crash two scenes later.
 *
 * Sprite keys are not re-checked: the bundler already resolved the assets.
 */

const roomModules = import.meta.glob<unknown>('../../data/rooms/*.json', {
  eager: true,
  import: 'default',
});

const rooms: RawRoomFile[] = Object.entries(roomModules)
  .map(([path, data]) => ({ file: path.replace('../../', ''), data }))
  .sort((a, b) => a.file.localeCompare(b.file));

const result = validateContent({
  typechart: typechartData,
  species: speciesData,
  moves: movesData,
  affixes: affixesData,
  items: itemsData,
  biomes: biomesData,
  rooms,
});

if (!result.ok) {
  throw new Error(`invalid content in data/:\n${formatIssues(result.issues)}`);
}

/** Validated content, ready to read. Import this, never the JSON directly. */
export const content: ContentDatabase = createContentDatabase(result.content);

export * from './schema/index.ts';
export { createContentDatabase, STAB_MULTIPLIER } from './database.ts';
export type { ContentDatabase } from './database.ts';
export { formatIssues, validateContent, DATA_FILES } from './validate.ts';
export type {
  ContentIssue,
  RawContentBundle,
  RawRoomFile,
  ValidatedContent,
  ValidateOptions,
  ValidationResult,
} from './validate.ts';
