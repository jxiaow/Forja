# Qt Pilot CLI

命令行工具和 MCP server，用于 qmake 项目的构建、运行和环境管理。

专为 AI 编程工具设计，也可独立使用。

## 安装

```bash
npm install -g qt-pilot-cli
```

## CLI 使用

```bash
# 查看帮助
qt-pilot --help

# 初始化（检测环境、保存本地配置）
qt-pilot init --execute --json

# 查看状态
qt-pilot status --json

# 构建（dry-run，查看命令）
qt-pilot build --json

# 构建（执行）
qt-pilot build --execute --json

# 运行
qt-pilot run --execute --json

# 清理
qt-pilot clean --execute --json
```

## MCP Server

Qt Pilot 提供 MCP (Model Context Protocol) server，让 AI 工具直接调用构建操作。

### 安装后配置

全局安装 `qt-pilot-cli` 后，各 IDE 配置如下：

#### Kiro

`~/.kiro/settings/mcp.json`（用户级，所有项目生效）或 `.kiro/settings/mcp.json`（项目级）

```json
{
  "mcpServers": {
    "qt-pilot": {
      "command": "qt-pilot-mcp",
      "disabled": false,
      "autoApprove": ["qt_status", "qt_detect", "qt_projects"]
    }
  }
}
```

#### Cursor

`~/.cursor/mcp.json`

```json
{
  "mcpServers": {
    "qt-pilot": {
      "command": "qt-pilot-mcp"
    }
  }
}
```

#### Claude Desktop

Windows: `%APPDATA%/Claude/claude_desktop_config.json`  
macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "qt-pilot": {
      "command": "qt-pilot-mcp"
    }
  }
}
```

#### Windsurf / Cline

`.cline/mcp_settings.json`（项目级）

```json
{
  "mcpServers": {
    "qt-pilot": {
      "command": "qt-pilot-mcp"
    }
  }
}
```

### 未安装 npm 包时（本地开发）

如果没有全局安装，用 `node` 指向编译产物：

```json
{
  "mcpServers": {
    "qt-pilot": {
      "command": "node",
      "args": ["/path/to/xy-qt-tools/out/mcp/server.js"]
    }
  }
}
```

把 `/path/to/xy-qt-tools` 替换为实际的项目路径。

### 可用 Tools

| Tool | 描述 |
|------|------|
| `qt_status` | 查看项目状态和配置 |
| `qt_init` | 初始化本地配置 |
| `qt_detect` | 检测 Qt/VS 环境 |
| `qt_projects` | 列出 .pro 文件 |
| `qt_qmake` | 生成/执行 qmake |
| `qt_build` | 生成/执行构建 |
| `qt_clean` | 生成/执行清理 |
| `qt_run` | 构建并运行 |
| `qt_stop` | 停止程序 |

每个 tool 都支持 `execute` 参数：
- `false`（默认）：dry-run，仅返回命令计划
- `true`：实际执行命令

## 本地状态

配置保存在项目目录下：

```
.work/qt-pilot/
├── config.json   # 用户配置（项目、路径等）
├── cache.json    # 环境检测缓存
└── logs/         # 执行日志
```

## 配置优先级

```
CLI 参数 > .work/qt-pilot/config.json > .work/qt-pilot/cache.json > 环境变量 > 自动检测 > 默认值
```

## 支持平台

- Windows (MSVC + jom)
- Linux (GCC + make)

## License

MIT

---

## AI 工具集成指南

如果你的 AI 编程工具不支持 MCP（只能执行 shell 命令），可以在项目的 steering / system prompt / 规则文件中加入以下说明，让 AI 知道如何使用 Qt Pilot：

```markdown
# Qt 项目构建

本项目使用 qt-pilot 命令行工具管理构建流程。所有构建操作请通过以下命令完成：

## 首次使用

qt-pilot init --execute --json

该命令会检测 Qt 和 VS 环境，保存到 .work/qt-pilot/，后续命令自动读取。

## 常用命令

- 查看状态：qt-pilot status --json
- 生成 Makefile：qt-pilot qmake --execute --json
- 编译：qt-pilot build --execute --json
- 运行：qt-pilot run --execute --json
- 清理：qt-pilot clean --execute --json
- 停止：qt-pilot stop --execute --json

## 规则

- 所有命令加 --json 获取结构化输出
- 不加 --execute 时为 dry-run，仅返回命令计划不实际执行
- 构建失败时查看返回结果中的 logFile 路径获取详细日志
- 如果返回 ok: false，查看 diagnostics 和 nextActions 字段决定下一步
- 多个 .pro 文件时需要用 --project <path> 指定
```

### Kiro steering 示例

创建 `.kiro/steering/qt-build.md`：

```markdown
---
inclusion: auto
---
# Qt 构建

本项目使用 qt-pilot CLI 构建。

- 查看状态：`qt-pilot status --json`
- 编译：`qt-pilot build --execute --json`
- 运行：`qt-pilot run --execute --json`
- 构建失败时读 logFile 分析错误

不要手动拼 qmake/jom/make 命令，统一用 qt-pilot。
```
