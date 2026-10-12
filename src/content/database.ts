import type {
  Affix,
  Biome,
  Item,
  Move,
  RoomTemplate,
  Species,
  TypeDefinition,
} from './schema/index.ts';
import type { ValidatedContent } from './validate.ts';

/**
 * Typed read access to validated content (GDD 9.2).
 *
 * Every id handed to a getter has already survived the cross-reference pass, so
 * an unknown id here is a bug in code rather than in data, and throwing is the
 * honest response: a silent `undefined` would surface later as a mystery.
 * `tryGet*` exists for the places that genuinely take untrusted input, such as
 * a save file written by an older build.
 */
export type ContentDatabase = {
  readonly types: readonly TypeDefinition[];
  readonly species: readonly Species[];
  readonly moves: readonly Move[];
  readonly affixes: readonly Affix[];
  readonly items: readonly Item[];
  readonly biomes: readonly Biome[];
  readonly rooms: readonly RoomTemplate[];

  getType(id: string): TypeDefinition;
  tryGetType(id: string): TypeDefinition | undefined;
  getSpecies(id: string): Species;
  tryGetSpecies(id: string): Species | undefined;
  getMove(id: string): Move;
  tryGetMove(id: string): Move | undefined;
  getItem(id: string): Item;
  tryGetItem(id: string): Item | undefined;
  getAffix(id: string): Affix;
  tryGetAffix(id: string): Affix | undefined;
  getBiome(id: string): Biome;
  tryGetBiome(id: string): Biome | undefined;
  getRoom(id: string): RoomTemplate;
  tryGetRoom(id: string): RoomTemplate | undefined;

  /**
   * Type effectiveness of one attacking type against a defender's full typing
   * (GDD 4.3). Multiplies one cell per defending type, which is what produces
   * the 4x and 0.25x results; any immunity makes the whole product 0.
   */
  effectiveness(attackTypeId: string, defenderTypeIds: readonly string[]): number;

  /** Same-type attack bonus: 1.5 when the move shares a type with the user. */
  stab(attackTypeId: string, attackerTypeIds: readonly string[]): number;
};

/** STAB multiplier (GDD 4.3). */
export const STAB_MULTIPLIER = 1.5;

function indexById<T extends { id: string }>(rows: readonly T[]): ReadonlyMap<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) map.set(row.id, row);
  return map;
}

function mustGet<T>(map: ReadonlyMap<string, T>, id: string, what: string): T {
  const found = map.get(id);
  if (found === undefined) {
    throw new Error(`unknown ${what} id "${id}"; it is not present in validated content`);
  }
  return found;
}

export function createContentDatabase(content: ValidatedContent): ContentDatabase {
  const typesById = indexById(content.typechart.types);
  const speciesById = indexById(content.species);
  const movesById = indexById(content.moves);
  const itemsById = indexById(content.items);
  const affixesById = indexById(content.affixes);
  const biomesById = indexById(content.biomes);
  const roomsById = indexById(content.rooms);
  const multipliers = content.typechart.multipliers;

  function effectiveness(attackTypeId: string, defenderTypeIds: readonly string[]): number {
    const row = multipliers[attackTypeId];
    if (row === undefined) {
      throw new Error(`unknown attacking type id "${attackTypeId}"`);
    }
    let product = 1;
    for (const defenderTypeId of defenderTypeIds) {
      const cell = row[defenderTypeId];
      if (cell === undefined) {
        throw new Error(
          `unknown defending type id "${defenderTypeId}" for attacking type "${attackTypeId}"`,
        );
      }
      product *= cell;
    }
    return product;
  }

  return {
    types: content.typechart.types,
    species: content.species,
    moves: content.moves,
    affixes: content.affixes,
    items: content.items,
    biomes: content.biomes,
    rooms: content.rooms,

    getType: (id) => mustGet(typesById, id, 'type'),
    tryGetType: (id) => typesById.get(id),
    getSpecies: (id) => mustGet(speciesById, id, 'species'),
    tryGetSpecies: (id) => speciesById.get(id),
    getMove: (id) => mustGet(movesById, id, 'move'),
    tryGetMove: (id) => movesById.get(id),
    getItem: (id) => mustGet(itemsById, id, 'item'),
    tryGetItem: (id) => itemsById.get(id),
    getAffix: (id) => mustGet(affixesById, id, 'affix'),
    tryGetAffix: (id) => affixesById.get(id),
    getBiome: (id) => mustGet(biomesById, id, 'biome'),
    tryGetBiome: (id) => biomesById.get(id),
    getRoom: (id) => mustGet(roomsById, id, 'room template'),
    tryGetRoom: (id) => roomsById.get(id),

    effectiveness,
    stab: (attackTypeId, attackerTypeIds) =>
      attackerTypeIds.includes(attackTypeId) ? STAB_MULTIPLIER : 1,
  };
}
