# SiriusStoryMaker 性能与 Tauri 评估

## 已落地

- 播放中跳到目标帧时按目标帧解析 BGM。同一首音乐已经在播就保留当前音轨和进度。目标不同才换曲，停乐仍生效。SE 和 Vocal 仍跟随帧。
- 编辑器预览保留 1920×1080 的逻辑坐标，实际渲染缓冲区为 1280×720，限制为 30 fps。每次渲染的像素数减少约 56%，这不是 CPU 或 GPU 耗时的实测百分比。独立播放器和导出使用原分辨率，导出仍为 1920×1080、30 fps。
- 两份字体改用完整 WOFF2，不做字形裁剪。移除了未引用的 PNG。生产播放器不再逐帧打印完整剧集对象。

## 长剧本跳帧

播放器首次需要定位时为当前剧集建立背景、CG 和 BGM 的继承索引。之后跳到任意帧只查一次索引，不再从头扫描背景或向前找音乐。没有变化的连续帧共用同一个状态对象，换剧集或重编预览时会重建索引。背景会清除上一张 CG，BGM 的停乐指令仍会阻断继承。

在本机 Node.js 上，用 25,000 帧的合成剧本做 2,000 次固定顺序的随机定位。九轮中位数中，状态查询从 59.5 ms 降至 0.08 ms，另有约 0.4 ms 的一次性建索引开销。测试同时对比了每次定位的旧、新状态是否一致。这里测的是查找本身，不包含 Pixi 渲染、音频播放、资源加载或 IPC。

## 体积

以下是本机 Linux x64 构建通过 `du -sb` 测得的目录字节数，不是安装包下载大小。

| 范围 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 前端 `dist/` | 17,052,045 B | 10,404,570 B |
| 本地 Electron 运行时 | 291,873,473 B | 291,873,473 B |

前端目录缩小约 39%。Electron 运行时仍是桌面分发体积的主项，因为它自带 Chromium 和 Node.js。[Electron 文档](https://www.electronjs.org/docs/latest)

## Tauri 迁移判断

**现在继续用 Electron。若安装包大小成为硬指标，先做 Tauri 技术验证，再决定迁移。**

- Tauri 使用系统 WebView，通常能省掉随应用分发的 Chromium。它在 Windows、macOS 和 Linux 分别依赖 WebView2、WKWebView 和 WebKitGTK，不能把系统 WebView 的节省当成运行时内存或性能收益。Windows 若要求内置离线 WebView2，安装包还会加回可观的体积。[Tauri 进程模型](https://v2.tauri.app/concept/process-model/) · [Windows 安装方式](https://v2.tauri.app/distribute/windows-installer/#webview2-installation-options)
- Vue 和 Pixi 前端可大体复用。现有 Electron 主进程负责窗口、项目读写和对话框、资源路由、FFmpeg 任务、AI CLI 和 MCP。更换后要实现等价 IPC 和任务取消。用 Node sidecar 可降低早期改写量，但须按目标平台构建，且它的大小也应计入最终包体。[Tauri sidecar 文档](https://v2.tauri.app/develop/sidecar/)
- 原型优先验证 Pixi/Spine、Web Audio 混音、`canvas.captureStream` 和 `MediaRecorder` 录制链路、录制帧率与取消导出，以及打开含本地音频的作品包。用同一份剧本跨目标平台比较冷启动、峰值内存、导出和实际安装包大小，再决定是否继续。未构建 Tauri 原型，暂无项目级的 Tauri 包体或性能数据。
