# DeepSeek Sidebar

一键在 Chrome 侧边栏打开 DeepSeek、千问、智谱、Kimi、ChatGPT、Gemini，支持页面缩放并记忆缩放比例。

## 功能

- **一键打开** — 点击扩展图标即可在侧边栏加载常用 AI 聊天站点
- **快速切换** — 支持 DeepSeek、千问、智谱、Kimi、ChatGPT、Gemini
- **自由缩放** — 工具栏按钮或 Ctrl/Cmd +/-/0 快捷键，30%-200% 范围调节
- **记忆缩放** — 自动保存缩放比例，下次打开立即恢复
- **简洁工具栏** — 深色主题，不干扰对话体验

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

## 文件结构

```
├── manifest.json       # MV3 扩展清单
├── background.js       # Service Worker，处理图标点击
├── sidepanel.html      # 侧边栏页面
├── sidepanel.js        # 缩放控制逻辑
├── rules.json          # 移除 X-Frame-Options 响应头
├── privacy-policy.html # 隐私政策
└── icons/              # 扩展图标
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## 权限说明

| 权限 | 用途 |
|------|------|
| sidePanel | 在 Chrome 侧边栏中展示 AI 聊天站点 |
| activeTab | 点击扩展图标时获取当前标签页以打开侧边栏 |
| storage | 本地保存用户的缩放比例设置 |
| declarativeNetRequest | 移除 AI 聊天站点的 X-Frame-Options / Content-Security-Policy 响应头，使其可在侧边栏中加载 |
| host_permissions | 访问 chat.deepseek.com、qianwen.com、chat.z.ai、kimi.com、chatgpt.com、gemini.google.com 以实现上述头部修改 |

## 隐私

本扩展不收集任何用户数据。详见 [隐私政策](https://misswell.github.io/deepseek-sidebar/privacy-policy.html)。

## License

MIT
