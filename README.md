# SiriusAdvStudio

SiriusAdvStudio 是面向《World Dai Star》的桌面 ADV 剧情编辑器。用分镜画布排场景、对话和分支，在属性栏修改角色、布景与音频，再用内嵌的 WDS Adv Player 检查效果。分镜、DSL 源码和 AI 改稿共用同一份剧本。

## 安装和启动

需要 Node.js、npm 和可运行 Electron 的桌面环境。初次拉取仓库后，在根目录执行：

```bash
npm ci
npm ci --prefix player
npm run dev
```

- `npm run dev` 构建预览播放器与 MCP 服务，再启动 Vite 和 Electron 开发窗口。
- `npm start` 完整构建后启动桌面应用。
- `npm test` 运行 DSL、项目索引、ZIP 打包和 AI 适配测试。

应用先打开独立的项目向导，不会自动加载主编辑器。选择「创建项目」并浏览到目标文件夹，或从最近项目列表或磁盘打开已有的 `.sav`。创建时可选择从示例剧本开始。为防止覆盖数据，文件夹中已有同名项目文件时会拒绝创建。

## 项目存放方式

```text
我的剧情/
├── project.sav        # JSON 项目索引，记录相对路径和已导入素材
├── story.dsl          # 可编辑剧本，包含场景、分支、台词和演出指令
├── assets/
│   ├── background/    # PNG、JPEG、WebP
│   ├── bgm/           # 背景音乐
│   ├── se/            # 音效
│   └── voice/         # Vocal / 配音
└── ai-cache/
    ├── history.json   # 项目对话历史，使用 AI 后生成
    └── workspace/     # 交给本机剧本助手的工作副本
```

在素材箱导入背景、BGM 或 SE，在分镜属性栏的 Vocal 区域导入并绑定配音。音频支持 MP3、OGG 和 WAV。导入会保留原文件格式并生成独立的素材 ID，原文件可以移走。迁移或备份时请复制整个项目文件夹，单独复制 `.sav` 不会带上剧本和素材。

原版 WDS 资源通过 Adv-Resource CDN 加载。离线时，本地项目和导入素材仍可用，未缓存的原版资源可能无法预览。已有的 `.story`、DSL 或 ADV JSON 可在创建项目后，通过工具栏的「项目」菜单导入。

## 编辑、预览和导出

- 工具栏可切换「可视化」和「源码」、保存、撤销、重做及导出。常用快捷键为 `Ctrl/Cmd+S` 保存、`Ctrl/Cmd+Z` 撤销、`Ctrl/Cmd+Shift+Z` 或 `Ctrl+Y` 重做。源码编辑、分镜操作和应用 AI 修改共用一份撤销记录。
- 点击分镜帧或使用上一帧、下一帧只定位，不触发 BGM、音效或语音。按播放从所选帧开始。暂停会停止当前演出与声音并留在该帧，再播放时从该帧开头继续。静音覆盖预览中的 BGM、音效、语音和视频，不影响素材箱单独试听。
- 「导出 ZIP」先检查当前路线帧数、脚本诊断和自定义素材引用。`episode.json` 是 WDS ADV 格式的**当前选中路线**，完整的分支保留在 `story.dsl` 中。
- ZIP 的 `manifest.json` 索引 `episode.json`、`story.dsl` 和每个本地素材。项目自定义图片、音乐、音效和配音均以原格式放进 `assets/`。AI 缓存、接口设置及原版 CDN 素材不会打包。

原版结构的 JSON 不含素材文件本身。含自定义素材的作品需要由读取 ZIP 索引的播放器或资源服务解析对应素材 ID，不能只把 `episode.json` 丢给仅支持官方 CDN 的播放器。

## AI 导演

在顶部「AI ▾」菜单显示对话区，或者打开「连接、模型与推理」「Skills」「MCP」设置。CLI 由当前系统环境检测，安装或登录后用「刷新本机 CLI 与模型」重新扫描。

| 接口 | 使用方式 |
| --- | --- |
| Codex CLI | 先让本机 `codex` 登录或完成配置。编辑器从本机 app-server 查询模型目录及推理档位，执行时使用 CLI 的 JSON 事件。若目录不可用，可使用 CLI 默认模型或手动填 ID。目录显示的模型不一定都对当前账号开放。 |
| Claude Code | 使用本机 `claude` 的认证与配置。支持默认模型、CLI 模型别名和手动模型 ID，以及该 CLI 支持的推理档位与会话续接。 |
| DeepSeek Harness | 安装并配置 `dsh` 的 `headless` profile。模型与认证由该 profile 管理，编辑器接收其 JSON 输出和会话 ID。 |
| DeepSeek API / OpenAI 兼容 API | 可选内置 DeepSeek API 助手，或填写兼容接口的 Base URL、模型与 Key。内置 DeepSeek API 也会读取 `DEEPSEEK_API_KEY`。 |

本机 CLI 另沿用已有的 Antigravity、Gemini CLI 和 OpenCode 入口。Skills 和 Studio MCP 提供剧本规范、读写与校验、资源查找等工具，实际支持会随所选接口变化。AI 使用项目下的工作副本，有成功修改后才同步到编辑器，正式剧本仍由「保存」写入磁盘。每个项目单独保存对话历史，接口设置放在本机应用数据目录，不随项目或作品包分享。

### 可选的本地剧情语料

语料索引不随仓库分发。已有本地 WDS 剧集 JSON 时，可以生成供 MCP 查询的索引：

```bash
SIRIUS_EPISODE_DIR=/path/to/episode node scripts/build-official-kb.mjs
```

索引默认写入 `data/official-story-kb.json`，也可通过 `SIRIUS_KB_PATH` 指定其他位置。未准备语料时，编辑、预览、打包和其他 AI 功能仍可使用。

## 代码入口

- `electron/` 管理桌面窗口、项目读写、打包、CLI 与 MCP。
- `src/App.vue` 连接编辑器、属性栏、素材箱和预览。`src/dsl/` 负责剧情图、编译及导入转换。
- `player/` 是基于 PixiJS 和 Spine 的 WDS 预览播放器。

感谢 MoeSekai Story Studio 的工作台设计启发，以及 WDS Adv Player 和 Adv-Resource 社区维护的播放器与资源体系。
