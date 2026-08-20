# dsh-selection-highlight

Selection Highlight（选区高亮）：在 dsh Web 对话中双击或拖选一段文本后，
**对话消息区域**内与选中文本相同的片段会以低一级背景淡高亮。选中原文保持
浏览器原生选区背景；按 `Esc`、点击空白处、切换会话或 DOM 重建时自动清除。

功能对标 VS Code 的 **Selection Highlight**（`editor.selectionHighlight` /
`editor.wordHighlightBackground`），而不是 Visual Studio 的语义级
*Highlight References*：本插件做的是**纯文本子串匹配**，不解析符号。

## 安装（官方方式）

```powershell
dsh plugin --profile web add github:kxSenlin/dsh-selection-highlight
```

与 `dsh-whale-font` 相同的 GitHub 分发方式：仓库已包含构建好的 `lib/`，
无需 `prepare` 脚本、无需 npm 账号、无需 `allowBuilds`。

安装后重启 `dsh web`。设置入口：设置 → **选区高亮**。

本地开发安装（link 到当前 checkout）：

```powershell
cd dsh-selection-highlight
npm install
npm run build
dsh plugin --profile web add .
```

## 设置项（localStorage 持久化）

| 设置 | 默认值 | 说明 |
|---|---|---|
| 启用文本高亮 | 开 | 关闭立即清除高亮 |
| 忽略大小写 | 开 | `deepseek` 与 `DeepSeek` 同段 |
| 最少字符数 | 4 | 1–64，过短选区不触发 |
| 对话区域 CSS 选择器 | `[data-conversation-scroll] [data-chat-flow]` | dsh 改版后的兜底适配 |

另有固定上限：选中文本最长 128 字符；匹配结果最多 2000 个 Range；含换行、
纯空白、位于输入框 / textarea / contenteditable / 输入区 / 流式输出中的
文本不参与高亮。

## 实现说明

- 纯浏览器半插件，host 半为空；不读取会话数据、不写会话日志。
- 使用 **CSS Custom Highlight API**（`CSS.highlights`）绘制，不改动页面
  DOM，不会干扰 React 渲染。不支持该 API 的浏览器会在设置页显示
  “引擎不可用”。
- `selectionchange` + 防抖 + `MutationObserver`：React 重渲染导致 Range
  失效时先清除，尘埃落定后再重建。
- 包结构按 dsh 外部插件约定：`dsh.bundle.patch` + `dsh.client`，客户端
  bundle 以 `window.__ModuleLoader__.load({ id, factory })` 契约产出。
