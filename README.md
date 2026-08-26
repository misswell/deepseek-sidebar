# DeepSeek Sidebar

一键在 Chrome 侧边栏打开 DeepSeek、千问、智谱、Kimi、ChatGPT、Gemini，也可以连接本地 DeepSeek Harness 操作当前网页。

## 功能

- **一键打开** — 点击扩展图标即可在侧边栏加载常用 AI 聊天站点
- **快速切换** — 支持 DeepSeek、千问、智谱、Kimi、ChatGPT、Gemini 一键切换
- **选择页面元素** — 像 DevTools 一样选取当前页面元素，自动提取文本并填充到侧栏 AI 输入框
- **页面元素阅读器** — 选中元素后弹出浮动面板，可展开查看、复制文本或直接填充到 AI 输入框
- **复制页面内容** — 一键复制选中的页面元素文本到剪贴板
- **DeepSeek Harness 网页代理** — 配置 `http://127.0.0.1:3080/` 或自己的 Harness 地址，读取当前页面快照并执行点击、填写、按键、滚动、导航等动作
- **本地连接测试** — 在设置页验证 Harness 服务和模型信息；网页内容只在用户运行任务时发送到配置的 Harness
- **AI 输入框自动填充** — 选中页面元素后自动将文本填充到当前 AI 站点的输入框，支持 textarea、input 和 contenteditable
- **自由缩放** — 工具栏按钮或 Ctrl/Cmd +/-/0 快捷键，30%-200% 范围调节
- **双击重置缩放** — 双击缩放百分比标签一键恢复 100%
- **记忆缩放** — 自动保存缩放比例，下次打开立即恢复
- **记忆上次应用** — 自动记住上次使用的 AI 站点，下次打开自动恢复
- **刷新侧边栏** — 工具栏刷新按钮一键重新加载当前 AI 页面
- **iframe 延迟加载** — 每个 AI 站点只创建一个 iframe，切换时显示/隐藏，不重复加载，节省资源
- **自动处理页面跳转** — 选择元素时如果页面发生跳转，自动等待加载后继续选择，无需重新操作
- **智能权限请求** — 首次选择元素时自动请求必要权限，引导用户完成授权
- **千问（qianwen.com）深度适配** — 自动修改 User-Agent 模拟移动设备、隐藏 iframe 检测、阻止 visibilitychange 等事件，确保千问移动版在侧边栏中正常渲染
- **请求头修改** — 自动移除 X-Frame-Options / Content-Security-Policy 响应头，使 AI 站点可在侧边栏 iframe 中加载
- **简洁工具栏** — 深色主题，不干扰对话体验

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
5. 打开扩展设置，在「DeepSeek Harness 网页代理」中填写服务地址并测试连接
6. 在侧边栏点击 Harness 图标，输入网页任务；首次安装或更新时请在 Chrome 权限提示中允许扩展访问网站

## 文件结构

```
├── manifest.json           # MV3 扩展清单
├── background.js           # Service Worker，处理图标点击打开侧边栏
├── harness-client.js       # Harness session RPC 客户端与轮询
├── harness-protocol.js     # Harness RPC、动作解析和任务提示词
├── harness-extension-transport.js # 通过 Harness 同源宿主页转发扩展 RPC
├── harness-host-bridge.js  # 在 Harness 同源页面内转发 API 请求，避免放宽服务端 CORS
├── harness-embedded-bridge.js # 嵌入侧栏的 Harness 原生界面与当前标签页操作桥
├── page-bridge.js          # 注入当前网页的快照与动作执行桥
├── sidepanel.html          # 侧边栏页面（工具栏 + iframe 容器 + 页面阅读器）
├── sidepanel.js            # 缩放控制、应用切换、元素选择、页面阅读器逻辑
├── ai-input-fill.js        # 注入 AI 站点的 content script，自动填充输入框
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
| activeTab | 用户点击扩展后临时授权选择当前标签页中的页面元素 |
| tabs | 查询当前标签页，并创建后台 Harness 宿主页面 |
| storage | 本地保存用户的缩放比例和应用选择设置 |
| scripting | 点击选择按钮时向当前标签页注入一次性脚本，提取选中元素的可见文本 |
| `<all_urls>` | 按 Codex 的方式读取和操作当前普通网页，以及访问自定义 Harness 地址 |
| declarativeNetRequest | 移除 AI 聊天站点的 X-Frame-Options / Content-Security-Policy 响应头，使其可在侧边栏中加载 |
| declarativeNetRequestWithHostAccess | 修改千问侧边栏 iframe 的 User-Agent 和 sec-ch-ua 请求头，使其正确渲染移动版页面 |
| host_permissions | 访问 AI 站点、`http://127.0.0.1/*`、`http://localhost/*`，用于页面适配和本地 Harness 宿主桥 |

## 隐私

本扩展不收集或上传用户数据到扩展作者的服务器。用户主动运行 Harness 网页任务时，当前页面快照会发送到用户配置的 Harness 地址，由该本地/自建服务处理。详见 [隐私政策](https://misswell.github.io/deepseek-sidebar/privacy-policy.html)。

## License

MIT
