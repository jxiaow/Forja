# 远程编译部署方案 v2（详细版）

## 一、场景描述

### 本地目录结构

```
/workspace/              ← 父目录（非 git 仓库）
├── qt-app/              ← git 仓库，Qt 项目
├── sdk-lib/             ← git 仓库，SDK 库
├── third-party/         ← git 仓库，第三方依赖
└── ...
```

### 远程目录结构（和本地一致）

```
/home/dev/workspace/     ← remotePath 指向这里
├── qt-app/              ← 可能有 .git（clone 的），也可能没有（纯推送的）
├── sdk-lib/
├── third-party/
└── ...
```

### VSCode 打开方式

| 方式 | 打开内容 | resolveGitRoots 结果 | sync 推送范围 |
|------|---------|---------------------|--------------|
| 1 | 多文件夹（qt-app + sdk-lib） | [qt-app, sdk-lib] | 两个仓库的变更 |
| 2 | 打开父目录 | [qt-app, sdk-lib, third-party, ...] | 所有子仓库的变更 |
| 3 | 只开 qt-app | [qt-app] | 只有 qt-app 的变更 |

### 两种远程状态

| 状态 | 远程有 .git | 远程无 .git |
|------|-----------|------------|
| branchSync | 可用（git fetch + checkout + pull） | 跳过该仓库 |
| baselineCheck | 可用（比对 commit） | 跳过该仓库 |
| sync | 推送未 commit 的变更文件 | 推送未 commit 的变更文件（行为相同） |
| 初始化 | git clone 或全量推送 | 全量推送 |

注意：sync 的行为不受远程是否有 .git 影响——它始终从本地 `git diff` 获取变更文件列表然后 SCP 推送。区别只在于 branchSync 和 baselineCheck 是否可用。

多仓库时逐仓库判断：有 .git 的做 branchSync/baselineCheck，没有的跳过。

---

## 二、流水线

用户点一次"远程 Run"后自动按顺序执行：

```
探测 → branchSync → sync → baselineCheck → build → [transfer] → stop → launch
```

### 阶段详解

#### 阶段 0：探测（每次执行）

SSH 检测当前工作区包含的各仓库在远程是否有 .git：

```bash
test -d /home/dev/workspace/qt-app/.git && echo "git:qt-app"
```

结果决定后续 branchSync 和 baselineCheck 是否执行。不缓存，每次都探测（走 ControlMaster 开销极小）。

#### 阶段 1：branchSync（远程有 .git 时）

对当前工作区包含的每个仓库，SSH 到远程执行：

```bash
cd /home/dev/workspace/qt-app
git checkout -- .          # 丢弃 dirty（上次 sync 推上去的残留）
git fetch
git checkout <本地当前分支名>
git pull --ff-only
```

**为什么先 checkout -- . 而不是 stash**：远程的 dirty 文件是上次 sync 推上去的未 commit 改动，不需要保留。丢弃后 pull 拿到最新 committed 代码，然后 sync 阶段会重新推送本地当前的未 commit 改动覆盖上去。

**pinned 仓库**：配置了 pinned 的仓库切到指定分支而非本地当前分支。

**失败处理**：
- fetch 失败（网络不通）→ 报错停止，提示检查网络或改用无 .git 模式
- checkout 失败（分支不存在）→ 报错停止
- pull --ff-only 失败（有 diverge）→ 报错停止，提示手动处理

**跳过条件**：
- 该仓库远程没有 .git
- --fast 模式

#### 阶段 2：sync

调用现有 syncCli 逻辑（通过 syncFn 注入），推送当前工作区包含的所有仓库的变更文件。

流程：
1. 对每个仓库执行 `git diff --name-only` 获取变更文件
2. 过滤 ignore 列表
3. 过滤 mtime 未变化的文件（已同步过的跳过）
4. SCP 逐文件上传到 `remotePath/<repoName>/<relativePath>`
5. 上传成功后更新 syncState

**不弹窗选择**：远程 Run 流程中的 sync 直接同步所有工作区仓库，不弹 QuickPick。

**无变更时**：0 个文件需要推送，阶段秒过，不报错。

#### 阶段 3：baselineCheck（远程有 .git 时）

校验远程代码状态和本地一致：

```bash
cd /home/dev/workspace/qt-app
git rev-parse --short HEAD    # 远程 commit
git status --porcelain        # 远程 dirty 文件列表
```

本地也执行同样命令，比对：
- commit hash 一致 → 通过
- commit hash 不一致 → 报错"远程 commit 和本地不一致，branchSync 可能失败了"
- 远程 dirty 文件应该是 sync 刚推上去的那些，如果多出未知文件 → 警告但不阻塞

**跳过条件**：远程没有 .git、--fast 模式

#### 阶段 4：build

SSH 到远程执行编译命令。

**确定编译目标**：
- 用户从 Qt 模块触发 → 编译 Qt
- 用户从 SDK 模块触发 → 编译 SDK
- 配了 buildOrder → 按顺序编译，但只编译当前工作区包含的仓库对应的项目

**确定工作目录**：`remotePath/<repoName>/`

**命令选择**：
1. 先检测远程 compilot 版本：`compilot --version 2>/dev/null`
2. 有 compilot（≥ 0.7.0）：
   - Qt：`cd remotePath/qt-app && compilot qt build --json`
   - SDK：`cd remotePath/sdk-lib && compilot sdk build --json`
3. 没有 compilot：
   - `cd remotePath/qt-app && make -j$(nproc)`
   - 没有 Makefile → 报错"请先运行 qmake 或安装远程 compilot"

**超时**：无超时（编译时间不可预测），用户可手动取消。

**编译错误**：
- 有 compilot：解析 JSON 输出的 errors 字段
- 没有 compilot：从 stdout/stderr 中正则匹配错误行（`: error` 模式）

#### 阶段 5：transfer（仅跨机器模式）

当配置了 deploy.server（部署机和编译机不是同一台）时执行。

从编译机 SCP 产物到部署机：
- 产物来源：compilot build --json 输出的 artifacts 字段 + deploy.extraArtifacts glob
- 没有 compilot 时：只用 deploy.extraArtifacts（用户必须配）

**单机模式跳过此阶段。**

#### 阶段 6：stop

杀掉远程旧进程。

**单机模式**：
- 有 compilot：`compilot qt stop`（Qt）或用 deploy.stopCommand
- 没有 compilot 且有 deploy.stopCommand：执行 stopCommand
- 没有 compilot 且没有 stopCommand：报错"请配置停止命令或安装远程 compilot"

**跨机器模式**：
- SSH 到部署机执行 deploy.stopCommand
- 没配 stopCommand：从 deploy.launchCommand 提取进程名，`pkill -x <name>`

#### 阶段 7：launch

启动新程序。

**单机 Qt**：
- 有 compilot：从 build 阶段的 JSON 输出中获取可执行文件路径，SSH 直接执行
- 没有 compilot：需要 deploy.launchCommand，否则报错

**单机 SDK**：
- 必须配 deploy.launchCommand（SDK 没有内置 run 逻辑）
- 没配 → 报错"SDK 远程运行需要配置启动命令"

**跨机器**：
- SSH 到部署机执行 deploy.launchCommand
- bg 模式：`nohup <command> > <logFile> 2>&1 &`
- fg 模式：跨机器不支持，自动降级为 bg 并提示

---

## 三、数据结构

### 3.1 存储位置

所有配置在 `~/.compilot/projects/` 下，和现有 qt/sdk/sync 同构：

```
~/.compilot/
├── servers.json                              # 全局服务器列表
├── projects/
│   ├── <hash(workspace:qt)>.json             # Qt 配置
│   ├── <hash(workspace:sdk)>.json            # SDK 配置
│   ├── <hash(workspace:sync)>.json           # 同步配置（现有）
│   └── <hash(workspace:remote)>.json         # 远程部署配置（新增）
├── remote-state/
│   └── <workspace-hash>.json                 # 执行状态（新增）
├── locks/
│   └── <workspace-hash>.lock                 # 并发锁（新增）
├── sync/
│   └── <hash>.json                           # 同步状态（现有）
└── sockets/                                  # ControlMaster socket（新增，Linux/macOS）
    └── <md5前8位>
```

### 3.2 RemoteSettings（新增 type=remote）

```typescript
interface RemoteSettings {
    /** 分支同步配置 */
    branchSync?: {
        enabled: boolean;
        /** 固定某些仓库到特定分支 { "third-party": "main" } */
        pinned?: Record<string, string>;
    };
    /** 编译顺序（可选，不配则只编译当前触发的模块） */
    buildOrder?: Array<{
        workspace: string;  // 相对路径，'.' 或 './sdk-lib'
        type: 'qt' | 'sdk';
    }>;
    /** 部署配置（可选，不配则单机模式） */
    deploy?: {
        /** 部署机 server id（从配置面板选择时存 id） */
        server?: string;
        /** 启动命令 */
        launchCommand: string;
        /** 启动模式 */
        launchMode: 'bg' | 'fg';
        /** 停止命令 */
        stopCommand?: string;
        /** 额外产物 glob */
        extraArtifacts?: string[];
        /** 日志文件路径 */
        logFile?: string;
    };
}
```

### 3.3 SyncSettings（不变）

```typescript
interface SyncSettings {
    enabled: boolean;
    selectedServer: string;           // 编译机 server id
    remotePaths: Record<string, string>; // serverId → 远程父目录路径
    ignore: string[];
}
```

远程部署直接读 SyncSettings 获取编译机信息和远程路径。

### 3.4 RemoteState（执行状态）

```typescript
interface RemoteState {
    lastExecution?: {
        timestamp: string;                    // ISO 时间
        headCommits: Record<string, string>;  // repoName → short commit hash
        failedStage: string | null;
    };
    /** 远程各仓库是否有 .git（探测结果，每次更新） */
    repoModes?: Record<string, 'git' | 'files'>;
}
```

### 3.5 并发锁

```typescript
interface LockInfo {
    pid: number;
    stage: string;
    startedAt: string;  // ISO 时间
}
```

stale 判断：进程不存在 → 清理；进程存在 → 不清理，报错提示用户；Windows 检测不确定 + 超 1 小时 → 清理。

---

## 四、模块结构

```
src/remote/
├── core/                      # 纯 Node，CLI + VSCode 共用
│   ├── index.ts               # 流程编排
│   ├── types.ts               # 类型定义
│   ├── sshExec.ts             # SSH 命令执行 + ControlMaster
│   ├── branchSync.ts          # 分支同步
│   ├── baselineCheck.ts       # 基线校验
│   ├── transfer.ts            # 产物传输
│   ├── launcher.ts            # stop + launch
│   ├── lock.ts                # 并发锁
│   └── state.ts               # RemoteState 读写
└── vscode/                    # VSCode 适配层
    ├── progressAdapter.ts     # 进度通知
    ├── diagnosticsAdapter.ts  # 编译错误 → Problems 面板
    └── outputAdapter.ts       # Output Channel 日志
```

### 依赖方向

```
remote/core/ → core/ssh.ts, core/serverStore.ts, core/gitRepoResolver.ts, core/settingsIO.ts
remote/core/ ✗ 不依赖 vscode
remote/core/ ✗ 不依赖 qt/ 或 sdk/
remote/vscode/ → remote/core/ + vscode API
```

sync 阶段通过 `DeployOptions.syncFn` 注入：

```typescript
interface DeployOptions {
    workspaceRoot: string;
    projectType: 'qt' | 'sdk';
    fast?: boolean;
    fromStage?: DeployStage;
    signal?: AbortSignal;
    callbacks?: Partial<DeployCallbacks>;
    /** 调用方注入的同步函数 */
    syncFn: (workspaceRoot: string) => Promise<{ ok: boolean; uploaded: string[]; failed: Array<{ error: string }> }>;
}
```

调用方（Qt CLI / VSCode 命令）构造 syncFn 时内部调用 syncCli 或 sftpClient。

---

## 五、SSH 连接复用

### ControlMaster（Linux/macOS）

流程开始时：
1. 检查 socket 是否存在且有效：`ssh -O check -o ControlPath=<path> <target>`
2. 无效或不存在 → 建立 master：`ssh -MNf -o ControlPath=<path> <target>`
3. 后续所有 ssh/scp 命令加 `-o ControlPath=<path>` 复用

流程结束时（成功或失败）：
- `ssh -O exit -o ControlPath=<path> <target>`

socket 路径：`~/.compilot/sockets/<md5(user@host:port)前8位>`

### Windows

不支持 ControlMaster，每次独立连接。密码模式下多次 ASKPASS 体验较差，建议用 SSH Key。

### 超时和保活

所有 SSH 命令加：`-o ServerAliveInterval=10 -o ServerAliveCountMax=3`（30 秒无响应判定断开）

---

## 六、取消机制

**VSCode**：Progress 通知上的取消按钮，或再次点击 Run 按钮

**CLI**：Ctrl+C

**取消时的处理**：
1. kill 当前正在执行的 SSH 子进程
2. 释放并发锁
3. 关闭 ControlMaster 连接
4. Output Channel 输出"⚠ 已取消（在 xxx 阶段）"

**不回滚**：已完成的阶段不撤销（branchSync 已切的分支不切回，sync 已推的文件不删）。

---

## 六、编译错误映射

远程编译失败时，将远程路径映射为本地路径：

```
远程错误: /home/dev/workspace/qt-app/src/main.cpp:42:10: error: ...
                                ↓
去掉 remotePath 前缀: qt-app/src/main.cpp:42:10
                                ↓
拼上本地路径: C:/Code/workspace/qt-app/src/main.cpp:42:10
```

映射规则：
1. 从远程路径中去掉 `remotePath/` 前缀得到 `<repoName>/<relativePath>`
2. 在本地工作区中找到对应仓库的本地路径
3. 拼接得到本地绝对路径
4. 创建 `vscode.Diagnostic` 填入 DiagnosticCollection

映射失败时（路径不在工作空间内），仍在 Output Channel 显示原始错误。

---

## 七、快速模式

### 进入条件（全部满足）

1. 距上次执行 < 300 秒（可配置）
2. 当前工作区各仓库 HEAD commit 和上次执行时记录的一致
3. 上次失败阶段不是 branchSync 或 baselineCheck

### 效果

跳过：探测、branchSync、baselineCheck
只执行：sync → build → [transfer] → stop → launch

### 触发方式

- CLI：`compilot qt run --remote --fast`
- VSCode：自动判断，满足条件时进入快速模式，状态栏显示 ⚡

---

## 八、CLI 接口

### 现有命令加 --remote

```bash
compilot qt build --remote              # sync → build
compilot qt run --remote                # 全流程
compilot qt run --remote --fast         # 快速模式
compilot qt stop --remote               # 只 stop
compilot qt clean --remote              # SSH 远程 clean
compilot qt qmake --remote              # SSH 远程 qmake

compilot sdk build --remote             # sync → build
compilot sdk rebuild --remote           # sync → clean + build
compilot sdk clean --remote             # SSH 远程 clean
```

### 新增 remote 子命令

```bash
compilot remote test                    # 连接测试
compilot remote init                    # 远程初始化（clone 或全量推送）
compilot remote init --push             # 强制全量推送
```

### --from 断点续跑

```bash
compilot qt run --remote --from build   # 跳过 sync，直接编译+运行
compilot qt run --remote --from launch  # 跳过编译，直接启动（用上次的产物）
```

---

## 九、UI 设计

### 9.1 状态栏

```
本地模式：[$(tools) [Qt] myapp · Debug x86]  [$(play)]  [$(debug-alt)]
远程模式：[$(tools) [Qt] myapp · Debug x86 · 远程]  [$(play)]  [$(debug-alt)]
远程执行中：[$(tools) [Qt] myapp · Debug x86 · 远程]  [$(sync~spin) 编译中...]  [$(debug-alt)]
```

执行位置（本地/远程）存 `context.workspaceState`，重启后保持。

### 9.2 本地/远程切换

**切换方式**：点击状态栏项目按钮 → QuickPick → "执行位置"分组选择

**切换后各按钮行为**：

| 按钮/命令 | 本地模式（现有行为不变） | 远程模式 |
|-----------|----------------------|---------|
| Run (▶) | 本地 build + run | 远程流水线（sync → build → stop → launch） |
| Build | 本地 build | sync → 远程 build |
| QMake | 本地 qmake | sync → 远程 qmake |
| Clean | 本地 clean | 远程 clean（不 sync） |
| Stop (■) | 本地 kill 进程 | 远程 stop |
| Debug | 本地 debug | 提示"远程模式不支持调试" |

**前置条件**：切换到远程时，如果 sync 没开启或没配置服务器，弹通知"请先在同步配置中选择服务器"，不切换。

### 9.3 QuickPick 菜单

```
── 模式 ──
  $(bug) Debug x86            当前
  $(bug) Debug x64
  $(package) Release x86
  $(package) Release x64
── 执行位置 ──
  $(device-desktop) 本地      当前
  $(remote) 远程
── 构建 ──
  $(gear) QMake
  $(tools) Build
  $(package) RCC
  $(trash) Clean
── 远程 ──                    ← 仅远程模式下显示
  $(debug-restart) Restart（不重新编译）
  $(output) 远程日志
── 项目 ──
  $(list-tree) 选择项目...
  $(folder) 切换到 Qt/SDK 模块
```

### 9.3 配置面板（同步 tab 扩展）

在现有"同步"tab 的内容下方追加：

```
▼ 远程同步（现有内容）
  同步开关、服务器、远程路径、忽略列表

▼ 分支同步（新增）
  [✓] 编译前同步远程分支
  固定分支：
    third-party → main  [×]
    [+ 添加]

▼ 编译顺序（新增，折叠，高级）
  1. ./sdk-lib  (SDK)   [↑] [↓] [×]
  2. .          (Qt)    [↑] [↓] [×]
  [+ 添加]

▼ 部署（新增）
  部署机：[选择服务器 ▾]（留空 = 编译机直接运行）
  启动命令：[./myapp          ]
  启动模式：[后台 ▾]
  停止命令：[pkill -x myapp   ]（留空 = 自动）
```

### 9.4 远程执行时的进度反馈

- **状态栏**：Run 按钮变为 `$(sync~spin)` + 当前阶段文字
- **Progress 通知**：`window.withProgress` 显示 "远程部署 (3/5): 编译中..."
- **Output Channel**：`Compilot: Remote` 输出每个阶段的详细日志

---

## 十、初始化流程

### compilot remote init

1. 读取 sync 配置获取编译机和 remotePath
2. SSH 测试连接
3. `mkdir -p <remotePath>`
4. 对当前工作区每个仓库：
   - SSH `test -d <remotePath>/<repoName>/.git`
   - 已存在 → 跳过
   - 不存在 → 读取本地 `git remote get-url origin`
     - 有 origin → SSH 远程 `git clone <url> <remotePath>/<repoName>`
     - clone 失败或无 origin → 提示用 `--push`

### compilot remote init --push

对当前工作区每个仓库：
- `scp -r <localRepo>/ <remote>:<remotePath>/<repoName>/`
- 或用 rsync（如果可用）：`rsync -az --progress <localRepo>/ <remote>:<remotePath>/<repoName>/`

推送完成后如果有 .git：
- SSH 执行 `cd <remotePath>/<repoName> && git remote set-url origin <原始URL>`

---

## 十一、实现步骤

| 步骤 | 内容 | 前置 |
|------|------|------|
| 1 | settingsIO 新增 loadRemoteSettings/saveRemoteSettings | 无 |
| 2 | remote/core/types.ts — 类型定义 | 无 |
| 3 | remote/core/sshExec.ts — SSH 执行 + ControlMaster | core/ssh.ts |
| 4 | remote/core/lock.ts + state.ts | 无 |
| 5 | remote/core/branchSync.ts | sshExec |
| 6 | remote/core/baselineCheck.ts | sshExec |
| 7 | remote/core/launcher.ts + transfer.ts | sshExec |
| 8 | remote/core/index.ts — 流程编排 | 步骤 1-7 |
| 9 | Qt CLI --remote + remote 子命令 | 步骤 8 |
| 10 | SDK CLI --remote | 步骤 8 |
| 11 | remote/vscode/ 适配层 | 步骤 8 |
| 12 | 状态栏远程模式 + QuickPick | 步骤 11 |
| 13 | 配置面板 UI 扩展 | 步骤 1 |

---

_更新时间: 2026-05-21_
