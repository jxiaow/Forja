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
2. 打开包含 `.pro` 或 `.sln` 文件的工作区
3. 通过命令面板（Ctrl+Shift+P）测试 `Compilot Qt:` 或 `Compilot SDK:` 命令

---

## 打包与分发

项目有两个产物，可一键全部打包：

```bash
npm run package:all
```

产出到 `dist/` 目录：
- `dist/compilot-x.x.x.vsix` — VSCode 扩展
- `dist/compilot-cli-x.x.x.tgz` — CLI 独立 npm 包

### 1. VSCode 扩展（.vsix）

```bash
npm run package
```

内容：
- `out/` — 编译后的 JS（不含 test 和 sourcemap）
- `package.json` — 扩展清单
- `README.md` — 扩展说明
- `media/icon.svg`、`media/icon.png`
- `LICENSE.txt`

**不包含**：`src/`、`scripts/`、`docs/`、`node_modules/`、`AGENTS.md`、`skills/`

分发方式：
- 直接安装：`code --install-extension dist/compilot-x.x.x.vsix`
- 发布到 Marketplace：`vsce publish`

### 2. CLI（npm 包）

```bash
npm run package:cli
```

由 `scripts/build-cli.js` 从 `out/` 中提取 CLI 需要的文件，组装为独立 npm 包。

内容：
- `cli/` — CLI 入口（compilot qt/sdk 分发）
- `qt/cli/` — Qt CLI 逻辑
- `qt/shared/` — 核心逻辑（命令规划、环境检测、配置解析）
- `qt/env/` — 环境检测
- `qt/platform/` — 平台配置（win/linux）
- `qt/sync/` — 远程同步（非 vscode 依赖部分）
- `sdk/cli/` — SDK CLI 逻辑
- `core/` — 日志和配置 IO

分发方式：
- 直接安装：`npm install -g dist/compilot-cli-x.x.x.tgz`

安装后提供 `compilot` 命令，支持 `compilot qt ...` 和 `compilot sdk ...` 子命令。

---

## 构建脚本说明

| 脚本 | 作用 |
|------|------|
| `npm run compile` | TypeScript 编译 + 复制 HTML 模板 |
| `npm run watch` | 监听模式编译 |
| `npm test` | 编译 + 运行测试（53 个） |
| `npm run package` | 编译 + 打包 vsix 到 `dist/` |
| `npm run package:cli` | 编译 + 组装 CLI + 打包 tgz 到 `dist/` |
| `npm run package:all` | bump 版本 + 打包 vsix 和 CLI tgz |
| `npm run build:cli` | 编译 + 组装 CLI 独立包（不打 tgz） |
| `npm run vsix` | 仅打包 vsix（不重新编译） |

## 关键文件

| 文件 | 作用 |
|------|------|
| `.vscodeignore` | 控制 vsix 排除哪些文件 |
| `scripts/build-cli.js` | 从 `out/` 提取 CLI 需要的文件并打包 |
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
xy-qt-tools/
├── src/
│   ├── extension.ts            # VSCode 扩展入口（activate/deactivate）
│   ├── core/                   # 扩展核心服务
│   │   ├── stateManager.ts     # 单一状态源，事件订阅
│   │   ├── configService.ts    # 统一配置读写、BuildConfig 组装
│   │   ├── settingsIO.ts       # 配置文件纯 IO（不依赖 vscode）
│   │   ├── settingsStore.ts    # 自管理配置存储（vscode 集成 + 文件监听）
│   │   ├── workspaceResolver.ts # 多文件夹工作区项目根目录解析
│   │   └── logger.ts           # Output channel 日志
│   ├── qt/                     # Qt 模块
│   │   ├── build/              # QMake/Build/Run 任务执行、调试、IntelliSense
│   │   ├── project/            # .pro 扫描、解析、项目选择、文件监听
│   │   ├── env/                # Qt/VS 环境检测
│   │   ├── platform/           # 平台抽象（win/linux）、ShellPlan
│   │   ├── shared/             # 不依赖 vscode 的共享逻辑（CLI 复用）
│   │   ├── sync/               # 远程同步（SCP + git diff）
│   │   └── cli/                # Qt CLI 入口和参数解析
│   ├── sdk/                    # SDK 模块
│   │   ├── sdkExtension.ts     # SDK 模块入口（activateSdk）
│   │   ├── modules/            # 配置、扫描、构建、状态管理
│   │   ├── platform/           # 平台命令生成（windows/linux）
│   │   ├── cli/                # SDK CLI 入口
│   │   └── utils/              # SDK 日志
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
├── media/                      # 图标
├── package.json                # 主 package（扩展清单 + 开发依赖）
├── tsconfig.json
├── .vscodeignore               # vsix 排除规则
├── .gitignore
├── README.md                   # 扩展说明
├── AGENTS.md                   # AI 编程助手指引
└── LICENSE.txt
```

---

## 远程同步模块

`src/qt/sync/` 目录包含远程同步功能的实现：

| 文件 | 作用 |
|------|------|
| `syncWatcher.ts` | VSCode 扩展侧：状态栏按钮、配置变更监听、触发同步 |
| `sftpClient.ts` | 同步编排层：re-export serverStore + resolver |
| `serverStore.ts` | 服务器配置存储（全局 JSON 文件） |
| `resolver.ts` | 同步配置解析（合并服务器 + 项目配置） |
| `transport.ts` | SSH/SCP 传输操作 |
| `syncState.ts` | 同步状态记录，跟踪文件 mtime 避免重复上传 |
| `syncCli.ts` | CLI 侧：独立的同步逻辑（无 vscode 依赖） |

### 数据流

```
VSCode 配置面板
  → 写入 .qtpilot/sync-config.json（服务器列表 + 项目同步配置）

CLI
  → 读取 .qtpilot/sync-config.json
  → 执行同步

两者共用
  → .qtpilot/sync-state.json（已同步文件记录）
```

### 配置存储

| 配置项 | 作用域 | 存储位置 |
|--------|--------|----------|
| 服务器列表 | 全局 | `.qtpilot/sync-config.json` |
| 启用开关 | 项目 | `.qtpilot/sync-config.json` |
| 远程路径 | 项目 | `.qtpilot/sync-config.json` |
| 忽略列表 | 项目 | `.qtpilot/sync-config.json` |
| 同步状态 | 项目 | `.qtpilot/sync-state.json` |

---

## 测试

测试使用 Node.js 内置的 `node:test` 框架，无需额外依赖。

```bash
npm test
```

测试文件位于 `src/test/`，覆盖：
- CLI 参数解析
- 命令执行器
- 配置面板 HTML 生成
- 项目显示逻辑
- 设置 IO 读写
- Shell 命令规划
- 状态栏标签
- 运行时目标解析
- 本地状态管理

当前共 53 个测试用例。
