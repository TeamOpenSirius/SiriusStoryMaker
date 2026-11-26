@dsl 1
@title 开演前十分钟
@chapter SiriusStoryMaker 新手引导
@episode 1001
@alias 心菜 10101
@alias 静香 10201

@scene start title="0 · 先看成果｜灯还亮着" x=48 y=48 bgm="13"
@bg 410 fade=black
: 排练已经结束。空舞台上，还留着一盏灯。
@char 2 静香 pos=right size=m appear=fade expr=100 body=think head=0 dir=down
静香: 灯还亮着。
@se 31
: 门外响起脚步声。
@char 2 静香 pos=right size=m expr=111 body=amazement head=0 dir=left
: 静香循声抬起头。
@voice 10101020260
@char 1 心菜 pos=left size=m appear=left expr=105 body=shy head=0 dir=down
心菜: 嗯……。
@char 1 心菜 pos=left size=m expr=103 body=happy head=nod dir=right
@char 2 静香 pos=right size=m expr=100 body=think head=0 dir=left
心菜: 我还想再试一次。
@char 1 心菜 pos=left size=m expr=202 body=normal head=0 dir=right
@char 2 静香 pos=right size=m expr=202 body=normal head=0 dir=left
: 刚才看到的，就是你接下来要排的戏。把时间拨回十分钟前。
-> desk

@scene desk title="1 · 领一张工作台｜十分钟前" x=400 y=48 bgm="103"
@fade time 0.35 0.5 0.35
@bg 370 fade=cross
@clear_chars
: 你第一次来排练室。/n桌上有一张空白分镜，右上角写着「离走台还有十分钟」。
@char 2 静香 pos=right size=m appear=fade expr=100 body=think head=0 dir=left
静香: 心菜说练完就走。可她每回走到门口，都要再看一眼那盏灯。
@char 1 心菜 pos=left size=m appear=left expr=114 body=shy head=0 dir=right
@char 2 静香 pos=right size=m expr=202 body=normal head=0 dir=left
心菜: 有那么明显吗……？那，今晚最后一小段，能请你来排吗？
@char 1 心菜 pos=left size=m expr=103 body=normal head=0 dir=right
: 【上手】在启动器新建空白或示例项目。/n也可以打开 project.sav，或从最近项目继续。/n已有剧本？进项目后可导入 ADV JSON、DSL 或 .story。
: 【认认工作台】素材箱找道具，大纲找场次。/n舞台预览看效果，分镜图看场次怎么接。/n选中一帧或一场，就能改对应的属性。
: 【先存一次】保存后再开工。/n备份时复制整个项目目录，让剧本和素材一起走。
-> draft

@scene draft title="2 · 让 AI 导演起稿｜说不出口的话" x=752 y=48
@char 1 心菜 pos=left size=m appear=fade expr=105 body=think head=0 dir=down
@char 2 静香 pos=right size=m appear=fade expr=100 body=normal head=0 dir=left
心菜: 如果我说还想留下，静香会不会也只好陪我留下？
@char 2 静香 pos=right size=m expr=105 body=think head=shake dir=left
@char 1 心菜 pos=left size=m expr=100 body=normal head=0 dir=right
静香: 我不想替你决定。倒是你，别连问都不问我。
@char 2 静香 pos=right size=m expr=100 body=normal head=0 dir=left
: 你把两句心里话记在分镜背面，交给 AI 导演。/n纸上很快多了一个场景、几句台词和两条出口。
: 【上手】点顶部「AI」，选已配置的本地 CLI 或 API。/n把下面这条指令发给导演。
: 「写一小段散场戏，空舞台上还有一盏灯。/n心菜想留下又怕耽误静香，静香想陪她却不替她决定。/n写出『再练一次』和『明天再来』两个走向，最后汇合。」
: 【先看初稿】播放下一场「第一遍和第二遍」。/n听听原句。心菜是在邀静香，还是只在数练了多久？
: 【试一次小改】请 AI 只替换这一句，其他不动。/n「我今天还没练够」改成「我还想再试一次」。/n先撤销，再重做播放。下一场留了原句供对照。
: 【进阶】第一次起稿只需一个能用的后端。/n模型、推理设置、Skills 和 MCP 可等需要时再调。
-> revise

@scene revise title="3 · 把戏排出来｜第一遍和第二遍" x=1104 y=48 bgm="9"
@bg 410 fade=cross
@char 1 心菜 pos=left size=m appear=fade expr=100 body=normal head=0 dir=right
@char 2 静香 pos=right size=m appear=fade expr=100 body=think head=0 dir=left
静香: 灯还亮着。
# 练习一：在编辑器里手改下面这句，不动第二遍。
@char 1 心菜 pos=left size=m expr=102 body=sad head=0 dir=down
心菜: 我今天还没练够。
@char 2 静香 pos=right size=m expr=105 body=think head=shake dir=tilt_left
静香: 够不够先放一边。你想让我做什么？
@char 2 静香 pos=right size=m expr=100 body=normal head=0 dir=left
@char 1 心菜 pos=left size=m expr=105 body=think head=0 dir=down
: 你没急着回答。你让心菜把手从门把上松开，再抬眼看静香。
@fade time 0.25 0.35 0.25
@bg 410 fade=cross camera=2
@char 2 静香 pos=right size=m expr=100 body=think head=0 dir=left
静香: 灯还亮着。
@char 1 心菜 pos=left size=m expr=70 body=shy head=0 dir=down
: 心菜的手离开门把。她吸了口气。
@char 1 心菜 pos=left size=m expr=103 body=happy head=0 dir=right
心菜: 我还想再试一次。
@char 2 静香 pos=right size=m expr=202 body=happy head=nod dir=left
@char 1 心菜 pos=left size=m expr=103 body=normal head=0 dir=right
静香: 这次我听清了。你是在问我，要不要跟你一起。
@char 2 静香 pos=right size=m expr=202 body=normal head=0 dir=left
: 【动手一】在第一遍的帧属性里亲手改掉原句。/n只改台词，再播两遍，比较有没有停顿和抬眼。
: 【排一遍】试加一场，再插入、删除或拖动一帧。/n选帧改站位、表情和动作，也可以试试换镜头。/n切到 DSL 源码看同一份戏，再切回分镜图。
: 【接两条线】在分镜上拖线设置顺序和分支。/n拆下「明天再来」的出口，再接回「走台」。/n用自动排布或适应画布看全图。快捷键可以边做边记。
: 台词已经到位。静香却还不知道，什么时候该朝门口看。
-> sound

@scene sound title="4 · 让观众听出来｜门外有人" x=1456 y=48 bgm="13"
@bg 410 fade=cross
@char 2 静香 pos=right expr=105 body=think size=m appear=fade layer=0 head=shake dir=down
静香: 我刚才转早了。人还没到，我就已经在看门口了。
@char 2 静香 pos=right expr=100 body=normal size=m appear=fade layer=0 head=0 dir=down
: 【动手二】选中接下来的「门外」旁白，加脚步 SE 31。/n先别动转头的那一帧。「再练一次」里有完成效果。
@char 2 静香 pos=right expr=100 body=think size=m appear=fade layer=0 head=0 dir=down
: 门外。静香低着头，把剧本翻到最后一页。
@char 2 静香 pos=right expr=111 body=amazement size=m appear=fade layer=0 head=0 dir=left
静香: 心菜？
@char 2 静香 pos=right expr=100 body=normal size=m appear=fade layer=0 head=0 dir=left
: 【找声音】在素材箱找背景、CG、角色和音频。/n在「项目文件」导入背景、BGM、SE 和 Vocal。/n这里也能查看引用、清理未使用的素材。
: 【听三路】先试听，再调 BGM、SE、Vocal 或静音。/nBGM 跟场景。留空会沿用，也可设为停乐。/n脚步 SE 和人声 Vocal 跟帧。
@se 300
: 门外传来敲门声。你拿起分镜，给这场戏留出两种结尾。
@choice "再练一次" -> again
@choice "明天再来" -> tomorrow

@scene again title="再练一次｜等脚步响完" x=1808 y=48
@bg 410 fade=cross
@clear_chars
@char 2 静香 pos=right size=m appear=fade expr=100 body=think head=0 dir=down
静香: 灯还亮着。
@se 31
: 门外响起脚步声。
@char 2 静香 pos=right size=m expr=111 body=amazement head=0 dir=left
: 静香抬头，朝门口看过去。
@voice 10101020260
@char 1 心菜 pos=left size=m appear=left expr=105 body=shy head=0 dir=down
@char 2 静香 pos=right size=m expr=100 body=normal head=0 dir=left
心菜: 嗯……。
@char 1 心菜 pos=left size=m expr=103 body=happy head=nod dir=right
心菜: 我还想再试一次。
@char 2 静香 pos=right size=m expr=202 body=happy head=nod dir=left
@char 1 心菜 pos=left size=m expr=202 body=normal head=0 dir=right
静香: 好。那这一遍，我等你开口。
-> rehearsal

@scene tomorrow title="明天再来｜把位置留着" x=1808 y=368
@bg 410 fade=cross
@clear_chars
@char 2 静香 pos=right size=m appear=fade expr=100 body=think head=0 dir=down
静香: 灯还亮着。
@se 31
: 门外响起脚步声。
@char 2 静香 pos=right size=m expr=111 body=amazement head=0 dir=left
: 静香抬头，朝门口看过去。
@char 1 心菜 pos=left size=m appear=left expr=105 body=think head=0 dir=tilt_right
@char 2 静香 pos=right size=m expr=100 body=normal head=0 dir=left
心菜: 我还想再试一次。不过……这次把它留给明天，可以吗？
@char 2 静香 pos=right size=m expr=202 body=happy head=nod dir=left
@char 1 心菜 pos=left size=m expr=103 body=happy head=0 dir=right
静香: 可以。把地上的站位贴留着吧。明天你还站这里。
-> rehearsal

@scene rehearsal title="5 · 走台一遍｜回到脚步响起时" x=2160 y=48
@bg 370 fade=cross
@clear_chars
: 你喊了停。两个人都朝你看过来。这回你知道该检查哪一帧了。
@char 2 静香 pos=right size=m appear=fade expr=100 body=think head=0 dir=tilt_left
静香: 从脚步响起的地方再来。/n我想确认一下，刚才有没有抢在声音前面。
@char 2 静香 pos=right size=m expr=100 body=normal head=0 dir=left
: 【走台】选好路线，从所选场景播放。/n暂停后用上一帧、下一帧定位脚步和转头。/n再切另一条路线，从头走一遍。
: 【听衔接】在播放中跳转，预览会继续播。/n跳回使用同一首 BGM 的条目，音乐不会从头响。
: 【进阶】熟悉工作台后，再试语言切换和面板显隐。/n也可以重置布局、维护缩略图。
@char 2 静香 pos=right size=m expr=202 body=happy head=nod dir=left
: 你再看一遍。脚步先响，然后才是静香抬头。/n那一拍终于对了。
-> delivery

@scene delivery title="6 · 把作品交出去｜留一份给同伴" x=2512 y=48 bgm="8"
@fade black 0.35 0.4 0.35
@bg 410 fade=cross
@clear_chars
: 谢幕曲响起。你把排好的分镜交给心菜。
@char 1 心菜 pos=center size=m appear=fade expr=200 body=happy head=nod dir=normal
心菜: 谢谢。下次我走到门口，就知道该怎么问了。
@char 1 心菜 pos=center size=m expr=202 body=normal head=0 dir=normal
: 【交作品】先预检，再选好路线导出 ZIP。/n在启动器用「播放剧情作品」打开，先看片头。/n试试点击推进、Auto 和播完重播。
: 【交视频】去 MP4 导出界面，按提示配置 FFmpeg。/n再导出一段能分享的视频。预览静音不影响成片。
: 【留两份】ZIP 只播放所选路线，story.dsl 保留分支。/n要动手，请打开完整项目。/nCDN 素材不进 ZIP。离线请用有权分发的本地素材。
@clear_chars
@se 71
: 回放传来谢幕的掌声。
: 你最后看了一眼台口。这一次，轮到你关灯了。
