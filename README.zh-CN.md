<div align="center">

<img src="public/sirius-logo.png" alt="SiriusStoryMaker Logo" width="128" />

# SiriusStoryMaker

**面向《World Dai Star（世界大明星）》的桌面端 ADV 剧情创作与播放工作台**

[English](README.md) | **简体中文**

[![License: MPL 2.0](https://img.shields.io/badge/License-MPL_2.0-ec4899.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-36-47848F.svg?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Vue 3](https://img.shields.io/badge/Vue-3.5-4FC08D.svg?logo=vuedotjs&logoColor=white)](https://vuejs.org/)
[![PixiJS & Spine](https://img.shields.io/badge/PixiJS%207-Spine%204.1-E72264.svg)](https://pixijs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

可视化分镜流编排 · 实时 Spine 4.1 舞台预览 · 独立作品播放器 · 原生 1080p MP4 视频导出 · 本地 AI 导演（CLI / API / MCP）

</div>

---

## 核心特性

- **NLE 四区可视化工作台**：左侧素材箱与剧情大纲、顶部 16:9 实时舞台预览、右侧帧与场景属性栏、底部全宽图形分镜画布，支持无缝切换 **可视化分镜** 与 **DSL 源码**，统一撤销/重做历史。
- **实时 Spine 4.1 舞台渲染**：内嵌深度定制的 WDS Adv Player，修改角色立绘、表情、动作、背景、特效或台词即改即看；支持长剧本索引跳帧、逐帧定位与试播。
- **独立项目管理与素材归档**：基于 `.sav` 索引文件管理剧本与本地自定义背景、BGM、SE、Vocal（支持 PNG/JPEG/WebP 与 MP3/OGG/WAV），底部内置「项目文件」Tab 集中查看引用状态与清理素材。
- **持久化缩略图缓存**：背景与 CG 自动落盘缓存，Spine 角色立绘支持离屏渲染与增量缓存更新；大视图素材选择弹窗支持分类筛选与无限滚动加载。
- **便携 ZIP 导出 & 独立播放器**：一键预检并导出包含 `episode.json`、`story.dsl`、`manifest.json` 及自定义素材的 `.zip` 作品包；启动向导内置独立播放器，可直接打开 `.zip` 或 `.json` 观看原生片头与自动播放。
- **原生 MP4 视频录制导出**：结合本机 FFmpeg，直接录制舞台画面与三路混音（BGM / SE / Vocal），输出 `1080p 30fps H.264/AAC` MP4 视频。
- **AI 导演（本地 Harness + API + Skills + MCP）**：支持接入本机 Codex CLI、Claude Code、DeepSeek Harness (`dsh`)、Antigravity CLI、Gemini CLI、OpenCode 及 DeepSeek / OpenAI 兼容 API，附带内置剧情规范 Skills 与 Studio MCP 工具服务。
- **多语言界面**：内置 **简体中文** 与 **English** 界面，可在项目向导顶栏或「设置 → 工作区与界面」中实时切换。

---

## 快速开始

### 环境要求

- **Node.js** 22.13+ 与 **npm**
- 支持运行 Electron 的桌面环境（Windows / macOS / Linux）
- *可选*：如需导出 MP4 视频，需安装包含 `libx264` 与 `AAC` 编码器的 **FFmpeg**（应用内「设置 → 项目与资源」提供检测与配置向导）

### 安装与运行

```bash
# 1. 安装主工程与播放器依赖
npm ci
npm ci --prefix player

# 2. 启动开发环境（自动构建播放器与 MCP 服务，再启动 Vite + Electron）
npm run dev
```

其他常用命令：

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 构建预览播放器与 MCP 服务，并启动开发窗口 |
| `npm run build` | 完整构建播放器、MCP 服务、渲染进程与 Electron 主进程 |
| `npm start` | 完整构建后启动桌面应用 |
| `npm test` | 运行 DSL 编译器、项目存储、ZIP 打包、视频导出、多语言与 AI 适配单元测试 |

---

## 项目结构与工作流

应用启动后首先进入独立的**项目向导**，可新建 `.sav` 项目、从最近项目列表打开，或直接点击 **「播放剧情作品」** 打开已有的 `.zip` / `.json`。

### 单个项目的目录结构

```text
我的剧情/
├── project.sav          # JSON 项目索引（记录相对路径与已导入的本地素材）
├── story.dsl            # 剧本源码（包含场景、分支、台词与演出指令）
├── assets/
│   ├── background/      # 自定义背景图（PNG / JPEG / WebP）
│   ├── bgm/             # 背景音乐（MP3 / OGG / WAV）
│   ├── se/              # 音效（MP3 / OGG / WAV）
│   └── voice/           # Vocal / 配音（MP3 / OGG / WAV）
└── ai-cache/
    ├── history.json     # 当前项目独立的 AI 对话历史
    └── workspace/       # 交给本机 AI Harness 的临时工作副本
```

> **提示**：迁移或备份项目时请复制整个项目文件夹；单独复制 `project.sav` 不会包含剧本与素材文件。已有的 `.story`、DSL 或 ADV JSON 可在进入项目后通过 **「文件 → 导入」** 载入。

### 编辑与预览要点

- **常用快捷键**：`Ctrl/Cmd+S` 保存、`Ctrl/Cmd+Z` 撤销、`Ctrl/Cmd+Y` / `Ctrl/Cmd+Shift+Z` 重做、`Ctrl/Cmd+O` 返回项目向导、`Ctrl/Cmd+,` 打开设置、`Esc` 关闭弹窗。
- **场景音乐与单帧音效**：BGM 在「场景与分支」中设置（或直接拖入场景卡片），留空沿用上一场景，选择「停止音乐」对应 `bgm="stop"`；SE 与 Vocal 在单帧属性中绑定并随帧触发。
- **台词和旁白换行**：帧属性里直接按 Enter。在 DSL 里写 `心菜: 第一行\n第二行`，两行仍属于同一帧。旧写法 `/n` 也兼容。
- **角色动作沿用**：未改动作的旁白和台词帧沿用当前 Spine 动画，不会每帧重播。需要让同一动作再演一次时，可在对应帧的 `@char` 指令加 `replay=true`。
- **三路音频与静音**：在 **「设置 → 音频」** 统一调节 BGM / SE / Vocal 音量与预览静音；预览静音不影响素材箱试听与 MP4 导出音量。

### 导出 ZIP 与 MP4 视频

- **导出作品包（`.zip`）**：导出前自动预检当前路线帧数、语法诊断与自定义素材引用。`episode.json` 为 WDS ADV 格式的**当前选中路线**，完整分支保留在 `story.dsl` 中，所有本地导入素材按 `manifest.json` 索引随包导出（AI 缓存与接口密钥不会打包）。
- **导出剧情视频（`.mp4`）**：通过 **「文件 → 导出剧情视频（MP4）」** 录制当前路线（含原生片头与三路音频），输出 1080p 30fps H.264/AAC MP4。若系统未检测到 FFmpeg，可在「设置 → 项目与资源」向导中指定可执行文件或从 [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds/releases) 获取。

---

## AI 导演（Harness / API / Skills / MCP）

通过顶部 **「AI」** 菜单可打开侧边对话栏，或进入「连接、模型与推理」「Skills 技能库」「MCP 工具服务」配置面板：

| 接入方式 | 说明 |
| --- | --- |
| **Codex CLI** | 使用本机已登录的 `codex`，自动查询可用模型与推理强度，支持流式 JSON 事件 |
| **Claude Code** | 复用本机 `claude` 认证与配置，支持默认模型、别名、手动模型 ID 与会话续接 |
| **DeepSeek Harness (`dsh`)** | 使用本机 `dsh` 的 `headless` profile，由其管理认证与模型 |
| **Antigravity / Gemini / OpenCode** | 自动检测本机已安装的 `agy` / `gemini` / `opencode` CLI |
| **DeepSeek / OpenAI 兼容 API** | 内置 DeepSeek API 直连（支持读取 `DEEPSEEK_API_KEY`）及任意 OpenAI 兼容接口配置 |

AI 改动均在项目 `ai-cache/workspace/` 副本上进行，确认成功后才同步回编辑器并进入统一撤销栈，正式文件仍由手动保存落盘；API Key 与接口设置仅保存在本机应用数据目录，不随项目分享。

### 随应用分发的原作剧情知识库

应用随附只读 SQLite 库，收录 2,470 集中文 WDS ADV 剧情、105,469 帧、场景关系，以及原作背景、BGM、SE 的实际用法。不分发原始 JSON、图片或音频。启用 Studio MCP 后，AI 导演能查台词、场景演出、角色用例及素材使用证据。推荐只返回编辑器素材库中存在的 ID，并附集数和帧号。

`npm run build` 将数据库与来源声明放入 `dist-electron/knowledge/`。分发时保留这个目录。使用 ASAR 安装包时，须把 SQLite 放在真实文件系统中，作为解包资源或放在 `resources/knowledge/`。用户不需要原 JSON 目录。查询示例、构建和分发说明见[原作剧情知识库](docs/official-story-kb.md)。

---

## 仓库架构

```text
SiriusStoryMaker/
├── electron/         # Electron 主进程：窗口管理、项目读写、ZIP 打包、FFmpeg 视频导出、缩略图缓存、AI CLI & MCP
├── src/              # Vue 3 + TypeScript 渲染进程：NLE 工作台、分镜画布、属性栏、素材库、AI 面板、DSL 编译器、多语言
├── player/           # 内嵌 PixiJS 7 + Spine 4.1 舞台播放器与离屏缩略图渲染器
├── skills/           # 内置 AI 剧情创作 Skills（DSL 规范、导演分镜、角色卡、分支架构、语料检索）
├── scripts/          # 辅助工具脚本（本地语料库索引构建等）
└── docs/             # 技术评估与设计文档（如性能与 Tauri 评估）
```

> 长剧本跳帧优化、渲染性能、构建体积及运行时迁移分析详见 [性能与 Tauri 评估](docs/performance-and-tauri.md)。

---

## 致谢

- [**Cpk0521/WDS_Adv_Player**](https://github.com/Cpk0521/WDS_Adv_Player) — 提供 World Dai Star 剧情渲染引擎与播放器核心基础
- [**StarMoe-org/moesekai-story-studio**](https://github.com/StarMoe-org/moesekai-story-studio) — 提供 NLE 剧情工作台与可视化分镜编排设计启发
- **Adv-Resource 社区** — 维护《World Dai Star》公开剧情资源体系

---

## 开源协议与免责声明

本项目基于 [Mozilla Public License Version 2.0 (MPL-2.0)](LICENSE) 开源。

> 本项目为爱好者开发的非官方二次创作工具，与《ワールドダイスター 夢のステラリウム（World Dai Star）》官方及版权方无任何关联。游戏中所有角色、立绘、背景、音乐与剧情版权均归原权利人所有。
