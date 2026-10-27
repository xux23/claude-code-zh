# Claude Code 中文汉化

为 **VS Code / VSCodium 版 Claude Code 扩展**提供界面汉化，一条命令完成，扩展更新后重跑即可。

## 快速开始

```bash
# 1. 克隆
git clone https://github.com/xux23/claude-code-zh.git
cd claude-code-zh

# 2. 汉化（默认路径见下方「扩展路径」）
node localize.js
```

或者双击 `汉化.cmd`。

完成后在编辑器里按 `Ctrl+Shift+P` → `Developer: Reload Window` 重新加载窗口，界面即变为中文。

## 命令

| 命令 | 说明 |
|---|---|
| `node localize.js` | 汉化（扩展更新后重跑这一条即可） |
| `node localize.js --check` | 只检查，不修改文件 |
| `node localize.js --restore` | 还原为英文原版 |
| `node localize.js --strict` | 跳过「强制替换」清单，只用保守规则 |
| `node localize.js --dir <路径>` | 指定扩展目录 |

## 扩展路径

脚本默认指向便携版：

```
D:/AAAGreen/VSCodium-win32-x64-1.143.17183/data/extensions/anthropic.claude-code-<版本>
```

路径不同时用 `--dir` 指定，例如：

```bash
node localize.js --dir "C:/Users/你/.vscode/extensions/anthropic.claude-code-2.1.311"
```

也可以设环境变量 `CLAUDE_EXT_DIR`。

### 怎么找自己的扩展目录

- **便携版**：程序目录下的 `data/extensions/`
- **安装版**：`%USERPROFILE%\.vscode\extensions\`（VS Code）或 `%USERPROFILE%\.vscode-oss\extensions\`（VSCodium）

## 汉化范围

| 部分 | 是否支持 | 说明 |
|---|---|---|
| 对话界面文案 | ✅ | 命令面板、模式菜单、权限、插件、MCP、设置面板等 |
| 设置项说明文字 | ✅ | 设置页里每条设置下方的描述 |
| 下拉选项标签 | ✅ | 如归档时长、打开位置 |
| 设置项**标题** | ❌ | 由 VS Code 依键名自动派生（`claudeCode.autosave` → `Autosave`），改标题必须改键名，会导致扩展读不到设置 |
| 内置引导页 / README | ❌ | 不在本工具范围内 |

## 工作原理

Claude Code 扩展没有多语言机制，界面文案硬编码在打包后的 `webview/index.js` 里（约 6MB 压缩代码）。本工具的做法是：

1. 建立英→中词表（`词典.json`）
2. 只替换**处于展示位置**的字符串——即 `children` / `label` / `title` / `placeholder` 等属性值
3. 对每一条词条检查它**所有**出现位置：只要有一处用于逻辑比较（`===`、`includes` 等），整条跳过
4. 少数确实安全但被规则误判的，人工核对后写入「强制替换」清单
5. 逻辑键与显示分离等特殊情况，用「手工补丁」直接替换代码片段

替换后自动校验：每条替换的偏移量与原文精确对应、字符串字面量转义合法、文件语法可解析。

## 安全性

| 机制 | 作用 |
|---|---|
| `.orig` 备份 | 首次运行自动备份原文件，之后始终基于备份重新生成 |
| 幂等 | 重复执行结果完全一致，不会叠加出错 |
| 重叠检测 | 两处替换区间相交时中止，避免破坏文件 |
| 语法校验 | 写入前用 `Function` 构造验证可解析 |
| 键名校验 | 设置项键名变化时中止，保证扩展能读到配置 |

还原随时可用：`node localize.js --restore`。

## 扩展更新后

重跑 `node localize.js` 即可。

如果 Anthropic 改动了代码结构，脚本会明确提示哪些手工补丁失效了：

```
⚠ 10 条手工补丁未命中（扩展可能已改动，需检查 manual-patches）
   命令面板分区标题：…（期望 1 次，实际 0 次）
```

## 自定义译文

所有译文集中在 `词典.json`：

```jsonc
{
  "webview": {
    "词典": { "New conversation": "新建对话", ... },   // 界面文案
    "强制替换": [ ... ],                              // 已确认安全的词条
    "手工补丁": [ { "from": "...", "to": "...", "expectCount": 1 } ]
  },
  "settings": {
    "说明": { "Launch Claude in the terminal...": "在终端中启动 Claude..." },
    "枚举": { "Never": "从不", ... }
  }
}
```

改完重跑 `node localize.js`。

## 环境要求

- Node.js（无需任何第三方依赖）
- 只支持 Windows 路径风格的默认配置，其他平台用 `--dir` 指定

## 免责声明

本工具仅修改本地文件的显示文本，不修改扩展逻辑、不上传任何数据。

词典中含 Anthropic Claude Code 扩展的界面原文，用于标识待替换位置。Claude Code 及其文案版权归 Anthropic PBC 所有。本仓库不包含扩展本体代码。请自行确认符合你所适用的许可协议。
