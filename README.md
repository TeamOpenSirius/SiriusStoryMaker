# SiriusAdvStudio

独立桌面剧情编辑器与实时舞台预览客户端（Electron + Vue 3 + CodeMirror 6 + 原版 `wds-player`），支持极简剧本 DSL 与本地 AI Harness（Claude Code / OpenAI Codex）交互式共创。

## 功能概览

- **四栏式工作台**：
  1. **左侧边栏**：大纲帧双向高亮跳转、DSL 速插模板、内置 `Adv-Resource` 资源库浏览（背景缩略图、BGM/SE 试听、Spine 角色弹窗预览、本地自定义背景图与 BGM/SE 导入）。
  2. **剧本编辑器与节点图**：
     - **DSL 编辑器**：基于 CodeMirror 6，支持语法着色、上下文自动补全（`@` 指令、`expr=`/`body=`/`pos=`/`lip=` 等枚举、资源库 ID 与 `@alias`）、报错点击跳转、草稿自动保存，以及实时 `JSON 预览` 与一键复制。
     - **节点图（Story Graph）**：支持 `@scene` 场景块拖拽布局、贝塞尔曲线连线（`->` 线性跳转与 `@choice` 多分支）、可视化分支编辑器、点击节点联动舞台预览，以及舞台上方分支路线实时试玩。
  3. **AI 剧情导演**：自动扫描系统已安装的 `claude`、`codex`、`gemini`、`opencode` CLI，支持多轮流式对话，自动注入 `AGENTS.md` / `CLAUDE.md` 规范与真实资源 ID，盘中实时同步 AI 对 `.story` 文件的修改，并支持一键修复报错。
  4. **实时舞台预览**：内嵌原版 PixiJS + Spine 4.1 `wds-player`（`?mode=live`），400ms 防抖推送 `IEpisodeModel` JSON 并保持当前帧位置。
- **双向导入导出**：支持打开/保存 `.story`（`Ctrl+O` / `Ctrl+S`）、导出标准 `IEpisodeModel` `.json`（兼容 SiriusNet），以及将现有 `.json` 反编译还原为去重可读的 `.story` DSL。

## 极简剧本 DSL 速查

```text
@title 剧集标题
@chapter 章节名称
@episode 1001
@alias 心菜 10101

@scene start title="排练室开场" x=60 y=90
@bg 1000 fade=cross camera=6
@bgm bgm_001
@char 1 心菜 pos=center expr=smile body=happy head=nod dir=normal lip=happy
心菜: 大家准备好了吗？
+ 接着上一句继续说。
-> flashback

@scene flashback title="回忆片段" x=360 y=90
@effect sepia
心菜(small): （内心独白……）
@choice "回到现实" -> ending
@choice "继续回忆" -> start

@scene ending title="回到现实" x=660 y=90
@effect none
@clear_chars
: 旁白描述。
```

## 开发与运行

```bash
npm install
cd player && npm install && cd ..
npm test
npm run build
npx electron .
```
