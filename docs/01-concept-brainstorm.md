# Pokémon-Theme Game Brainstorm — Six Directions

**Project:** Pokemon (repo `lmonteco/pokemon-game`)
**Date:** 2026-10-11
**Author:** CEO
**Status:** INPUT MATERIAL, not a decision. This is the option space for you to react to.
The GDD is **not** written yet — it waits for your answers in §4.

> **Note on process.** You asked how a brainstorm could happen without you. It cannot. This document
> is only the half of the work I can do alone: map the space, cost each option, and say what I would
> lean toward and why. The choosing is yours. Section 4 holds the questions I need answered; nothing
> below is settled until you answer them.

---

## 0. Read this first: the IP question

Pokémon is owned by Nintendo, Game Freak and The Pokémon Company. You cannot sell a game that uses
Pokémon names, creatures, art or music. Nintendo also takes down free fan games.

So there are two legal paths:

| Path | What you get | What you give up |
|---|---|---|
| **A. Fan game** (free, non-commercial) | Real Pokémon creatures and nostalgia. Fast audience. | No revenue. Takedown risk at any time. Cannot build a studio on it. |
| **B. Original creature IP** (recommended) | The *feel* of Pokémon — collect, train, battle, evolve — with your own creatures and world. Sellable. Safe. | You must design and draw your own monsters. No instant nostalgia. |

Every concept below is written for **Path B**: a "creature collector" in the Pokémon tradition, with your
own IP. Cassette Beasts, Palworld, Coromon, Monster Sanctuary and TemTem all did this and all made money.
If you actually want Path A, tell me and I will rewrite the GDD as a fan project.

---

## 1. The six concepts

### Concept 1 — "Run-Based Gym Gauntlet" (roguelite creature battler) ⭐ RECOMMENDED
A 40-minute run. You start with one creature, catch more as you go, fight up a ladder of boss "gyms",
and die. Then you start again with new unlocks. Type chart and team building are the depth; the map,
the items and the enemy teams are generated each run.

- **Comparables:** Slay the Spire × Pokémon; Backpack Battles; Monster Train; Dicey Dungeons
- **Why it fits you:** systems-heavy, content-light. No 40-hour world to build. A 40-minute run is a
  complete product. Replay value comes from randomness, not from art budget.
- **Scope:** ~48 creatures, ~120 moves, ~60 items, 12 bosses for a full v1.0.
- **Risk:** low. The genre is proven and the failure mode (bad balance) is fixable with data.

### Concept 2 — Classic Monster-Taming RPG
The real thing: an overworld, 8 towns, a rival, a villain team, 150 creatures, 30 hours.

- **Comparables:** Coromon, Nexomon, Pokémon itself
- **Why it is tempting:** it is what people actually want when they say "a Pokémon game".
- **Scope:** brutal. 150 creature designs × 4 sprites each, 30 hours of maps, a full script, a full
  balance pass. This is a 3-to-5 year project for a small team.
- **Risk:** high. The most common way a creature-collector dies is running out of money in year two
  with half an overworld built.

### Concept 3 — Monster Tactics (grid strategy)
Fire Emblem or Into the Breach, but the units are creatures you catch, breed and evolve. Battles on an
8×8 grid, terrain matters, positioning matters more than stats.

- **Comparables:** Into the Breach, Fire Emblem, Wargroove, Siralim
- **Strength:** tactics players are loyal, pay full price, and tolerate simple art.
- **Scope:** medium-high. Grid AI is the hard part and it is genuinely hard.
- **Risk:** medium. Market is smaller but less crowded.

### Concept 4 — Creature Ranch / Life Sim
Stardew Valley with monsters. You run a sanctuary: feed, breed, decorate habitats, enter contests,
sell offspring. Battling exists but is secondary.

- **Comparables:** Stardew Valley, Monster Rancher, Ooblets, Slime Rancher
- **Strength:** very strong on Switch and mobile. The cosiest corner of the market and still hungry.
- **Scope:** medium. Breeding genetics and habitat systems are cheap to code; art and animation are not.
- **Risk:** medium. Lives and dies on art charm, which is the expensive thing.

### Concept 5 — Battle Simulator / Competitive-First
Skip the single-player game. Build the thing competitive Pokémon players actually use: team builder,
damage calculator, ranked ladder, replays, draft formats. Free to play, cosmetics only.

- **Comparables:** Pokémon Showdown, Hearthstone, Teamfight Tactics
- **Strength:** no art budget, no world, no story. Pure systems — the cheapest thing to build well.
- **Scope:** low on content, high on live ops. Netcode, anti-cheat, matchmaking, seasons, balance patches forever.
- **Risk:** high, but not technical — it is a cold-start problem. A ladder with 40 players is a dead game.

### Concept 6 — Narrative Mystery in a Creature World
A detective adventure. No grinding. Your partner creature's abilities are puzzle tools. 6–8 hours,
hand-written, strong characters, choices that stick.

- **Comparables:** Detective Pikachu, Disco Elysium (tone), Pentiment, Return of the Obra Dinn
- **Strength:** reviewers and streamers love these. Writing is the main cost and writing scales well with AI help.
- **Scope:** medium. No balance work at all. But every hour of content is bespoke — zero replay value.
- **Risk:** medium. One-and-done sales curve. No long tail.

---

## 2. Scoring

5 = best. Weighted for a small team shipping its first title.

| Concept | Build cost (5=cheap) | Replay value | Original | Market pull | Risk (5=safe) | **Total** |
|---|---|---|---|---|---|---|
| **1. Roguelite gauntlet** | 4 | **5** | 4 | 4 | **5** | **22** |
| 2. Classic RPG | 1 | 3 | 2 | **5** | 1 | 12 |
| 3. Monster tactics | 3 | 4 | 4 | 3 | 3 | 17 |
| 4. Ranch / life sim | 3 | 4 | 3 | 4 | 3 | 17 |
| 5. Battle simulator | **5** | **5** | 2 | 2 | 2 | 16 |
| 6. Narrative mystery | 3 | 1 | **5** | 3 | 3 | 15 |

---

## 3. My lean (a proposal, not a decision)

The scoring above is weighted for *a small team shipping its first title*. That weighting is an
assumption about you, not a fact about you. If your real goal is "the game I always wanted to play"
rather than "the game most likely to ship", the table flips and Concept 2 wins. Tell me which goal
is yours — it is question 1 in §4.

Under the shipping-first weighting, I would build **Concept 1: the run-based gym gauntlet**.
Working title **WILDGLASS**.

Three reasons:

1. **A 40-minute run is a shippable product.** You can have a fun, complete, sellable loop in three
   months. Concept 2 needs three years before anyone can tell whether it is fun.
2. **The cost is in rules, not in art.** 48 creatures is a reachable art target. 150 is not. And rules
   are the part of game development that is cheapest to iterate on and easiest to automate — you can
   simulate ten thousand battles overnight to tune balance.
3. **It keeps every other door open.** The creature roster, type chart, move system, art style and
   engine built for Concept 1 are exactly the foundation Concept 2, 3 or 5 need later. Build the
   roguelite first, and the classic RPG becomes a sequel using assets you already own, not a
   from-scratch gamble.

**The hybrid to keep in mind:** Concept 1 + a thin version of Concept 4 as the hub. Between runs you
return to a sanctuary where creatures you rescued live permanently. That gives the cosy progression of
a ranch sim for a fraction of the cost, and it is the single best place to spend extra scope if things
go well. It is listed in the GDD as a post-launch option, not as v1.0.

**What I did not pick and why:** Concept 5 is the cheapest to build and the hardest to launch — a
competitive ladder with no players is worthless, and you have no audience yet. Concept 6 is the most
original but sells once and never again. Concept 2 is what the market wants most and is the one most
likely to bankrupt you.

---

## 4. What I need from you

These are posted as a question card on GAM-2. Answer there and the GDD gets written to your answers,
not to my guesses.

1. **Your goal** — ship something small and real, or build the game you have always wanted to play,
   even if it takes years?
2. **Your taste** — which part of a Pokémon game do you actually love? The collecting? The team
   building and type puzzles? Exploring a region? The story and characters? The competitive battling?
3. **Concept** — one of the six above, a mix of two, or something none of them captured?
4. **IP** — original creatures (Path B), or a Pokémon fan game (Path A)?
5. **Platform** — browser, Steam, mobile, or console?
6. **Team and time** — you plus AI agents, or paid human artists and a composer? How many hours a
   week, and is there a date you want to hit?
7. **Your own ideas** — anything you had in mind before you read this. That answer outranks
   everything above.

Nothing proceeds to the GDD until these are answered.
