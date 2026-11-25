export const SAMPLE_DSL = `@title 星屑舞台的排练前夜
@chapter 第一章 · 排练室
@episode 1001
@alias 心菜 10101

@scene start title="排练室开场" x=40 y=40
@bg 1000 fade=cross camera=6
@char 1 心菜 pos=center expr=smile body=happy
心菜: 大家准备好了吗？今天要把新曲的走位全部顺一遍哦！
+ 哪怕还有一点紧张，只要站在舞台上就没问题！
-> flashback

@scene flashback title="回忆片段" x=400 y=40
@effect sepia
心菜(small): （回想起第一次站在 Sirius 剧场的那一天……）
-> ending

@scene ending title="回到现实" x=760 y=40
@effect none
@fade time 0.35 0.5 0.35
@char 1 心菜 pos=left appear=left expr=normal body=think
: 排练室的灯光缓缓亮起，新的一幕即将开始。
`

export function newStoryDsl(title: string) {
  return `@title ${title.replace(/[\r\n]+/g, ' ').trim() || '新建剧集'}\n@chapter 第一章\n@episode 1001\n\n@scene start title="开场" x=40 y=40\n: 从这里开始创作你的剧情。\n`
}
