# `data/` — all game content

Everything the game knows about species, moves, types, loot, items, biomes and
rooms lives here as JSON. Nothing in `src/` names a single one of them. This is
GDD §9.2 and §11.3, and it is the rule that keeps DEEPWILD portable off the
Pokemon IP for the price of new art rather than a rewrite.

**Run `npm run validate:data` after every edit.** It also runs inside
`npm run build` and `npm test`, so invalid content cannot reach a build.

## The files

| File             | Holds                                                                          |
| ---------------- | ------------------------------------------------------------------------------ |
| `typechart.json` | The 18 types and the full 18×18 multiplier grid                                |
| `species.json`   | id, displayName, types, baseStats, learnset, evolution, spriteKey, aiArchetype |
| `moves.json`     | id, displayName, type, category, power, shape, cooldown, cast, effect          |
| `items.json`     | Consumables and gear bases                                                     |
| `affixes.json`   | Loot affixes, with a roll range per rarity tier                                |
| `biomes.json`    | Floor range, favoured types, spawn table, boss, weather, hazards               |
| `rooms/*.json`   | One hand-authored room template per file                                       |

The authoritative definition of every field is the Zod schema in
`src/content/schema/`. The TypeScript types the engine uses are inferred from
those schemas, so the schema and the code can never drift apart.

## What is real content and what is a stub

`typechart.json` is complete and final: all 18 types, every multiplier,
including the eight immunities.

Everything else is seed data proving the pipeline works, as agreed for M0-4:
one species, one move, one affix, one biome and one room template. `items.json`
is empty. The real roster arrives in M1 and M2 (GDD §10). In particular, the
spawn table in `verdant-hollow` lists the one species that exists today; it is a
placeholder, not a design decision.

## Adding content

1. Copy an existing row and change it. Ids are lower-case kebab-case.
2. Every reference must resolve: a `type` must be a type id in
   `typechart.json`, a `moveId` must exist in `moves.json`, an `evolution.into`
   must exist in `species.json`, a `spriteKey` must have a matching
   `assets/sprites/<key>.png`.
3. Run `npm run validate:data`. Failures name the file, the path and the value
   that was rejected.

Unknown field names are rejected rather than ignored, so a typo in a key is an
error and not a silently missing value.

## Units and conventions

- `cooldown` is in seconds. `cast` is in simulation frames at 60Hz (GDD §4.2).
- `power` must be 0 for a `status` move and above 0 for any other category.
- Base stats are 1–255. Levels are 1–50 (GDD §6.1).
- A type-chart cell may only be `0`, `0.5`, `1` or `2`. The 4× and 0.25×
  results come from multiplying the two cells of a dual-type defender, which
  the loader does once in `effectiveness()` (GDD §4.3).

## Room template glyphs

`tiles` is one string per row, each exactly `width` characters, with exactly
`height` rows.

| Glyph | Tile              |
| ----- | ----------------- |
| `.`   | floor             |
| `#`   | wall              |
| `~`   | water             |
| `^`   | lava              |
| `o`   | destructible rock |
| `+`   | door              |
| `>`   | stairway          |
| `p`   | player start      |
| `e`   | enemy spawn       |
| `i`   | item spawn        |

## Art and audio

Original assets only — Game Boy _style_, drawn fresh. No ripped sprites, no
ripped audio, no ripped data files (GDD §11.2). The placeholder sprite in
`assets/sprites/` was drawn for this repository and is a placeholder, not final
art.
