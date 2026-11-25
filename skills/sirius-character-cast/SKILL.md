---
name: sirius-character-cast
description: Character Spine IDs, @alias definitions, expressions, body motions, head motions, gaze directions, and multi-character stage blocking.
---

# Sirius Character Cast & Blocking Skill

## Verified Sirius Character Spine IDs
Each character has a distinct 3-digit prefix (`101xx` are ALL 心菜 costumes — NEVER use `10104` for 八惠!):
- `10101` (日常) / `10103` (制服) — 凤心菜 (心菜)
- `10201` (日常) / `10203` (制服) — 静香
- `10301` (日常) / `10303` (制服) — 卡特莉娜 (卡特莉娜·格里贝尔)
- `10401` (日常) / `10403` (制服) — 新妻八惠 (八惠)
- `10501` (日常) / `10503` (制服) — 柳场潘达 (潘达)
- `10601` (日常) — 流石知沙 (知沙)

For any other character or costume, ALWAYS call `study_character` or `search_resources` with `kind: "spines"` first!

## Character Directive Syntax
```story
@alias 心菜 10101
@char 1 心菜 pos=center size=m appear=fade expr=smile body=happy head=nod dir=normal
```

### Valid Enums
- `pos`: `outer_left`, `left`, `center`, `right`, `outer_right`
- `size`: `s`, `m`, `l`
- `appear`: `fade`, `left`, `right`, `bottom`
- `expr`: `normal`, `happy`, `smile`, `sad`, `angry`, `surprise`, `shy`, `close`, `close_happy`
- `body`: `normal`, `happy`, `angry`, `sad`, `amazement`, `shy`, `think`
- `head`: `nod`, `shake`, `nod2`, `shake2`
- `dir`: `normal`, `left`, `right`, `down`, `up`, `tilt_left`, `tilt_right`

## Stage Blocking Tips
- 1 character: `pos=center`.
- 2 characters: `slot 1` at `pos=left`, `slot 2` at `pos=right`.
- 3 characters: `outer_left`, `center`, `outer_right`.
- Use `@clear_chars` before CG stills (`@still <id>`) or empty-room narration beats.
