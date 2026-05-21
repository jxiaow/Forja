# 开发指南

## 环境要求

- Node.js >= 18
- npm
- TypeScript（通过 devDependencies 安装）

## 日常开发

```bash
# 首次克隆后初始化 harness/core submodule
git submodule update --init --recursive

# 安装依赖
npm install

# 编译
npm run compile

# 监听模式（文件变更时自动重编译）
npm run watch

# 类型检查（不输出文件）
npx tsc --noEmit

# 运行测试
npm test
```

## Harness Core 更新

`harness/core/` 是独立的 git submodule，保存通用 agent 流程、gate、模板和自动化检查；项目专属规则放在 `harness/project/`。

首次克隆或发现 `harness/core/` 为空时：

```bash
git submodule update --init --recursive
```

更新通用流程层时：

```bash
git -C harness/core pull --ff-only origin main
git status --short
```

如果 `git status` 显示 `M harness/core`，表示主仓库记录的 submodule 指针需要更新。确认新 core 版本可用后，在主仓库提交这个指针：

```bash
git add harness/core
git commit -m "chore: update harness core"
git push
```

常用入口：

| 路径 | 作用 |
|------|------|
| `harness/core/README.zh-CN.md` | 通用流程说明和维护命令 |
| `harness/core/ONBOARD.md` | 将 harness 接入新项目的步骤 |
| `harness/core/rules/` | 通用执行规则 |
| `harness/core/gates/` | Scope / Plan / Build / Close gate 定义 |
| `harness/core/automation/` | harness 检查脚本 |
| `harness/project/` | Compilot 项目专属 profile 和规则 |

## 调试扩展

1. 在 VSCode 中按 F5 启动 Extension Development Host
2. 打开包含 `.pro` 或 `.sln` 文件的工作区
3. 通过命令面板（Ctrl+Shift+P）测试 `Compilot Qt:` 或 `Compilot SDK:` 命令

---

## 打包与分发

项目产出两个制品，可一键打包：

```bash
npm run package:all
```

输出到 `dist/` 目录：
- `dist/compilot-x.x.x.vsix` — VSCode 扩展
- `dist/compilot-cli-x.x.x.tgz` — CLI npm 包

### 1. VSCode 扩展（.vsix）

```bash
npm run package
```

包含内容：
- `out/` — 编译后的 JS（不含 test 和 sourcemap）
- `package.json` — 扩展清单
- `README.md` — 扩展说明
- `media/icon.svg`、`media/icon.png`
- `LICENSE.txt`

**不包含**：`src/`、`scripts/`、`docs/`、`node_modules/`、`AGENTS.md`、`skills/`

分发方式：
- 本地安装：`code --install-extension dist/compilot-x.x.x.vsix`
- 发布到 Marketplace：`vsce publish`

### 2. CLI（npm 包）

```bash
npm run package:cli
```

由 `scripts/build-cli.js` 从 `out/` 中提取 CLI 所需文件，组装为独立 npm 包。

包含内容：
- `cli/` — 统一入口（compilot qt/sdk 分发）
- `qt/cli/` — Qt CLI 逻辑
- `qt/shared/` — 核心逻辑（命令规划、环境检测、配置解析）
- `qt/env/` — 环境检测
- `qt/platform/` — 平台配置（仅 CLI 可用的 win/linux 子模块和纯函数）
- `qt/sync/` — 远程同步（不依赖 vscode）
- `sdk/cli/` — SDK CLI 逻辑
- `core/` — 纯 Node 日志、配置 IO、同步状态和 SSH 工具

分发方式：
- 全局安装：`npm install -g dist/compilot-cli-x.x.x.tgz`

安装后提供 `compilot` 命令，支持 `compilot qt ...` 和 `compilot sdk ...` 子命令。

---

## CLI 命令行工具

项目还产出独立的 npm 包 `compilot-cli`，用于终端操作、脚本自动化和 AI 编程工具集成。

CLI 的使用文档见 [`docs/README-cli.md`](./README-cli.md)。

---

## 构建脚本

| 脚本 | 作用 |
|------|------|
| `npm run compile` | TypeScript 编译 + 复制 HTML 模板 |
| `npm run watch` | 监听模式编译 |
| `npm test` | 编译 + 运行全部测试 |
| `npm run package` | 编译 + 打包 .vsix 到 `dist/` |
| `npm run package:cli` | 编译 + 组装 CLI + 打包 .tgz 到 `dist/` |
| `npm run package:all` | bump 版本 + 打包 .vsix 和 CLI .tgz |
| `npm run build:cli` | 编译 + 组装 CLI（不打 tgz） |
| `npm run vsix` | 仅打包 .vsix（跳过编译） |

## 关键文件

| 文件 | 作用 |
|------|------|
| `.vscodeignore` | 控制 .vsix 中排除的文件 |
| `scripts/build-cli.js` | 从 `out/` 提取 CLI 文件并打包 |
| `scripts/bump-version.js` | 自动递增 patch 版本号 |
| `tsconfig.json` | TypeScript 编译配置 |

---

## 版本发布流程

1. 运行 `npm test` 确保测试通过
2. 一键打包：`npm run package:all`（自动 bump 版本）
3. 安装验证：`code --install-extension dist/compilot-x.x.x.vsix`
4. 分发 `dist/` 下的 `.vsix` 和 `.tgz`

---

## 项目结构

```
compilot/
├── src/
│   ├── extension.ts            # 扩展入口（activate/deactivate）
│   ├── core/                   # 核心服务
│   │   ├── settingsIO.ts       # 配置文件 IO（纯 Node，不依赖 vscode）
│   │   ├── loggerBase.ts       # 纯 Node 日志基础能力
│   │   ├── ssh.ts              # SSH/SCP 公共工具（纯 Node）
│   │   ├── serverStore.ts      # 服务器配置存储（纯 Node）
│   │   └── syncState.ts        # 同步状态记录（纯 Node）
│   ├── vscode/                 # VSCode 适配层
│   │   ├── logger.ts           # Output channel 日志
│   │   ├── qtState.ts          # Qt 状态存储适配
│   │   ├── settingsStore.ts    # 配置存储（vscode 集成 + 文件监听）
│   │   └── workspaceResolver.ts # 多文件夹工作区根目录解析
│   ├── qt/                     # Qt 模块
│   │   ├── build/              # QMake/Build/Run 任务、调试、IntelliSense 生成
│   │   ├── project/            # .pro 扫描解析、项目选择、文件监听
│   │   ├── env/                # Qt/VS 环境检测
│   │   ├── platform/           # 平台抽象（win/linux）、ShellPlan 构建
│   │   ├── shared/             # 不依赖 vscode 的逻辑（供 CLI 复用）
│   │   ├── sync/               # 远程同步（SCP + git diff）
│   │   └── cli/                # Qt CLI 入口和参数解析
│   ├── sdk/                    # SDK 模块
│   │   ├── sdkExtension.ts     # SDK 模块入口（activateSdk）
│   │   ├── modules/            # 配置、扫描、构建、状态管理
│   │   ├── platform/           # 平台命令生成（windows/linux）
│   │   ├── cli/                # SDK CLI 入口
│   │   └── utils/              # 日志（委托给 core/logger）
│   ├── ui/                     # UI 层
│   │   ├── statusBar.ts        # 状态栏按钮
│   │   ├── statusBarLabels.ts  # 状态栏标签文本
│   │   └── configPanel/        # Webview 配置面板
│   ├── cli/                    # 统一 CLI 入口（compilot qt/sdk 分发）
│   └── test/                   # 单元测试（node:test）
├── out/                        # 编译输出（gitignored）
├── dist/                       # 打包产物（gitignored）
├── scripts/
│   ├── build-cli.js            # CLI 打包脚本
│   ├── bump-version.js         # 版本号递增
│   └── generate-icon.js        # 图标生成
├── skills/
│   └── compilot/SKILL.md       # AI 工具 Skill 文件
├── docs/                       # 文档
├── media/                      # 图标资源
├── package.json                # 扩展清单 + 开发依赖
├── tsconfig.json
├── .vscodeignore               # .vsix 排除规则
├── .gitignore
├── README.md
├── AGENTS.md                   # AI 编程助手指引
└── LICENSE.txt
```

---

## 远程同步模块

`src/qt/sync/` 目录实现远程同步功能：

| 文件 | 职责 |
|------|------|
| `syncWatcher.ts` | 扩展侧：状态栏按钮、配置监听、触发同步 |
| `sftpClient.ts` | 编排层：re-export serverStore + resolver |
| `transport.ts` | SSH/SCP 传输操作 |
| `syncState.ts` | 同步状态记录，跟踪文件 mtime 避免重复上传 |

核心存储已迁移到 `src/core/`：

| 文件 | 职责 |
|------|------|
| `core/serverStore.ts` | 服务器配置存储（全局 `~/.compilot/servers.json`） |
| `core/syncCli.ts` | CLI 侧：独立同步逻辑（不依赖 vscode） |
| `core/ssh.ts` | SSH/SCP 参数构建 + ASKPASS 认证 |

### 数据流

```
VSCode 配置面板
  → 写入 ~/.compilot/servers.json 和 ~/.compilot/projects/<hash>.json 的 sync 配置

CLI
  → 读取 ~/.compilot/projects/<hash>.json 的 sync 配置
  → 执行同步

两者共用
  → .compilot/sync-state.json（已同步文件记录）
```

### 配置存储

| 配置项 | 作用域 | 存储位置 |
|--------|--------|----------|
| 服务器列表 | 全局 | `~/.compilot/servers.json` |
| 启用开关 | 项目 | `~/.compilot/projects/<hash>.json` (`type=sync`) |
| 远程路径 | 项目 | `~/.compilot/projects/<hash>.json` (`type=sync`) |
| 忽略列表 | 项目 | `~/.compilot/projects/<hash>.json` (`type=sync`) |
| 同步状态 | 项目 | `.compilot/sync-state.json` |

---

## 测试

使用 Node.js 内置 `node:test` 框架，无需额外依赖。

```bash
npm test
```

测试文件位于 `src/test/`，覆盖范围：
- CLI 参数解析
- 命令执行器
- 配置面板 HTML 生成
- 项目显示逻辑
- 设置 IO 读写
- Shell 命令规划
- 状态栏标签生成
- 运行时目标解析
- 本地状态管理
