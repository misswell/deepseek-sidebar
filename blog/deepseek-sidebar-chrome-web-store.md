# DeepSeek Sidebar 已上架 Chrome 应用商店：把 AI 助手放进浏览器侧边栏

DeepSeek Sidebar 现在已经发布到 Chrome 应用商店：

[立即安装 DeepSeek Sidebar](https://chromewebstore.google.com/detail/deepseek-sidebar/gakblhcadiegnapiajgolefjhhmicobi)

如果你经常一边浏览网页、一边向 AI 提问、总结内容、改写文案或整理资料，那么在不同标签页之间来回切换会很打断思路。DeepSeek Sidebar 的目标很简单：把常用 AI 聊天工具放进 Chrome 侧边栏，让它始终停在你正在浏览的网页旁边。

<!--more-->

![DeepSeek Sidebar 支持多个 AI 工具](https://blog.liuguofeng.com/wp-content/uploads/2026/06/01_connect_multi_ai_1280x800.webp)

## 一键打开，AI 不再占用标签页

安装扩展后，点击 Chrome 工具栏里的扩展图标，就可以直接在侧边栏打开 AI 聊天页面。你不需要新开标签页，也不需要把当前网页切走。

当前支持的 AI 站点包括：

- DeepSeek
- 千问
- 智谱
- Kimi
- ChatGPT
- Gemini

这些站点可以在侧边栏顶部的工具栏中快速切换。每个站点只会创建一次 iframe，切换时保持页面状态，减少重复加载。

![在浏览器侧边栏中使用 AI 助手](https://blog.liuguofeng.com/wp-content/uploads/2026/06/02_ai_assistant_in_browser_1280x800.webp)

## 支持缩放，并记住你的偏好

侧边栏空间有限，不同 AI 网站的移动端或响应式布局也不完全一样，所以 DeepSeek Sidebar 内置了页面缩放功能。

你可以通过工具栏按钮调整缩放比例，也可以使用快捷键：

- `Ctrl/Cmd + +` 放大
- `Ctrl/Cmd + -` 缩小
- 双击缩放比例回到 `100%`

缩放范围为 `30%` 到 `200%`。扩展会自动记住你的缩放比例，下次打开侧边栏时立即恢复，不用每次重新调整。

![DeepSeek Sidebar 支持主流 AI 工具切换](https://blog.liuguofeng.com/wp-content/uploads/2026/06/03_mainstream_ai_in_sidebar_1280x800.webp)

## 像 DevTools 一样选取页面内容，自动填充到 AI

DeepSeek Sidebar 还提供了一个很适合阅读、研究和写作的功能：选择页面元素。

点击工具栏中的选择按钮后，你可以像使用 DevTools 一样在当前网页上移动鼠标，选择某个段落、卡片、文章区域或页面模块。确认选择后，扩展会提取该元素的可见文本，并自动填充到当前侧边栏 AI 的输入框中。

这适合很多日常场景：

- 让 AI 总结当前网页中的某段内容
- 把商品说明、技术文档、新闻段落发送给 AI 分析
- 选中页面中的错误信息，让 AI 帮你排查
- 提取网页中的文本，再交给 AI 改写、翻译或整理

选中后还会显示一个页面内容阅读器，你可以展开查看完整文本，也可以一键复制到剪贴板。

![选择页面元素并自动填充到 AI 输入框](https://blog.liuguofeng.com/wp-content/uploads/2026/06/04_element_select_autofill_1280x800.webp)

## 更适合长期放在侧边栏里的细节

为了让它更像一个日常工具，而不是一次性的网页嵌入，DeepSeek Sidebar 做了一些细节处理：

- 自动记住上次使用的 AI 站点
- 工具栏保持简洁的深色主题，尽量不干扰对话
- 支持刷新当前 AI 页面
- 页面元素选择过程中如果网页跳转，会自动等待加载后继续选择
- 针对千问做了移动端 User-Agent 和 iframe 适配，提升侧边栏中的可用性

## 隐私说明

DeepSeek Sidebar 不收集任何用户数据。

扩展只会在本地保存缩放比例和上次选择的 AI 站点。选择页面元素时，脚本只在你主动点击按钮后临时注入当前标签页，用于读取你选中的元素文本。文本会显示在本地侧边栏中，并填充到当前 AI 网站的输入框；是否发送给第三方 AI 网站，由你自己决定。

你也可以查看完整隐私政策：

[DeepSeek Sidebar 隐私政策](https://misswell.github.io/deepseek-sidebar/privacy-policy.html)

## 安装地址

DeepSeek Sidebar 已经可以在 Chrome 应用商店安装：

[https://chromewebstore.google.com/detail/deepseek-sidebar/gakblhcadiegnapiajgolefjhhmicobi](https://chromewebstore.google.com/detail/deepseek-sidebar/gakblhcadiegnapiajgolefjhhmicobi)

如果你习惯边浏览网页边使用 AI，它会是一个很轻量、顺手的小工具。
