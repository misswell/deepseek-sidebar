# DeepSeek Sidebar

一键在 Chrome 侧边栏打开 DeepSeek、千问、智谱、Kimi、ChatGPT、Gemini，也可以连接本地 DeepSeek Harness 操作当前网页。

## 功能

- **一键打开** — 点击扩展图标即可在侧边栏加载常用 AI 聊天站点
- **快速切换** — 支持 DeepSeek、千问、智谱、Kimi、ChatGPT、Gemini 一键切换
- **选择页面元素** — 像 DevTools 一样选取当前页面元素，自动提取文本到扩展自己的阅读器
- **页面元素阅读器** — 选中元素后弹出浮动面板，可展开查看或复制文本；不会把页面内容塞进任何 AI 输入框
- **复制页面内容** — 一键复制选中的页面元素文本到剪贴板
- **真实 DeepSeek Harness 对话页** — 默认在侧边栏打开 `http://127.0.0.1:3080/`，也可以设置自己的 Harness 地址；通过 WebSocket bridge 让本地页面直接调用当前页面的 `browser_*` 工具
- **页面与 DevTools 分离** — 扩展在当前标签页读取和执行页面动作；需要时还可把 Chrome DevTools Protocol 调用交给 `chrome.debugger`，不依赖 AI 网站输入框
- **本地连接测试** — 在设置页同时验证 Harness 页面和原生 bridge 的 `hello.ok` 握手；网页内容只在 Harness 请求浏览器工具时发送
- **按页面隔离侧栏** — 仿照 Codex 扩展，按 Chrome `tabId` 保存每个页面的应用、Harness 对话路由、阅读器和缩放状态；切换标签页时恢复各自的右侧窗口
- **自由缩放** — 工具栏按钮或 Ctrl/Cmd +/-/0 快捷键，30%-200% 范围调节
- **双击重置缩放** — 双击缩放百分比标签一键恢复 100%
- **记忆缩放** — 自动保存缩放比例，下次打开立即恢复
- **记忆上次应用** — 自动记住上次使用的 AI 站点，下次打开自动恢复
- **刷新侧边栏** — 工具栏刷新按钮一键重新加载当前 AI 页面
- **iframe 延迟加载** — 每个页面的 AI 站点只创建一个 iframe，切换应用时显示/隐藏，不重复加载，节省资源
- **自动处理页面跳转** — 选择元素时如果页面发生跳转，自动等待加载后继续选择，无需重新操作
- **智能权限请求** — 首次选择元素时自动请求必要权限，引导用户完成授权
- **千问（qianwen.com）深度适配** — 自动修改 User-Agent 模拟移动设备、隐藏 iframe 检测、阻止 visibilitychange 等事件，确保千问移动版在侧边栏中正常渲染
- **请求头修改** — 自动移除 X-Frame-Options / Content-Security-Policy 响应头，使 AI 站点可在侧边栏 iframe 中加载
- **简洁工具栏** — 深色主题，不干扰对话体验

## 1.9.12

- 改为与 Codex 扩展一致的 `sidePanel.setOptions({ tabId }) + sidePanel.open({ tabId })` 标签级侧栏配置
- 每个 Chrome 侧栏文档通过 `SIDE_PANEL` 运行上下文绑定自己的 tab，隐藏侧栏不会再跟随其他标签并覆盖状态
- 缩放比例、选中 AI 和会话路由改为每个标签独立存储，避免快速切换标签时异步写入互相覆盖
- 增加真实 Chromium 侧栏回归，验证 `80% + ChatGPT` 与 `140% + 千问` 来回切换仍各自恢复

## 1.9.11

- 修复侧栏保持打开时切换或新建标签页后，选中的 AI 图标和缩放比例没有可靠恢复的问题
- 增加活动标签页核对和侧栏关闭前保存，确保每个 tab 的设置独立记忆

## 1.9.10

- 默认本机地址不可用时，自动扫描 `3080–3099` 并加载实际运行的 DSH 页面，例如 DSH 自动切换到 `http://127.0.0.1:3081/`
- 端口发现同时复用原生 bridge 地址；明确填写的远程地址或自定义端口保持不变

## 1.9.8

- 设置页的连接测试改为真实完成 WebSocket `hello.ok` 握手，不再把 `/ext/bridge-config` 的 200 响应误当作 bridge 可用
- DSH 页面正常但浏览器 bridge 未安装/未启动时，明确显示分层错误原因
- 增加 `scripts/install-dsh-bridge.sh`，一键构建并注册官方 `@yuxianglin/dsh-bridge-browser`

## 1.9.9

- 配置页增加首次使用安装说明、bridge 安装命令复制按钮和完整文档链接
- 检测到 DSH 页面正常但浏览器 bridge 未安装/未启动时，显示醒目的安装提示

## 1.9.7

- 侧栏默认显示真实的本地 DeepSeek Harness 页面，不再显示扩展自定义任务面板
- 按标签页和应用恢复 iframe 的对话路由，重新打开侧栏时回到上次对话页面
- 原生 bridge 自动绑定当前标签页，页面工具仍由扩展读取和执行，不把页面内容塞入输入框

## 1.9.6

- 按 Chrome 标签页隔离侧栏状态，切换页面时恢复各自的应用、Harness 会话和阅读器状态
- 每个页面独立维护 AI iframe，避免多个页面共用同一个右侧窗口内容
- 监听标签页激活、关闭和替换，自动保存、清理或迁移对应状态

## 1.9.5

- 移除 Harness iframe 和 AI 输入框自动填充路径
- 增加与 `dsh-browser` bridge 插件兼容的 WebSocket 原生工具通道
- 页面快照改为扩展自己的文本协议，聚合主文档与 iframe，使用稳定元素编号，并对敏感字段脱敏
- 设置页支持配置 bridge token；没有 bridge 插件时保留 HTTP 兼容模式

## 1.9.4

- 将普通网页访问权限改为与 Codex 一致的必需 `<all_urls>` 权限，修复百度等未预置站点无法读取和操作的问题

## 1.9.3

- 修复本地网页同时匹配 Harness 内容脚本时，页面操作桥接器被错误跳过的问题
- 通过真实 Chrome Side Panel 验证 Harness 原生网页、当前页面快照和多轮动作闭环

## 1.9.2

- 将用户配置的 DeepSeek Harness 原生网页界面嵌入侧边栏，并桥接当前标签页快照与网页动作执行
- 支持 Harness 返回多轮结构化动作，自动回填执行结果继续完成任务

## 安装

### 从 Chrome Web Store 安装

> 即将上架

### 开发者模式加载

1. 克隆本仓库
   ```bash
   git clone https://github.com/misswell/deepseek-sidebar.git
   ```
2. 打开 `chrome://extensions`
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」，选择项目目录
5. 启动一次 DeepSeek Harness，然后在本仓库目录运行安装脚本，构建并注册官方浏览器 bridge：
   ```bash
   ./scripts/install-dsh-bridge.sh
   ```
   脚本会复用 `~/.dsh/dsh-browser`（不存在时下载官方源码），构建 `@yuxianglin/dsh-bridge-browser` 并注册到本机 `web` profile。若 DSH 已经在运行，请重启 DSH；脚本不会替换本扩展，也不会把页面内容写入 AI 输入框。
6. 打开扩展设置，在「DeepSeek Harness 网页代理」中填写服务地址（默认 `http://127.0.0.1:3080/`）和可选 token，然后测试连接
7. 在侧边栏打开 Harness 图标，直接使用本地 DeepSeek 对话页面发起任务；页面内容由扩展自己的 browser 工具读取，不会写入 DeepSeek/ChatGPT 等网站的输入框

如果测试结果显示“DSH 页面正常，但浏览器 bridge 未连接”，说明本地对话页面可以打开，但 DSH 尚未加载浏览器 bridge；重新运行 `./scripts/install-dsh-bridge.sh` 并重启 DSH。Chrome 本机连接通常无需 token，远程地址请填写服务端 token。后续官方 bridge 更新时可再次运行该脚本。

## 文件结构

```
├── manifest.json           # MV3 扩展清单
├── background.js           # Service Worker，处理图标点击打开侧边栏
├── harness-client.js       # Harness session RPC 客户端与轮询
├── harness-protocol.js     # Harness RPC、动作解析和任务提示词
├── harness-discovery.js    # 默认本机 DSH 端口和页面/bridge 自动发现
├── harness-bridge-client.js # 原生 WebSocket bridge、握手、重连和工具回传
├── harness-extension-transport.js # 通过 Harness 同源宿主页转发扩展 RPC
├── harness-host-bridge.js  # 在 Harness 同源页面内转发 API 请求，避免放宽服务端 CORS
├── frame-route-bridge.js   # 在 Harness iframe 握手后记录 SPA 对话路由
├── page-bridge.js          # 注入当前网页的文本快照与动作执行桥
├── sidepanel.html          # 侧边栏页面（工具栏 + AI iframe + 本地 Harness 页面）
├── sidepanel.js            # 按标签页隔离的 iframe 路由、缩放、应用切换和页面工具逻辑
├── tab-state.js            # 标签页状态规范化、迁移和清理
├── scripts/install-dsh-bridge.sh # 构建并注册官方 DSH 浏览器 bridge
├── ua-override.js          # 注入千问的 content script，修改 UA 并隐藏 iframe 检测
├── rules.json              # declarativeNetRequest 规则（移除响应头 + 修改请求头）
├── privacy-policy.html     # 隐私政策
└── icons/                  # 扩展图标
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## 权限说明

| 权限 | 用途 |
|------|------|
| sidePanel | 在 Chrome 侧边栏中展示 AI 聊天站点 |
| activeTab | 用户点击扩展后支持选择当前标签页中的页面元素（网页代理同时使用 `<all_urls>`） |
| tabs | 查询当前标签页，并创建后台 Harness 宿主页面 |
| storage | 本地保存用户的缩放比例、应用选择、每个标签页的 Harness 会话和对话路由 |
| scripting | 为页面选择器和 Harness 的 browser 工具注入页面桥接脚本 |
| debugger | 为 Harness 暴露受控的 Chrome DevTools Protocol 调用入口 |
| webNavigation | 枚举当前标签页的主文档与 iframe，让原生网页工具按 `frame + index` 路由 |
| `<all_urls>` | 按 Codex 的方式读取和操作当前普通网页，以及访问自定义 Harness 地址 |
| declarativeNetRequest | 移除 AI 聊天站点的 X-Frame-Options / Content-Security-Policy 响应头，使其可在侧边栏中加载 |
| declarativeNetRequestWithHostAccess | 修改千问侧边栏 iframe 的 User-Agent 和 sec-ch-ua 请求头，使其正确渲染移动版页面 |
| host_permissions | 访问 AI 站点、`http://127.0.0.1/*`、`http://localhost/*`，用于页面适配和本地 Harness 宿主桥 |

## 隐私

本扩展不收集或上传用户数据到扩展作者的服务器。侧栏直接显示配置的 Harness 页面；Harness 通过 bridge 请求扩展读取当前页面或执行动作，页面文本不会经过第三方 AI 网站的输入框。详见 [隐私政策](https://misswell.github.io/deepseek-sidebar/privacy-policy.html)。

## License

MIT
