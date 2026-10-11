# DEEPWILD -- Game Design Document

**Working title:** DEEPWILD (a Pokemon fan game)
**Project:** Pokemon (repo `lmonteco/pokemon-game`)
**Version:** 1.0 (first complete draft)
**Date:** 2026-10-11
**Author:** CEO
**Status:** AWAITING YOUR APPROVAL. Written from your answers on GAM-2, not from my guesses.

---

## 0. Where this came from

You answered eight questions. This is what I built from them.

| Your answer | What it decided in this document |
|---|---|
| "I play as a Pokemon, dungeon crawling, like Torchlight 2. Type matters, we have loot, we can improve our abilities. Gameboy-simple graphics, free movement, not grid." | **Everything.** This is the game. Section 1 onward is this sentence worked out in detail. |
| Goal: build the game I have always wanted to play | Scope is set by what makes the game good, then cut to fit your hours. Not by what is fastest to sell. |
| Love: deep battling, and long-term progression | Type chart stays real and deep (Section 4). Levels, evolution, move mastery and loot all persist (Section 6). |
| Direction: run-based gauntlet (roguelite) | Kept as *structure*, not as genre. Dungeon runs are generated and risky; your Pokemon keeps what it earns. Section 3. |
| Pokemon fan game, free, non-commercial | Real Pokemon names and species. Section 11 covers what that costs you and how we stay buildable. |
| Browser | Phaser + TypeScript, no server, no install. Section 9. |
| You plus AI agents, no budget | Data-driven content so agents can write it. Automated balance sim instead of a QA team. Section 9, 12. |
| Under 5 hours a week | Milestones in Section 12 are sized in *your* hours, not in team-months. Playable in 6 weeks. |

**The one conflict, and how I resolved it.** You picked the roguelite option *and* you asked for Torchlight 2, which is not a roguelite -- Torchlight has permanent characters and permanent loot. Your own-idea answer outranks the option list, so:

> **Runs are disposable. Your Pokemon is not.**
> You descend into a generated dungeon for 15-25 minutes. Layout, enemies and loot are different every time. If you faint, you lose the loot you were *carrying* and nothing else -- your levels, your learned moves, your stashed gear all survive. That is Torchlight's persistence with a roguelite's risk, and it is also exactly how Mystery Dungeon already worked.

---

## 1. One-paragraph pitch

You are not a trainer. You are a Charmander, standing at the mouth of a cave that was not there yesterday. DEEPWILD is a browser action-RPG where you play *as* a single Pokemon, crawling procedurally built dungeons in real time -- free movement, no grid, no turns. You aim four moves with the mouse, dodge what is telegraphed at you, and learn the 18-type chart with your reflexes instead of a menu. Everything you kill drops something: berries, TMs, held items rolled with random stats. You level, you evolve, you pick which branch of each move to master. Then you go back down, deeper, for the better loot. It looks like a Game Boy game because that is the right amount of art for one person to make and the right amount of nostalgia to earn.

**Elevator version:** Pokemon Mystery Dungeon with Torchlight's hands.

**Comparables:** Torchlight 2 (loot, skill trees, feel), Pokemon Mystery Dungeon (structure, tone, items), Hades (run shape, death as progress), Children of Morta / Moonlighter (scale and art budget reality).

---

## 2. Design pillars

Five rules. Every feature decision in this document is traceable to one of them, and a feature that serves none of them is cut.

1. **You are the Pokemon.** No trainer, no party commands, no catching as the main verb. One creature on screen, under your direct control. Your identity in the game *is* a species -- its typing, its stats, its moveset, its evolution.
2. **Type is the whole puzzle.** Not a damage modifier you forget about. Every enemy's type is visible at a glance, your coverage is a real build decision, and a 4x weakness kills you in two hits regardless of level.
3. **Free movement is the combat.** Positioning, aim and dodging are how you express skill. Nothing in this game is grid-locked or turn-locked, including hazards and status effects.
4. **Every descent pays out.** Loot, levels and mastery points. No run is wasted, even a failed one. The dopamine loop is Torchlight's: kill, drop, equip, feel stronger, go deeper.
5. **Game Boy honesty.** 4-shade palette, small sprites, chunky UI. This is a style choice *and* a scope weapon: it means one person can draw a Pokemon in an hour instead of a week.

---

## 3. Core loop

### 3.1 The three loops

**Moment to moment (5 seconds).** See enemy, read its type, choose the move that beats it, aim, dodge its telegraph, kill it, grab what dropped.

**Run to run (15-25 minutes).** Enter dungeon at Floor 1. Clear or skip rooms, find the stairs, descend. Depth increases enemy level and loot tier. Floor 5 / 10 / 15 hold boss rooms. You leave in one of three ways:
- **Stairs out / Escape Orb** -- you bank everything you carried. Safe.
- **Faint** -- you keep XP, mastery and stash; you lose carried items and money. You wake in the hub.
- **Push deeper** -- the greed decision, and the whole tension of the game.

**Session to session (hours to months).** Hub upgrades, new species unlocked, evolution, move mastery trees, better stash, deeper dungeons, harder optional tiers.

### 3.2 The greed decision

This is the game's central choice and it must be present on every floor. After each boss the game offers an exit and tells you plainly what you are risking:

```
    FLOOR 10 CLEARED
    Carrying: 2 Ultra items, 1 TM, 3,400 Poke
    [ LEAVE AND BANK ]        [ DESCEND -- Floor 11 (+1 loot tier) ]
```

Carried value grows faster than player power, so the correct answer changes every run. That is the engine of replay.

---

## 4. Combat

### 4.1 Feel

Top-down, WASD to move, mouse to aim, 1-4 for moves, Space to dodge. 60fps. Hits connect with a 3-frame freeze and a screen shake of 2 pixels. Enemies telegraph with a 0.3-0.5s windup and a visible shape on the floor. Nothing is unavoidable; everything is punishing.

### 4.2 Moves

Four move slots -- the Game Boy constraint, kept on purpose. Each move has:

| Field | Meaning |
|---|---|
| Type | One of 18. Drives the matchup chart and STAB. |
| Category | Physical (uses Atk/Def) or Special (SpA/SpD). Status moves do no damage. |
| Power | Base damage number, as in the main series. |
| Shape | **How it exists in space.** This is the new field and it is what makes the game action. |
| Cooldown | Seconds before reuse. Replaces PP (see 4.4). |
| Cast | Windup frames. Big moves root you briefly -- commitment is the cost of power. |

**Move shapes** (the content vocabulary -- about 10 shapes cover every move in the series):

- **Projectile** -- travels, pierces or stops. *Ember, Water Gun, Thunder Shock*
- **Beam** -- instant line, hits all in path. *Hyper Beam, Flamethrower*
- **Melee arc** -- short cone in front. *Tackle, Scratch, Slash*
- **Dash attack** -- you move through enemies, damaging them. *Quick Attack, Flame Charge*
- **Nova** -- radial burst centred on you. *Earthquake, Discharge*
- **Zone** -- lingering ground area. *Lava Plume, Toxic Spikes*
- **Lob** -- arcing shot landing at a target point. *Mud Bomb, Seed Bomb*
- **Spawn** -- places an object or minion. *Substitute, Spikes*
- **Self** -- buff, heal or shield. *Swords Dance, Recover, Protect*
- **Hitscan cone** -- wide instant spray, short range. *Powder moves, Sweet Scent*

A move is therefore `{type, category, power, shape, cooldown, cast, effect}` -- a row in a JSON file. Content becomes data entry, which is the only way a solo project reaches a real roster.

### 4.3 Damage

Keep the series formula so numbers feel familiar, with one honest change: no random damage roll beyond a thin band, because in an action game the player's aim should be the variance.

```
damage = ((2 * level / 5 + 2) * power * A / D / 50 + 2)
         * STAB          (1.5 if move type matches one of your types)
         * typeEffect    (0, 0.25, 0.5, 1, 2 or 4 from the chart)
         * crit          (1.5, base 5% chance)
         * weather / field / affix modifiers
         * random(0.95, 1.05)
```

**Type effectiveness is the full 18x18 Gen 6+ chart, unmodified.** 4x weaknesses exist and are lethal. This is pillar 2 and it is not negotiable for balance convenience.

**Immunity is real.** A Normal-type move against a Ghost does nothing -- the number pops as `MISS` in Game Boy font. Players will learn the chart because the game refuses to let them not.

### 4.4 Stats, and how they become action-game verbs

| Stat | In DEEPWILD |
|---|---|
| HP | Health. No revives in-dungeon except items. |
| Attack / Defense | Physical damage and resistance, as in the series. |
| Sp. Atk / Sp. Def | Special damage and resistance. |
| **Speed** | **Movement speed and cooldown rate.** `moveSpeed = 3.2 * (1 + (Spe - 100) / 400)` tiles/sec, clamped 1.8-6.0. `cooldownRate = 1 + (Spe - 100) / 500`. |

Speed mattering twice is deliberate: it makes fast frail Pokemon genuinely playable as a dodge build, and slow tanks feel like slow tanks. It is also the single best translation of a turn-based stat into real time.

**PP is replaced by cooldowns.** Stating this plainly because it is a real departure from the source. PP exists to ration resources across a long dungeon in a turn-based game; in real time it produces dead stretches where the player has no buttons. Cooldowns give the same rationing per fight without the empty walking. Elixirs survive as cooldown-reset consumables, and **Stamina** (a 3-pip dodge meter, refills in 2s) carries the resource-management load instead.

### 4.5 Status conditions

All real-time, all with clear sprite tells.

- **Burn** -- DoT, halves physical damage dealt
- **Poison / Toxic** -- DoT, Toxic ramps
- **Paralysis** -- Speed cut 50% (slower *and* longer cooldowns -- brutal, as it should be)
- **Sleep** -- stunned until hit or 3s
- **Freeze** -- stunned 1.5s, breaks early on Fire damage
- **Confusion** -- inverted movement controls for 2s (the most hated and most memorable effect in the game)
- **Flinch** -- 0.2s stun on heavy hits

### 4.6 Abilities

One passive ability per species, from the series, chosen at the top of a short tree. `Blaze`, `Torrent`, `Static`, `Intimidate`, `Levitate` all work unchanged in real time. Later evolutions unlock a second slot.

### 4.7 Enemies

Five AI archetypes, assigned per species, reskinned endlessly:

| Archetype | Behaviour | Example |
|---|---|---|
| Chaser | Walks at you, melee arc | Rattata, Zubat |
| Ranged | Keeps distance, lobs or shoots | Bellsprout, Staryu |
| Charger | Telegraphs, then dashes in a line | Tauros, Rhyhorn |
| Swarm | Weak, many, flanks | Weedle, Spearow |
| Caster | Buffs allies, places zones, summons | Gastly, Jynx |

Bosses are archetypes with phases, a second move set, and an arena hazard. **Design rule for bosses: each has one obvious type answer and one skill answer.** Over-levelled brute force should always be possible but never the fast route.

---

## 5. Dungeons

### 5.1 Generation

Room-and-corridor graph assembled from **hand-authored room templates**. Not pure noise generation -- templates mean every room reads as designed, and a solo dev can add variety by adding a template, which is cheap.

- 6-10 rooms per floor, one entrance, one stairway
- Corridors are wide enough to dodge in (4+ tiles) -- a corridor you cannot dodge in breaks pillar 3
- Enemy budget per floor scales with depth; species pulled from the biome's table
- 0-2 special rooms per floor

### 5.2 Special rooms (all direct Mystery Dungeon nods)

- **Monster House** -- door shuts, 12 enemies, big reward. The game's spike of panic.
- **Kecleon Shop** -- buy and sell mid-run. Stealing is possible and he is level 60.
- **Kangaskhan Stash** -- bank items mid-run without leaving. The anti-greed valve.
- **Treasure vault** -- locked, needs a key dropped elsewhere on the floor
- **Mystery Room** -- rotating oddity: a gauntlet, a puzzle, a friendly NPC, a trap floor

### 5.3 Traps and hazards

Pressure-plate traps (spikes, summon, warp, type-field), lava and water tiles that interact with typing (Fire Pokemon walk on lava and take no damage -- typing should change *traversal*, not just damage), destructible rocks, and weather per floor that modifies damage.

### 5.4 Biomes (v1.0 plus roadmap)

| Biome | Floors | Types favoured | Boss | Ships in |
|---|---|---|---|---|
| **Verdant Hollow** | 1-5 | Grass, Bug, Poison | Vileplume | v1.0 |
| **Thunder Quarry** | 6-10 | Electric, Rock, Steel | Magneton | v1.1 |
| **Frozen Reach** | 11-15 | Ice, Water, Flying | Articuno-class | v1.2 |
| **Ember Depths** | 16-20 | Fire, Dragon, Ground | Charizard-class | v1.2 |
| **The Deepwild** | 21+ | Endless, mixed, scaling | Depth records | v1.3 |

---

## 6. Progression

Four progression systems, deliberately layered so there is always something ticking up.

### 6.1 Levels (your Pokemon)

Level 1 to 50, series-style XP curve. Stats from base stats plus level, as in the games. Levels never reset.

### 6.2 Evolution

The big one, and the emotional centre of the long game.

- Level-based evolution triggers normally (Charmander -> Charmeleon at 16)
- Evolution is **player-confirmed** at a hub shrine, and **reversible** before the stone is set -- some players will want to stay Pikachu, and the game should let them (Everstone exists)
- Evolving rescales your sprite, your stats and your move pool, and is accompanied by the full Game Boy evolution animation. Non-negotiable nostalgia beat.
- Stone evolutions use stones found as deep loot

### 6.3 Move mastery (the Torchlight skill tree)

Each move you own gains mastery from use. At mastery 3, 6 and 10 you pick an upgrade from two branches:

> **Ember** -- mastery 3: `[ Wider cone ]` or `[ +20% burn chance ]`
> mastery 6: `[ Pierces 2 enemies ]` or `[ Leaves a fire zone on impact ]`
> mastery 10: `[ Cooldown -40% ]` or `[ Becomes Flamethrower (beam shape) ]`

This is where build depth lives, and it is the direct answer to your "deep battling and improving abilities" answer. Respec is allowed at a hub NPC for money -- experimenting must be cheap, or players will not experiment, and experimenting is the fun.

### 6.4 Loot

Torchlight's loot grammar, named in Pokemon words.

**Slots:** Held Item, Scarf, Band, 2x Trinket.

**Rarity:** Common (white) -> Great (blue) -> Ultra (yellow) -> Master (purple) -> Shiny (red, unique, named). Rarity controls affix count, 1 to 5.

**Affixes** (roll ranges scale with dungeon depth):
- `+N% Fire damage` -- any of 18 types
- `+N% resistance to Water` -- any of 18 types
- `+N Speed` / `+N Attack` / flat stat rolls
- `+N% crit chance`, `+N% crit damage`
- `+N% status chance` / `-N% status duration taken`
- `On hit: N% chance to paralyse`
- `Berries heal +N%`
- `+1 Stamina pip` (rare, build-defining)
- `Immune to Burn` (Master tier)

**Consumables, straight from the series:** Oran Berry, Sitrus Berry, Lum Berry, Reviver Seed (the one that matters -- revives you once at 50% HP, the single most valuable item in the game), Blast Seed, Escape Orb, Luminous Orb, Elixir.

**TMs are loot.** Finding a TM for a move your species can learn is the best non-rarity drop in the game. It is also free design leverage: new content is one JSON row.

### 6.5 Meta progression (the hub)

**Pokemon Square** -- small, walkable, 6 buildings.

| Building | Function | Unlocked by |
|---|---|---|
| Stash | Persistent item storage, upgradeable size | Start |
| Shrine | Evolve, respec mastery | Level 10 |
| Kecleon's | Buy consumables and gear with banked money | Start |
| Gulpin Link Shop | Reroll one affix on an item | Depth 10 |
| Starter Grove | Switch species -- each is a separate save slot with its own level | Unlock species by meeting them in dungeons |
| Trial Gate | Fixed-seed daily and weekly challenge runs, with a local leaderboard | v1.1 |

**Unlocking species is the long-term collection hook** -- the one piece of "catching" that survives. Defeat a species often enough and it offers to join you in the Grove, becoming playable. That is the Pokedex, reframed to fit a game where you *are* the Pokemon.

### 6.6 Breeding (v1.2, explicitly not v1.0)

You listed breeding as something you love, so here is the honest plan: eggs drop as rare deep loot and hatch in the Grove into a new playable individual with an inherited **Nature** (a stat spread modifier, +10%/-10%) and one inherited **Egg Move** outside the normal learn pool. That gives real long-tail optimisation without a second game's worth of systems. It is scheduled after the core is proven, not before, because a breeding system on top of combat that is not yet fun is wasted work.

---

## 7. Player experience and controls

**Keyboard and mouse (primary):** WASD move, mouse aim, LMB / 1-4 moves, Space dodge, E interact, Tab map, I inventory, Q quick-use berry.
**Gamepad (v1.1):** left stick move, right stick aim, face and shoulder buttons for moves.
**Touch (v1.3, if ever):** twin virtual sticks. Browser-first means phones will find it; they should not be the design target.

**Accessibility:** remappable keys, a colourblind-safe type-icon set (never colour alone for type -- always the icon too), screen-shake and flash toggles, adjustable game speed 70-100% (a genuinely cheap and transformative accessibility feature in an action game), and hold-to-dodge rather than tap.

**UI** is Game Boy chunky: 2px white-on-black borders, DMG font, no transparency. HP as a classic segmented bar. Enemy type icons float above enemies, always. Damage numbers are optional (default on) and show effectiveness with the series text: `It's super effective!` in a one-line ticker.

---

## 8. Art, audio and the Game Boy constraint

### 8.1 Visual target

- **Internal resolution 240x160** (Game Boy Advance screen), integer-scaled to the browser window. Sub-pixel movement is allowed and rounded at draw time -- this is how we get free movement without the art looking wrong.
- **4-shade DMG palette** as default (`#0f380f #306230 #8bac0f #9bbc0f`), with unlockable palettes: GB Pocket grey, Super Game Boy, and a modern 32-colour mode. Palette swapping is a shader and costs nothing.
- **Sprites:** 24x24 for small Pokemon, 32x32 medium, 48x48 large, 64x64+ bosses. Four directions x 3 frames walk + 2 frames attack = 20 cells per species. One person can do that in a day.
- **Tiles:** 16x16, about 40 tiles per biome.

### 8.2 The art rule that keeps this project alive

Readability beats fidelity. In a 4-shade palette on a 240x160 screen with 12 things on screen, the player must still instantly tell their Pokemon from an enemy from a projectile from an item. Rules: player always has a 1px white outline; enemy telegraphs always use the lightest shade; items always pulse. If a sprite is cute but unreadable, the sprite is wrong.

### 8.3 Audio

Chiptune, written for the project -- **not** ripped from the games (see Section 11). 4-channel constraints for authenticity. 1 hub theme, 1 theme per biome, 1 boss theme, ~25 SFX. This is the cheapest thing to outsource to AI tools and the easiest to replace later.

---

## 9. Technical design

### 9.1 Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript, strict | Content is data; types catch data errors at build time |
| Engine | **Phaser 4** | Browser-native, batteries included (input, audio, tilemaps, physics, scaling), no build-your-own-engine detour |
| Build | Vite | Instant dev reload; a 5-hour week cannot afford slow iteration |
| Host | GitHub Pages or Cloudflare Pages, static | Free, zero ops, no server to maintain |
| Save | `localStorage` + JSON export/import | No accounts, no backend, no privacy surface. Export means saves survive. |
| Content | JSON (or TS-typed data modules) under `data/` | **The critical decision -- see 9.2** |
| Test | Vitest for systems; headless sim for balance | See 9.3 |

**No server in v1.0.** No accounts, no cloud saves, no PvP. Each of those triples the maintenance surface, and with under 5 hours a week maintenance is the enemy.

### 9.2 Data-driven everything

```
data/
  species.json     # id, name, types, baseStats, learnset, evolution, spriteKey, aiArchetype
  moves.json       # id, name, type, category, power, shape, cooldown, cast, effect
  typechart.json   # 18x18
  affixes.json     # id, stat, tiers, rollRanges, slotWhitelist
  items.json       # consumables, gear bases
  rooms/*.json     # room templates per biome
  biomes.json      # floor ranges, spawn tables, boss, weather, hazards
```

Everything is validated against a schema at build time. Two reasons this matters more than it looks:

1. **AI agents can author content safely.** "Add 20 Water moves following the schema" is a task an agent does well and cannot break the game with, because the schema and the balance sim both gate it.
2. **It makes the game portable off the IP.** Swap `species.json` and the sprite folder and DEEPWILD becomes an original-creature game with no engine work. Section 11 explains why you want that door open.

### 9.3 The balance simulator

A headless harness that runs the combat system without rendering: build a loadout, fight a floor, 10,000 times, overnight, and output win rate, time-to-kill, damage taken by type, and which affixes dominate. This replaces the QA team you do not have and directly serves the deep-battling thing you care about. It is roughly a weekend of work and it pays for itself by milestone 4.

### 9.4 Performance budget

Up to 40 active entities, 200 projectiles, 60fps on a 5-year-old laptop. Fixed timestep simulation at 60Hz with interpolated rendering -- determinism matters because it makes the sim in 9.3 trustworthy and makes fixed-seed Trial runs comparable. Spatial hash for collision. Object pools for projectiles.

### 9.5 Repository shape

```
src/
  core/        # fixed-step loop, ECS or entity registry, RNG (seeded), events
  combat/      # damage, typechart, status, cooldowns, move shapes
  dungeon/     # generator, templates, spawning
  entities/    # player, enemy AI archetypes, projectiles, pickups
  loot/        # affix rolling, rarity, drop tables
  progression/ # xp, evolution, mastery trees, save
  render/      # Phaser scenes, palette shader, GB UI kit
  hub/         # Pokemon Square scenes
  sim/         # headless balance harness
data/          # all content (9.2)
assets/        # sprites, tiles, audio
docs/          # this document and successors
```

---

## 10. Scope: what v1.0 actually contains

Sized honestly for one person at under 5 hours a week with AI help. **v1.0 is small on purpose.** It is a complete, satisfying, 2-3 hour game that proves the loop, not a content dump.

| Content | v1.0 | Full vision |
|---|---|---|
| Playable species | **4** (Charmander, Squirtle, Bulbasaur, Pikachu lines -- 12 forms with evolutions) | 30+ lines |
| Enemy species | **14** | 120+ |
| Moves | **45** | 200+ |
| Biomes | **1** (Verdant Hollow, 5 floors) + endless mode | 5 |
| Bosses | **2** (Floor 5 Vileplume, endless-depth rival) | 10+ |
| Room templates | **24** | 150+ |
| Affixes | **18** | 60+ |
| Consumables | **10** | 40+ |
| Hub buildings | **3** (Stash, Kecleon's, Starter Grove) | 6 |
| Audio | 3 tracks, 25 SFX | 12 tracks, 80 SFX |

**Cut from v1.0, and listed so the cuts are visible rather than quiet:** breeding, Trial Gate and leaderboards, gamepad, rescue codes, gummis and IQ skills, recruiting allies as AI companions, weather beyond one per biome, touch controls, any multiplayer.

---

## 11. The fan-game decision, stated once and honestly

You chose a free, non-commercial Pokemon fan game. That is a legitimate choice and I am designing to it. Three things follow, and then I will stop raising it.

1. **You can never sell this, and it can be taken down.** Nintendo, Game Freak and The Pokemon Company own the names, creatures, art and music. Takedowns of free fan projects happen, especially ones with an audience. Accept this as the price of the nostalgia you actually want.
2. **Reduce the surface anyway.** Do not distribute assets ripped from official ROMs -- draw Game Boy-*style* sprites instead. Do not use official music -- original chiptune only. No money anywhere near it: no Patreon, no ads, no donations, no crowdfunding, and no "Pokemon" in a domain name. A clean fan project with no revenue is a far less attractive target than a monetised one.
3. **Keep the exit door open, at zero cost.** Because of the data-driven design in 9.2, every system in this game -- the type chart, the move shapes, the loot grammar, the mastery trees -- is IP-free code. If you ever want to sell DEEPWILD, you replace `species.json`, `moves.json` names and the sprite folder. That is weeks of art, not a rewrite. **Build it as a fan game; just do not hardcode a single Pokemon name into the engine.**

---

## 12. Milestones

Sized in your hours. Assumes 4-5 hours a week, AI agents doing most of the typing, you making every design call.

| # | Milestone | What exists at the end | Your hours | Calendar |
|---|---|---|---|---|
| **M0** | Skeleton | Phaser + Vite + TS running, blank 240x160 scene, palette shader, fixed-step loop, seeded RNG | 8 | 2 weeks |
| **M1** | **Feel test** | One Pokemon, WASD, dodge, one Ember move, one Chaser enemy, damage, death. **The single question answered: is this fun to move and shoot in?** | 12 | 3 weeks |
| **M2** | Combat system | Full type chart, 4 move slots, 8 move shapes, status effects, 3 AI archetypes, 10 enemies, HP/stats from real base stats | 20 | 5 weeks |
| **M3** | Dungeon | Generator with 24 templates, 5 floors, stairs, traps, Monster House, Kecleon Shop, the greed prompt | 20 | 5 weeks |
| **M4** | Loot and progression | Drops, rarity, 18 affixes, 5 gear slots, XP, levelling, evolution, mastery trees, save/load | 25 | 6 weeks |
| **M5** | Hub and shape | Pokemon Square, 3 buildings, 4 playable species, species unlocking, Floor 5 boss, title and menus | 20 | 5 weeks |
| **M6** | **v1.0 polish** | Art pass, audio, balance sim run and tuning, juice, tutorial, 10 friends playtest, ship to Pages | 25 | 6 weeks |

**Total to v1.0: roughly 130 of your hours, about 8 months at this pace.** M1 lands in about five weeks, and M1 is the one that matters -- if the free-movement combat is not fun with one move and one enemy, no amount of content fixes it, and we change direction cheaply instead of expensively.

**Milestone rule:** after M1 and M3, you play it and we re-plan. The plan above is a direction, not a contract.

---

## 13. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Action combat is not fun** | Critical | M1 exists purely to find out, for 12 hours of work, before anything is built on top of it. |
| **Type chart breaks the action game** -- 4x weaknesses may be unfair when you cannot switch out | High | Mitigated by build-time coverage (TMs, affix resistances) and by the balance sim. If it still fails, the fix is capping incoming effectiveness at 2x in dungeons, not deleting the chart. |
| **Takedown** | High, uncontrollable | Section 11.2 reduces the surface; 11.3 means the design survives even if the Pokemon version does not. |
| **Scope creep** | High | Section 10 lists cuts explicitly. The rule: nothing joins v1.0 unless something leaves. |
| **Solo burnout at under 5 hours a week** | High | Milestones are 2-6 weeks each and each one ends in something playable. Never more than six weeks without a build you can show someone. |
| **Procedural layouts feel samey** | Medium | Hand-authored templates (5.1), and template count is the cheapest content lever we have. |
| **AI-generated content is bland or unbalanced** | Medium | Schema validation plus the balance sim. Agents fill in rows; you own the pillars and the numbers that matter. |
| **Browser performance** | Low | Budget in 9.4 is conservative for WebGL in 2026. |

---

## 14. Success criteria

Not sales -- this is a free fan game, and you said the goal is the game you have always wanted to play. So:

1. **You play your own game for 30 minutes without intending to test it.** The real bar.
2. M1 is fun with one move and one enemy.
3. A new player reaches Floor 5 in under 25 minutes without instructions.
4. Average run length 15-25 minutes; at least 40% of runs end in a *chosen* exit, not a faint (if nobody banks, the greed decision is not working).
5. No single affix or move appears in more than 60% of successful builds (per the balance sim).
6. 10 playtesters, 7 of whom start a second run unprompted.

---

## 15. Open questions (none of these block starting)

1. **Species roster for v1.0.** I picked the Kanto starters plus Pikachu as the safest nostalgia bet. If you want different ones -- or non-starters -- say so; it changes only data.
2. **Generation scope.** Gen 1 only (small, cleanest nostalgia) or all generations as a pool? I lean Gen 1 for v1.0 and open it later.
3. **Difficulty philosophy.** Hades-forgiving or Mystery Dungeon-cruel? I assumed in between, with the Reviver Seed as the safety valve.
4. **Title.** DEEPWILD is a placeholder. Fan games usually go `Pokemon <Something>`.
5. **How visible do you want this?** A private build for you and friends is far safer than a public release. That choice changes nothing about the code and everything about the risk in 11.1.

---

## 16. What happens on approval

On your approval I will cut this into the project backlog as issues, in dependency order: M0 scaffold first, then M1 as a tight set of combat tasks, with data-schema work parallelised to agents. You will get a playable M1 build to judge before a single line of dungeon generation is written.

If you want changes instead, reject the approval card with a note -- or just reply on GAM-2 in your own words -- and I will revise this document rather than argue for it.
