# DEEPWILD - M0 and M1 Backlog Cut

Approved by Lucas on 2026-10-11 against **DEEPWILD - Game Design Document v1.0**. This is the execution plan for the first two milestones: roughly 20 of your hours, about eight weeks at under 5 hours a week.

Everything here traces to a GDD section. If a task and the GDD disagree, the GDD wins until you say otherwise.

## Who builds it

**Engine** - Game Engineer, reporting to CEO. Hired 2026-10-11 for this project. Its standing instructions carry three rules that outrank its own judgment:

1. Never hardcode a Pokemon name, species, move or type into `src/`. All content is JSON under `data/`. This is GDD �11.3 - the exit door that lets this become a sellable original game later for the price of art, not a rewrite.
2. No official Nintendo assets, ever. Game Boy-*style* art drawn fresh, original chiptune only, no money anywhere near the project. GDD �11.2.
3. Scope is fixed by GDD �10. Nothing joins v1.0 unless something leaves.

CEO owns the design gate at the end (M1-6) and every call the GDD left open.

## Dependency graph

```
GAM-3  M0-1  Repo scaffold
   |
   +-- GAM-4  M0-2  GB render pipeline  --+
   +-- GAM-5  M0-3  Deterministic core  --+--> GAM-7  M1-1  Player movement
   +-- GAM-6  M0-4  Data layer ----------+          |
                        |                           +--> GAM-8   M1-2  Dodge  --+
                        +---------------------------+--> GAM-9   M1-3  First move
                                                              |                 |
                                                              +--> GAM-10 M1-4  Enemy, damage, faint
                                                                        |       |
                                                                        +-------+--> GAM-11 M1-5  Feel pass + deploy
                                                                                            |
                                                                                            +--> GAM-12 M1-6  Your verdict
```

Three tasks run in parallel after the scaffold (M0-2, M0-3, M0-4). Two run in parallel after the player exists (M1-2, M1-3).

## M0 - Skeleton (GDD �12, 8 of your hours, ~2 weeks)

| Issue | Task | GDD refs | Deliverable |
|---|---|---|---|
| GAM-3 | Repo scaffold - Vite, TypeScript strict, Phaser 4, Vitest, Pages deploy | �9.1, �9.5 | `npm run build` works from a clean clone |
| GAM-4 | Game Boy render pipeline - 240x160, integer scaling, 4-shade palette | �8.1, �8.2 | Crisp square pixels at any window size, four colours |
| GAM-5 | Deterministic core - fixed 60Hz loop, seeded RNG, entity registry, event bus | �9.3, �9.4 | Same seed and inputs ? identical state after 10,000 steps |
| GAM-6 | Data layer - schemas, build-time validation, full 18x18 type chart | �9.2, �11.3 | Broken data cannot reach a build |

M0 contains no gameplay on purpose. It is the four foundations that are painful to retrofit: the look, determinism, and the data boundary.

**The one in M0 that is easy to undervalue is GAM-6.** Per-field validation catches typos; the cross-reference checks (every learnset move exists, every evolution target exists, every type name is real) are what make "add 20 Water moves" a safe task to hand an agent. That check is the reason the content plan in �10 is achievable at all.

## M1 - Feel test (GDD �12, 12 of your hours, ~3 weeks)

| Issue | Task | GDD refs | Deliverable |
|---|---|---|---|
| GAM-7 | Player - free WASD movement, mouse aim, follow camera | �4.1, �4.4, �7 | Running around an empty room feels good |
| GAM-8 | Dodge - 3-pip meter, dash with i-frames, recharge | �4.4 | The defensive verb, and the resource that replaced PP |
| GAM-9 | First move - aimed projectile on a cooldown, pooled, spatial-hash collision | �4.2, �4.4, �9.4 | 200 live projectiles at 60fps, move defined purely in data |
| GAM-10 | Chaser enemy, damage with type effectiveness, faint and restart | �4.3, �4.4, �4.7 | A fight you can win or lose, with the type chart mattering |
| GAM-11 | Feel pass and playable build - hitstop, knockback, shake, SFX, deploy | �4.1, �8.3 | A public URL you can play |
| GAM-12 | **Your verdict** - you play it, we re-plan M2 | �12 milestone rule, �13, �15 | The go / revise / turn decision |

### Why M1 is the only milestone that can kill the project

M1 answers one question: **is free-movement Pokemon combat fun to play?** One Pokemon, one move, one enemy. If the answer is no, no amount of content fixes it, and we change direction having spent about 20 of your hours instead of 130.

GAM-11 and GAM-12 are therefore not polish and paperwork. Juice *is* the thing under test - correct systems with no feedback cannot answer the question - and GAM-12 is a real gate with its three outcomes written down in advance so it cannot quietly become a rubber stamp:

- **Fun** ? open M2.
- **Fun but wrong** ? rewrite GDD �4 against what actually felt good, re-cut M2, then code.
- **Not fun** ? stop and turn. Keep free movement and change the combat model, or go back to the Mystery Dungeon grid where the type chart has turn-based room to breathe.

### The risk M1 is quietly testing

GDD �13 flags **"type chart breaks the action game"** as high: a 4x weakness may be unfair when you cannot switch out. GAM-10 deliberately puts a weak, a resistant and an immune enemy in the test room, and GAM-12 asks you directly whether the 4x fight felt exciting or felt unfair. That answer shapes all of M2.

## What is deliberately not in M0 or M1

No dungeon generation. No loot. No levelling, evolution or mastery trees. No hub. No save system. No second move, second species or second enemy archetype. All of it is M2 through M6 in GDD �12.

The temptation at the end of M1 will be to add a second move because it is easy. Do not. The point of M1 is a cheap answer, and every hour added to it makes the answer more expensive.

## Open questions, parked not dropped

The five questions in GDD �15 - species roster, Gen 1 only, difficulty philosophy, the real title, public or private release - are all resolved at GAM-12, where playing the game will have made them much easier to answer. None of them block any task above.
