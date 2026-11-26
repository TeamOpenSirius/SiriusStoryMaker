# 原作剧情知识库

SiriusStoryMaker 随附一份只读 SQLite 数据库，收录 TeamOpenSirius 中文 WDS ADV 剧情导出中的 **2,470 集、5,543 个场景段、105,469 帧**。库内有 266 个背景、63 首 BGM、155 个 SE 的使用记录，其中 141 个 SE 才在当前素材目录中。数据库约 23.5 MB，不包含原始剧集 JSON、图片、音频、AI 配置或项目数据。来源和许可证保留在同目录的 NOTICE。

## 导演怎么查

| 工具 | 用法 |
|---|---|
| `search_official_episodes` | 按台词、标题、章节、说话人找相关集，返回场景 ID |
| `trace_official_scene` | 沿同一集的上一场、下一场查，或找共用了背景、BGM、SE 的其他场景 |
| `inspect_official_episode` | 按集号和帧范围读台词、角色站位和音画指令，也能看到从上文继承的背景和 BGM |
| `study_character` | 看少量台词例子和单人上场时的 Spine、表情与动作统计。这不是说话人与模型的严格身份映射 |
| `search_official_asset_usage` | 按关键词、背景或同场 BGM 找素材，附实用例的集号、场景和帧号。精确查找可以看到目录里没有的 ID，推荐不会给出这些 ID |

例如先查 `search_official_episodes({query:"排练室"})`，沿结果的 `sceneId` 查场景，再用 `search_official_asset_usage({kind:"se",query:"脚步"})` 找音效。SE 会优先返回有邻近台词证据的资源。BGM 和背景按场景用法统计。**这些是原作的使用证据，不是对音频内容的听辨或情绪标注。** Studio MCP 可直接调用这些工具。没有工具调用的 API 模式在设置启用相关功能时，会检索少量关键词用例并附给模型，不发送整库。

## 存储与发布

- 以同一集内实际切换背景的位置划分场景段，保留相邻场景与原集的上一集、下一集字段。一个场景段不等于官方正式章节或分支。
- 原始 BGM 指令与当前播放的 BGM 分列。留空时沿用，`999` 停乐。SE 按触发帧统计，背景和 BGM 则另有实际覆盖帧数。通过双向 Scene–Asset 索引可查同场、反向素材使用和相关场景，不需要载入整个语料。
- FTS5 trigram 加速三字以上的中文子串查找，短词与字面通配符退回精确子串查询。重复角色状态合并存储；构建时优化索引并压实数据库。
- `npm run build` 把数据库和 NOTICE 拷贝进 `dist-electron/knowledge/`，不会拷贝到渲染器的公开静态目录。打包应用时保留此目录；ASAR 发行物须把数据库解包或作为 `resources/knowledge/` 下的文件一同发布。SQLite 不能从 ASAR 虚拟路径直接读取。
- 开发或自建库用 Node.js 22.13+。内置 Electron 提供 SQLite；用外部 Node 启动 Studio MCP 时也需要 22.13+。

## 重建及本地验证

```bash
SIRIUS_EPISODE_DIR=/path/to/episode node scripts/build-official-kb.mjs
npm run build
node dist-electron/mcp-server.mjs --knowledge search_official_asset_usage '{"kind":"bgm","query":"排练","limit":2}'
```

构建器保证生成有效数据库后才覆盖原文件。构建和查询都接受 `SIRIUS_KB_PATH`，用于另存或使用自定义语料。运行查询不需要原始 JSON。源语料不随个人工程或作品 ZIP 导出。
