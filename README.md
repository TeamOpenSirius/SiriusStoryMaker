# SiriusAdvStudio

独立桌面剧情编辑器与实时舞台预览客户端（Electron + Vue 3 + CodeMirror 6 + 原版 `wds-player`），支持极简剧本 DSL 与本地 AI Harness（Claude Code / OpenAI Codex）交互式共创。

## 功能概览

- **四栏式工作台**：
  1. **左侧边栏**：大纲帧跳转、DSL 快捷模板插入、内置 `Adv-Resource` 资源库浏览与缩略图预览。
  2. **剧本编辑器**：基于 CodeMirror 6，支持 DSL 语法着色、行号诊断、光标联动舞台跳转。
  3. **AI 剧情导演**：自动扫描系统已安装的 `claude`、`codex`、`gemini`、`opencode` CLI，支持多轮流式对话，自动注入 `AGENTS.md` / `CLAUDE.md` 规范与真实资源 ID，实时同步 AI 对 `.story` 文件的修改。
  4. **实时舞台预览**：内嵌原版 PixiJS + Spine 4.1 `wds-player`（`?mode=live`），毫秒级接收编译后的 `IEpisodeModel` JSON。
- **双向导入导出**：支持打开/保存 `.story`、导出标准 `IEpisodeModel` `.json`（兼容 SiriusNet），以及将现有 `.json` 反编译回 `.story` DSL。

## 极简剧本 DSL 速查

```text
@title 剧集标题
@chapter 章节名称
@episode 1001

@bg 1000 fade=cross camera=6
@bgm bgm_001
@alias 心菜 10101
@char 1 心菜 pos=center expr=smile body=happy
心菜: 大家准备好了吗？
+ 接着上一句继续说。
@effect sepia
心菜(small): （内心独白……）
@effect none
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
