---
name: sirius-scene-director
description: Stage direction, camera zooms, background transitions, flashback filters, and BGM/SE audio pacing for WDS Adv Player.
---

# Sirius Scene Director Skill

Use cinematic ADV stagecraft to bring scripts to life:

## Backgrounds & Camera
- `@bg <id> fade=cross camera=<1..6>` — Crossfade background with optional camera motion.
- Use `search_resources` with `kind: "backgrounds"` to verify background IDs before inserting.
- Common starter backgrounds: `1000`, `1001`, `1010`, `1020`, `1030`.

## Transitions & Filters
- `@fade black 0.4 0.5 0.4` — Dramatic scene cut or passage of time.
- `@fade white 0.35 0.4 0.35` — Flashback entry, awakening, or stage spotlight.
- `@fade time 0.35 0.5 0.35` — Smooth time-lapse transition.
- `@effect sepia` — Persistent flashback tint (always pair with `@effect none` when returning to present).
- `@effect blur` — Dreamy / soft-focus white blur (clear with `@effect none`).

## Audio Pacing
- Set `bgm="<id>"` on the `@scene` header to establish the scene mood. Leave it blank to keep the previous track or set `bgm="stop"` for silence.
- `@se <id>` for footsteps, doors, applause, gasps, or impact accents.
- Always verify BGM/SE IDs via `search_resources` before using them.
