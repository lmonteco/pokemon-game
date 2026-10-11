# DEEPWILD

A Game Boy-styled action roguelike for the browser: twitch-aimed combat, procedural dungeons, and loot, built on Phaser 4 + Vite + TypeScript.

Run it: `npm install`, then `npm run dev` and open the printed URL. `npm run build` writes a static bundle to `dist/`; `npm run test` runs Vitest; `npm run typecheck` runs the compiler with no emit.

This is a free, non-commercial fan project. It contains **no** official Nintendo, Game Freak or Pokemon Company assets — all art is drawn fresh in a Game Boy style and all audio is original chiptune. There is no revenue of any kind attached to it: no sales, ads, donations or crowdfunding.

## Layout

| Path              | Holds                                                |
| ----------------- | ---------------------------------------------------- |
| `src/core`        | fixed-step loop, entity registry, seeded RNG, events |
| `src/combat`      | damage, type chart, status, cooldowns, move shapes   |
| `src/dungeon`     | generator, room templates, spawning                  |
| `src/entities`    | player, enemy AI archetypes, projectiles, pickups    |
| `src/loot`        | affix rolling, rarity, drop tables                   |
| `src/progression` | xp, evolution, mastery trees, save                   |
| `src/render`      | Phaser scenes, palette shader, UI kit                |
| `src/hub`         | hub scenes                                           |
| `src/sim`         | headless balance harness                             |
| `data/`           | **all** content as validated JSON                    |
| `assets/`         | sprites, tiles, audio                                |
| `docs/`           | design document and successors                       |

No content — no creature name, move or type — is hardcoded in `src/`. It all lives in `data/` and is validated at build time (design doc 9.2, 11.3).

## Docs

- `docs/02-gdd.md` — the design document. Source of truth.
- `docs/03-backlog-m0-m1.md` — the current milestone cut.
