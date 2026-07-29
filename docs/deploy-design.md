# Compilot 远程编译部署方案

## 背景

当前 compilot 支持本地 Qt/SDK 项目的编译运行，以及通过 sync 模块将代码推送到远程服务器。但缺少完整的远程编译部署能力：在远程 Linux 机器上编译，将产物传输到部署机，并启动程序。

本方案将 DeployX 的核心编译部署能力集成到 compilot 中，以纯 Node.js/TypeScript 实现。远程机器上同样安装 compilot，编译命令由远程 compilot 自行生成和执行，本地只负责编排流程。

---

## 整体流程

```
本地开发机                    远程编译机                    远程部署机
┌──────────┐                ┌──────────┐                ┌──────────┐
│ 写代码    │  ──SSH切分支──▶ │ 切换分支  │                │          │
│          │  ──SCP推文件──▶ │ 同步代码  │                │          │
│          │  ──SSH执行────▶ │ compilot  │                │          │
│          │               │ qt build  │                │          │
│          │               │ 产物生成  │ ──SCP传输────▶  │ 接收产物  │
│          │               │          │  ──SSH执行───▶  │ 杀旧进程  │
│          │               │          │  ──SSH执行───▶  │ 启动程序  │
└──────────┘                └──────────┘                └──────────┘
```

编译机和部署机可以是同一台，也可以是不同的机器。

---

## 执行阶段

按顺序执行，每一步可单独跳过：

| 阶段 | 动作 | 说明 |
|------|------|------|
| 1. branchSync | SSH 到编译机，切换各仓库分支 | 确保远程代码和本地分支一致 |
| 2. sync | SCP 推送本地未提交改动 | 复用现有 sync 模块 |
| 3. build | SSH 执行 `compilot qt/sdk build` | 远程 compilot 自行 detect 环境、生成命令 |
| 4. transfer | 传输产物到部署机 | 产物路径由远程 compilot 编译后输出 |
| 5. stop | SSH 到部署机杀旧进程 | 从 launch.command 推断进程名，自动 pkill |
| 6. launch | SSH 到部署机启动程序 | 支持前台/后台模式 |

---

## 配置设计

### 服务器配置（已有）

路径：`~/.compilot/servers.json`

每台服务器配置包含连接信息和 `remotePath`（该服务器上的工作目录）：

```json
[
  {
    "id": "abc123",
    "name": "编译机",
    "host": "192.168.1.100",
    "port": 22,
    "username": "dev",
    "authMode": "password",
    "privateKeyPath": "",
    "password": "xxx",
    "remotePath": "/home/dev/workspace"
  },
  {
    "id": "def456",
    "name": "部署机",
    "host": "192.168.1.200",
    "port": 22,
    "username": "app",
    "authMode": "key",
    "privateKeyPath": "~/.ssh/id_rsa",
    "password": "",
    "remotePath": "/opt/app"
  }
]
```

- 编译机的 `remotePath`：远程工作空间根目录（代码同步到这里，编译在这里执行）
- 部署机的 `remotePath`：部署目录（产物传输到这里，程序在这里启动）

### 同步配置（已有，扩展）

路径：`.compilot/sync-config.json`（项目级）

```json
{
  "enabled": true,
  "selectedServer": "abc123",
  "ignore": [".git", "node_modules", "build"],
  "branchSync": {
    "enabled": true,
    "pinned": {
      "third-party": "main"
    }
  }
}
```

- `selectedServer`：即编译机。代码同步到这台机器，远程编译也在这台机器上执行。
- `branchSync`：多仓库分支同步配置（新增字段），编译前确保远程各仓库分支和本地一致。
- 远程模式下，sync 和 build 共用这台服务器，不重复配置。

### 部署配置（新增，可选）

路径：`.compilot/deploy.json`（项目级）

**仅当编译机和部署机不是同一台时需要此文件。** 如果只有一台远程机器（既编译又运行），不需要创建此文件，`run --remote` 会直接在编译机上运行程序。

```json
{
  "server": "def456",
  "launch": {
    "command": "./myapp",
    "mode": "bg"
  }
}
```

#### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `server` | string | 部署机 ID，引用 servers.json |
| `launch.command` | string | 启动命令 |
| `launch.mode` | string | `"bg"`（后台 nohup）或 `"fg"`（前台） |
| `stopCommand` | string | 可选，覆盖默认停止命令（默认从 launch.command 推断） |

#### 配置职责划分

| 文件 | 职责 |
|------|------|
| `servers.json` | 所有服务器的连接信息和工作目录 |
| `sync-config.json` | 编译机选择 + 同步规则 + 分支同步规则 |
| `deploy.json` | 部署机选择 + 启动配置（仅跨机器部署时需要） |

#### 设计原则

- **编译机不重复定义** — 从 `sync-config.json` 的 `selectedServer` 读取
- **不配置编译命令** — 远程 compilot 自己 detect 环境、读 .pro 文件、生成命令
- **不配置产物路径** — 远程 compilot 编译后输出产物位置（从 Makefile 解析）
- **不配置部署目录** — 使用部署机 server 的 `remotePath`
- **不配置停止命令** — 默认从 launch.command 提取可执行文件名，`pkill -x <name> || true`
- **单机场景零配置** — 只需 `sync-config.json` 选好编译机，`run --remote` 直接可用

---

## 多仓库分支同步

### 问题

工作空间下多个仓库有依赖关系，远程编译前必须确保所有仓库分支一致，否则编译会因接口不匹配而失败。

### 策略

1. 扫描本地工作空间所有 git 仓库，读取当前分支
2. SSH 到编译机，对每个仓库：
   - 如果在 `pinned` 中 → 切到指定分支
   - 否则 → 切到和本地相同的分支
3. 每个仓库的切换流程：
   - 检查是否有未提交改动 → stash
   - `git fetch`
   - `git checkout <branch>`
   - `git pull`
   - stash pop（如果之前 stash 了）
4. 任一仓库失败 → 报告失败原因，中止后续流程

### 安全检查

- 远程有未提交改动时警告
- 本地分支未 push 时提示
- 冲突时中止并报告

---

## 远程编译

SSH 到编译机（`sync-config.json` 的 `selectedServer`）执行：

```bash
cd /home/dev/workspace/myapp && compilot qt build --execute --json --brief
```

- compilot 在远程自行 detect Qt 环境
- compilot 在远程自行读取项目 .pro 文件
- compilot 在远程自行生成 qmake + make 命令并执行
- 编译结果通过 JSON 输出返回（ok/errors/产物路径）
- 增量编译：make 本身只重新编译改动的文件，无需额外缓存机制

SDK 项目同理：

```bash
cd /home/dev/workspace/core-lib && compilot sdk build --execute --json --brief
```

多个有依赖的项目由调用者控制顺序，逐个调用。

---

## 产物传输

仅在有 `deploy.json`（跨机器部署）时发生。同一台机器时不需要传输，`compilot qt run` 直接在编译机上运行。

传输方式：从编译机 SCP 到部署机。如果编译机和部署机网络不直通，则通过本地中继（编译机 → 本地 → 部署机）。

- 产物路径：由远程 compilot 编译后的 JSON 输出提供
- 目标路径：部署机 server 的 `remotePath`

---

## 停止与启动

### 停止旧进程

从 `launch.command` 提取可执行文件名（如 `./myapp` → `myapp`），SSH 到部署机执行：

```bash
pkill -x myapp || true
```

如果配置了 `stopCommand`，则使用自定义命令（如 `systemctl stop myapp`）。

### 启动程序

SSH 到部署机，在 `remotePath` 目录下执行：

```bash
# bg 模式
cd /opt/app && nohup ./myapp >/dev/null 2>&1 &

# fg 模式
cd /opt/app && ./myapp
```

---

## CLI 使用

所有现有命令加 `--remote` 即为远程版本：

```bash
# 远程 qmake
compilot qt qmake --remote --execute

# 远程编译（同步代码 + 编译）
compilot qt build --remote --execute

# 远程运行（同步 + 编译 + 传输产物 + 停止旧进程 + 启动）
compilot qt run --remote --execute

# 远程停止
compilot qt stop --remote --execute

# 预览会执行什么（dry-run）
compilot qt run --remote

# JSON 输出
compilot qt build --remote --execute --json --brief
```

多项目按顺序编译（调用者控制）：

```bash
compilot sdk build --remote --workspace ./core-lib --execute
compilot qt run --remote --execute
```

---

## VSCode 交互设计

### 状态栏

现有状态栏 3 个按钮不变：

```
[$(tools) myapp · Debug x86]  [$(play)]  [$(debug-alt)]
```

- 左边：项目名 + 模式，点击弹出 QuickPick 操作菜单
- 中间：Run 按钮（▶ 运行 / ■ 停止 / 旋转编译中）
- 右边：Debug 按钮

选择远程模式后，左边文字追加"· 远程"标识：

```
[$(tools) myapp · Debug x86 · 远程]  [$(play)]  [$(debug-alt)]
```

### QuickPick 操作菜单

点击左边按钮弹出的菜单新增"执行位置"分组：

```
── 模式 ──
  $(bug) Debug x86            当前
  $(bug) Debug x64
  $(package) Release x86
  $(package) Release x64
── 执行位置 ──
  $(device-desktop) 本地      当前
  $(remote) 远程 — 编译机
── 构建 ──
  $(gear) QMake
  $(tools) Build
  $(trash) Clean
── 项目 ──
  $(folder) 切换项目...
```

- 选"远程"后，Run/Build/QMake 自动走远程流程
- 首次选"远程"时如果没有 `sync-config.json` 的 `selectedServer`，提示先在配置面板添加服务器
- 切回"本地"恢复原有行为

### 远程模式下各按钮行为

| 按钮 | 本地模式（现有） | 远程模式（无 deploy.json） | 远程模式（有 deploy.json） |
|------|-----------------|---------------------------|---------------------------|
| QMake | 本地 qmake | SSH 编译机 `compilot qt qmake` | 同左 |
| Build | 本地 build | 同步 + SSH 编译机 `compilot qt build` | 同左 |
| Run | 本地 build + run | 同步 + SSH 编译机 `compilot qt run` | 同步 + 远程 build + 传输 + 部署机启动 |
| Stop | 本地 kill 进程 | SSH 编译机 `compilot qt stop` | SSH 部署机 kill 进程 |

- 无 `deploy.json`：Run 直接在编译机上编译+运行（和本地行为对称）
- 有 `deploy.json`：Run 走完整流水线（编译 → 传输 → 停止 → 启动）

### 配置面板

在现有折叠面板下新增"远程"区块：

```
COMPILOT: 配置

▶ 概览
▶ 环境
▶ 同步
▶ 远程
```

展开"远程"后：

```
▼ 远程

  ── 部署（可选，跨机器部署时配置）──

  部署机
  [部署机 ▾]

  启动命令
  [./myapp          ]

  启动模式
  [后台 ▾]
```

展开"同步"后新增分支同步区域：

```
▼ 同步

  ... (现有同步配置) ...

  ── 分支同步 ──
  [✓] 编译前同步分支

  固定分支
  third-party → main  [×]
  [+ 添加]
```

- 编译机在"同步"面板选择（`selectedServer`）
- 部署机在"远程"面板选择，下拉列表从 `servers.json` 读取
- 分支同步配置在"同步"面板，写入 `sync-config.json`
- 部署配置写入 `deploy.json`
- 部署机为空时，Run 直接在编译机上运行

Output Channel 实时显示各阶段日志。

---

## 新增模块

```
src/qt/deploy/
├── index.ts          # 流程编排（串联各阶段）
├── config.ts         # 读取 deploy.json + sync-config.json + servers.json
├── types.ts          # DeployConfig, LaunchConfig 等类型
├── sshExec.ts        # SSH 连接 + 命令执行
├── transfer.ts       # 产物传输（SCP/cp）
├── branchSync.ts     # 多仓库分支同步
└── launcher.ts       # 停止旧进程 + 启动新程序
```

### 与现有模块的关系

- `deploy/config.ts` → 读取 `serverStore.ts` 的 ServerConfig + `sync-config.json` 的 selectedServer
- `deploy/sshExec.ts` → 复用 `transport.ts` 的 SSH/SCP spawn 方式
- `deploy/index.ts` → 调用现有 `sync` 模块完成代码推送

### CLI 入口

在 `src/qt/cli/index.ts` 中，所有 action（qmake/build/run/stop）新增 `--remote` flag。

### VSCode 入口

现有命令（`compilot.qt.qmake`、`compilot.qt.build`、`compilot.qt.run`、`compilot.qt.stop`）根据当前执行位置状态（本地/远程）自动切换行为，不新增命令。

---

## 日志输出

`compilot qt run --remote --execute` 执行时按阶段输出日志到 Output Channel：

```
▶ 分支同步 (3 个仓库)
  core-lib:    main → feature/api-v2  ✓
  myapp:       main → feature/api-v2  ✓
  third-party: main (pinned)          ✓

▶ 代码同步
  检测到 5 个变更文件
  src/main.cpp → 已上传
  src/widget.h → 已上传
  ...
  ✓ 同步完成

▶ 远程编译
  $ compilot qt build --execute
  ...
  ✓ 编译完成

▶ 传输产物
  myapp → 192.168.1.200:/opt/app/myapp
  ✓ 传输完成

▶ 停止旧进程
  $ pkill -x myapp || true
  ✓ 已停止

▶ 启动程序
  $ cd /opt/app && nohup ./myapp >/dev/null 2>&1 &
  ✓ 已启动

🎉 完成
```

---

## 依赖

不引入新的 npm 依赖。SSH/SCP 操作通过 spawn 系统 `ssh`/`scp` 命令实现（和现有 sync 模块一致）。

远程机器需要安装 compilot CLI（`npm install -g compilot`）。

---

## 后续可扩展

- 支持 Windows 远程编译机
- 支持 systemctl 管理的服务重启
- 支持产物传输到多个部署机
- 支持并行编译无依赖的 targets
