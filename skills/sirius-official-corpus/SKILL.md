---
name: sirius-official-corpus
description: Search and study an optional local World Dai Star (WDS) Chinese story knowledge base to learn authentic character voices, verified Spine IDs, expression/body motion habits, backgrounds, BGMs, SEs, and dramatic pacing before authoring stories.
---

# Sirius Official Story Corpus Skill

SiriusAdvStudio can query a locally generated index of WDS episode JSON files. If the corpus is not installed, use the resource catalog and the script in the current project instead.

**Golden Rule**: Before drafting a new episode or writing dialogue for an established character, study their authentic speech patterns, verified Spine IDs, and official scene staging!

## Preferred Method — MCP Tools
When the `sirius-adv-studio` MCP server is enabled, call these tools directly:
1. `study_character({ name: "心菜" })` — Returns verified Spine IDs (with usage frequency), top expression/body motion IDs, and authentic Chinese dialogue quotes.
2. `search_official_episodes({ query: "排练", speaker: "心菜", limit: 8 })` — Searches indexed episodes by keyword, chapter, title, or speaker.
3. `inspect_official_episode({ episodeId: 1010101, startLine: 1, limit: 25 })` — Reads real official episode staging (BG, BGM, SE, Spine/expr/body, Speaker, Phrase) to learn pacing and direction.

## CLI Fallback (Zero Dependencies)
If MCP tools are unavailable, run the bundled query CLI:
```bash
node scripts/query-corpus.mjs character 心菜
node scripts/query-corpus.mjs search 舞台 --speaker 静香 --limit 6
node scripts/query-corpus.mjs inspect 1010101 --start 1 --limit 25
```

## Authoring Checklist Using Official Precedents
- Match each character's authentic tone, catchphrases, and relationships from `study_character` samples.
- Use real `BackgroundImageFileName`, `BgmFileName`, and `SeFileName` IDs observed in official episodes with similar mood/location.
- Keep dialogue concise (1–2 sentences per beat) and alternate speaker expressions/body motions naturally like official episodes.
