---
name: sirius-dsl-author
description: Core WDS Adv Player minimalist DSL authoring rules, syntax validation, dialogue pacing, and scene integrity for SiriusStoryMaker.
---

# Sirius DSL Authoring Skill

When writing or editing `current.story` for WDS Adv Player:

## Metadata & Structure
- Start with `@title <text>`, `@chapter <text>`, `@episode <numeric_id>`, and `@alias <Name> <spine_id>`.
- Group narrative beats into `@scene <id> title="<Name>" x=<n> y=<n>` blocks so the Story Graph stays clean.
- Connect scenes with `-> <target_id>` or `@choice "<label>" -> <target_id>`. Never leave dangling scene IDs.

## Dialogue Conventions
- `Speaker: Dialogue` — Standard line (middle font).
- `Speaker(small): ...` — Inner monologue / whispered thought.
- `Speaker(large): ...` — Shouting / dramatic emphasis.
- `+ Continuation line` — Same `GroupOrder` continuation (auto-advances smoothly without clearing speaker).
- `: Narration` — Narration without speaker nameplate.

## Validation Discipline
- Always call `validate_story` (or check diagnostics) after editing `current.story` to ensure 0 syntax errors and 0 unknown resource IDs.
- Keep dialogue natural, vivid, and consistent with the user's language (Chinese by default).
