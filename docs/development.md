# 开发指南

## 环境要求

- Node.js >= 18
- npm
- TypeScript（通过 devDependencies 安装）

## 日常开发

```bash
# 安装依赖
npm install

# 编译
npm run compile

# 监听模式（自动重编译）
npm run watch

# 类型检查（不输出文件）
npx tsc --noEmit

# 运行测试
npm test
```

## 调试扩展

1. 在 VSCode 中按 F5 启动 Extension Development Host
2. 打开包含 `.pro` 文件的工作区
3. 通过命令面板（Ctrl+Shift+P）测试 `Qt Pilot:` 命令

---

## 打包与分发

项目有三个产物，各自独立打包：

### 1. VSCode 扩展（.vsix）

```bash
npm run package
```

产出：`qt-pilot-0.3.9.vsix`（约 120 KB）

内容：
- `out/` — 编译后的 JS（含 CLI 和 MCP 代码，但扩展不会调用 MCP 入口）
- `package.json` — 扩展清单
- `README.md` — 扩展说明（Marketplace 展示用）
- `media/icon.svg`
- `LICENSE.txt`

**不包含**：`src/`、`cli/`、`scripts/`、`docs/`、`node_modules/`、`AGENTS.md`

分发方式：
- 发给别人直接安装：`code --install-extension qt-pilot-0.3.9.vsix`
- 发布到 Marketplace：`vsce publish`

### 2. CLI + MCP Server（npm 包）

```bash
npm run build:cli
cd cli
npm pack
```

产出：`qt-pilot-cli-0.3.9.tgz`

内容（由 `cli/package.json` 的 `files` 字段控制）：
- `out/cli/` — CLI 入口
- `out/mcp/` — MCP server 入口
- `out/coreCli/` — 核心逻辑
- `out/env/` — 环境检测
- `out/platform/` — 平台配置（win/linux）
- `out/core/logger.js` — 日志（无 VSCode 时为 no-op）
- `README.md` — CLI 使用说明

分发方式：
- 发给别人直接安装：`npm install -g qt-pilot-cli-0.3.9.tgz`
- 发布到 npm：`cd cli && npm publish`

安装后提供两个命令：
- `qt-pilot` — CLI 工具
- `qt-pilot-mcp` — MCP server（stdio 传输）

### 3. 仅 MCP Server（不单独打包）

MCP server 包含在上面两个产物中：
- vsix 里有 `out/mcp/server.js`（但需要 node_modules 中的 SDK，所以实际要从源码目录运行）
- CLI npm 包里有 `qt-pilot-mcp` 命令（自带依赖，开箱即用）

如果只想给别人用 MCP server，推荐发 CLI npm 包。

---

## 构建脚本说明

| 脚本 | 作用 |
|------|------|
| `npm run compile` | TypeScript 编译 + 复制 HTML 模板 |
| `npm run watch` | 监听模式编译 |
| `npm test` | 编译 + 运行测试（43 个） |
| `npm run package` | 编译 + 打包 vsix |
| `npm run build:cli` | 编译 + 组装 CLI 独立包到 `cli/out/` |
| `npm run vsix` | 仅打包 vsix（不重新编译） |

## 关键文件

| 文件 | 作用 |
|------|------|
| `.vscodeignore` | 控制 vsix 排除哪些文件 |
| `cli/package.json` | CLI npm 包的清单和 files 白名单 |
| `scripts/build-cli.js` | 从 `out/` 提取 CLI 需要的文件到 `cli/out/` |
| `tsconfig.json` | TypeScript 编译配置 |

---

## 版本发布流程

1. 更新 `package.json` 和 `cli/package.json` 中的 `version`
2. 更新 `src/mcp/server.ts` 中的 version 字符串
3. 编译并测试：`npm test`
4. 打包扩展：`npm run package`
5. 打包 CLI：`npm run build:cli && cd cli && npm pack`
6. 分发 `.vsix` 和 `.tgz`

---

## 项目结构

```
xy-qt-tools/
├── src/                    # TypeScript 源码
│   ├── extension.ts        # VSCode 扩展入口
│   ├── cli/                # CLI 入口和参数解析
│   ├── mcp/                # MCP server
│   ├── coreCli/            # VSCode 无关的核心逻辑
│   ├── core/               # 扩展核心（含 VSCode 依赖）
│   ├── build/              # 构建管理
│   ├── project/            # 项目扫描
│   ├── env/                # 环境检测
│   ├── platform/           # 平台抽象（win/linux）
│   ├── ui/                 # UI 层（状态栏、配置面板）
│   └── test/               # 测试
├── out/                    # 编译输出（gitignored）
├── cli/                    # CLI 独立包
│   ├── package.json
│   ├── README.md
│   └── out/                # build:cli 产出（gitignored）
├── scripts/
│   └── build-cli.js        # CLI 打包脚本
├── docs/                   # 文档
├── media/                  # 图标
├── package.json            # 主 package（扩展 + 开发依赖）
├── tsconfig.json
├── .vscodeignore           # vsix 排除规则
├── .gitignore
├── README.md               # 扩展说明（Marketplace 用）
├── AGENTS.md               # AI 编程助手指引
└── LICENSE.txt
```
