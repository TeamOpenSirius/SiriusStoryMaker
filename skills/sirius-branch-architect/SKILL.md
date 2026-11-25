---
name: sirius-branch-architect
description: Interactive branching story design using @scene blocks, @choice wires, converging routes, and readable StoryGraph coordinates.
---

# Sirius Branch Architect Skill

Design interactive branching visual novel episodes cleanly:

## Scene Graph Structure
```story
@scene intro title="排练前夕" x=60 y=140
@bg 1000 fade=cross
@char 1 心菜 pos=center expr=normal body=think
心菜: 接下来先练习哪一部分比较好呢？
@choice "先练习台词情感" -> route_acting
@choice "先顺一遍舞台走位" -> route_blocking

@scene route_acting title="台词特训" x=380 y=40
...
-> finale

@scene route_blocking title="走位排练" x=380 y=240
...
-> finale

@scene finale title="合排尾声" x=700 y=140
...
```

## Layout Rules
- Space columns ~320px apart on `x` and parallel branches ~180px apart on `y` so the visual Story Graph is immediately readable without overlapping nodes.
- Give every `@scene` a short ASCII `id` and a descriptive Chinese `title="..."`.
- Ensure every `@choice` target and `->` target points to a declared `@scene`.
