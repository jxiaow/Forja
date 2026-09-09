# Remote Mode & Deploy 设计文档

> 日期：2026-09-08
> 状态：设计中

## 一、背景

当前 Linux 构建部署流程全是手工操作：

1. 本地修改代码
2. `forja sync` 同步到编译服务器
3. SSH 到编译服务器，执行 `forja build`
4. 在实体机上通过 SFTP server + 浏览器下载可执行文件
5. 拷贝到实体机指定目录
6. 运行

目标：一键完成全链路。

### 环境拓扑

| 机器 | 系统 | 角色 |
|------|------|------|
| 本地 | Windows | 写代码 |
| 编译服务器 | Linux | SSH + forja build |
| 实体机 | Linux | 运行 Qt GUI 应用 |

### 关键约束

- 代码仓库：一个目录下包含多个 git repo（Qt 仓库 + SDK 仓库等）
- SDK 仓库大、编译耗时久，必须增量编译（不能每次 fresh clone）
- 实体机 SSH 可能是 password auth（不一定有 SSH key）
- 某个 repo 在 Windows 和 Linux 上内容可能不同（但分支相同）
- 编译服务器是 git repo

## 二、核心概念：远程模式

一个持久化开关。开启后，`build/status/run/stop/clean` 自动走远程路径，不需要 `--remote` flag。

```bash
forja remote on     →  后续 build/status/run 都是远程
forja remote off    →  恢复本地
forja sync          →  不受模式影响，始终本地→远程同步
forja deploy        →  不受模式影响，部署产物到实体机
```

## 三、命令设计

### 3.1 `forja remote` 子命令

| 命令 | 功能 | 状态 |
|------|------|------|
| `forja remote on` | 开启远程模式（持久化到 workspace settings） | 新增 |
| `forja remote off` | 关闭远程模式 | 新增 |
| `forja remote check` | 检查各 repo 分支+commit，不同则询问用户 | 新增 |
| `forja remote bootstrap` | 安装 forja 到远程 | 保留 |
| ~~`forja remote`~~ | ~~显示远程配置~~ | **删除**（`forja status` 覆盖） |
| ~~`forja remote setup`~~ | ~~配置服务器+路径~~ | **删除**（`forja sync` 交互引导覆盖） |

### 3.2 受远程模式影响的命令

| 命令 | 本地模式 | 远程模式 |
|------|----------|----------|
| `forja build` | 本地构建 | 远程构建（通过 `executeRemotePlan`） |
| `forja build --download` | — | 远程构建 + 下载产物到本地 |
| `forja status` | 本地状态 | 远程状态 |
| `forja run` | 本地运行 | 远程运行 |
| `forja stop` | 本地停止 | 远程停止 |
| `forja clean` | 本地清理 | 远程清理 |

### 3.3 不受模式影响的命令

| 命令 | 说明 |
|------|------|
| `forja sync` | 始终本地→远程文件同步 |
| `forja deploy` | 下载产物 + 上传到实体机（新顶级命令） |
| `forja deploy config` | 配置部署目标/路径/产物 |
| `forja init` / `forja list` / `forja use` / `forja server` | 配置类，跟模式无关 |

## 四、`forja remote check` 详细设计

### 流程

```
1. 获取本地状态
   ├── localBranch = git rev-parse --abbrev-ref HEAD
   └── localCommit = git rev-parse HEAD

2. 获取远程状态（通过 SSH）
   ├── remoteBranch = ssh build-server "cd <path> && git rev-parse --abbrev-ref HEAD"
   ├── remoteCommit = ssh build-server "cd <path> && git rev-parse HEAD"
   └── remoteDirty  = ssh build-server "cd <path> && git status --porcelain"

3. 对比判定（per repo）
   ├── 分支不同 → 询问用户
   ├── commit 不同 → 询问用户
   └── 远程有 dirty → 提示
```

### 输出示例

```
$ forja remote check

检查代码一致性...

  qt-app:
    分支: master ✓
    commit: a1b2c3d (本地) vs e4f5g6h (远程) ✗ 远程落后

  cpp-sdk:
    分支: develop ✓
    commit: x7y8z9w ✓ 一致

⚠ qt-app commit 不一致
  1. 以本地为准 → 远程 reset 到本地 commit
  2. 拉取到本地 → 暂停，先 git pull
  3. 忽略
```

### 处理策略

| 场景 | 处理方式 |
|------|----------|
| 分支不同 | 询问：切换分支 / 忽略 / 取消 |
| commit 不同（远程落后） | 询问：以本地为准 / 拉取 / 忽略 |
| commit 不同（远程领先） | 询问：以本地为准 / 拉取 / 取消 |
| 远程有 dirty | 提示：远程有未提交修改 |

每次询问，不自动处理。

## 五、`forja deploy` 详细设计

### 传输策略

优先 SSH，SSH 不行降级到 HTTP：

```
forja deploy
│
├── 1. scpDownload：从编译服务器下载产物到本地临时目录
│
├── 2. 尝试 SSH/SCP 直推到实体机
│   ├── 成功 → 完成
│   └── 失败 → 降级
│
└── 3. 降级：编译机起临时 HTTP 服务
    └── 输出下载链接，用户在实体机浏览器下载
```

### SSH 成功时

```
$ forja deploy
📥 下载产物... MyApp (12.3 MB) ✓
📤 部署到实体机 (SSH)... ✓
✅ 部署完成
```

### SSH 失败时

```
$ forja deploy
📥 下载产物... MyApp (12.3 MB) ✓
📤 部署到实体机 (SSH)... 连接失败
🌐 启动临时 HTTP 服务...
   下载地址: http://192.168.1.50:8080/MyApp
   请在实体机浏览器中下载并放到目标目录
   按 Enter 完成后关闭服务...
```

### 配置

```bash
# 一次性配置
forja server add --name target --host 192.168.1.100 --user deploy
forja deploy config --server target --deploy-path /opt/myapp --artifact MyApp
```

配置存储在 `RemoteTransferSettings`（已有数据模型）：
- `deployServer`: 实体机 server ID
- `deployPath`: 实体机上的目标目录
- `artifacts`: 产物相对路径列表

## 六、数据流总览

```
本地 (Windows)                     编译服务器 (Linux)              实体机 (Linux)
                                   
forja sync ─────────────SCP────────→ 代码仓库                       
                                   
forja build ────────────SSH────────→ forja build                    
         ←───────────SCP download── 产物         ───SCP upload──→ 部署目录
                                   
forja remote check ────SSH────────→ 检查分支/commit                
                                   
forja remote on/off ──────────────→ 切换模式（持久化）              
```

## 七、文件变更清单

| 文件 | 变更类型 | 内容 |
|------|----------|------|
| `src/core/settingsIO.ts` | 修改 | `RemoteSettings` +`remoteMode: boolean` |
| `src/core/sshTransport.ts` | 修改 | +`scpDownload()` 函数 |
| `src/cli/commands/remote.ts` | 修改 | +`on`/`off`/`check` 子命令，删除 `setup` 和裸 `show` |
| `src/cli/commands/build.ts` | 修改 | remoteMode 路由 + `--download` flag |
| `src/cli/commands/status.ts` | 修改 | remoteMode 路由 |
| `src/cli/commands/run.ts` | 修改 | remoteMode 路由 |
| `src/cli/commands/stop.ts` | 修改 | remoteMode 路由 |
| `src/cli/commands/clean.ts` | 修改 | remoteMode 路由 |
| `src/cli/commands/deploy.ts` | **新建** | deploy + deploy config |
| `src/cli/commands/index.ts` | 修改 | 注册 deploy + remote 新子命令 + 删除 remote setup/show + 命令路由 |
| `src/cli/commands/types.ts` | 修改 | 新增翻译 key |

## 八、实现顺序

| 步骤 | 内容 | 依赖 |
|------|------|------|
| 1 | `remoteMode` 开关 + 持久化（`remote on/off`） | 无 |
| 2 | 命令路由（remoteMode 开启时 build/status/run/stop/clean 走远程路径） | 步骤 1 |
| 3 | `forja remote check`（一致性检查） | 步骤 1 |
| 4 | `scpDownload()` 基础函数 | 无 |
| 5 | `forja build --download`（远程构建+下载） | 步骤 2 + 4 |
| 6 | `forja deploy` + `deploy config` | 步骤 4 |
| 7 | 清理：删除 `remote setup` 和裸 `remote show` | 步骤 1 |

## 九、典型使用流程

```bash
# 首次配置
forja sync                          # 交互式配置远程服务器+路径
forja remote bootstrap              # 安装 forja 到远程
forja remote on                     # 开启远程模式
forja server add --name target ...  # 添加实体机
forja deploy config ...             # 配置部署目标

# 日常工作
forja sync              # 上传代码
forja remote check      # 检查一致性（可选）
forja build             # 远程构建（因为 remote on）
forja build --download  # 远程构建+下载产物到本地
forja deploy            # 部署到实体机
```

## 十、补充决议

### 10.1 HTTP 降级方案

SSH 推送到实体机失败时，在编译服务器上临时起 HTTP 服务：

```
1. SSH 到编译服务器
2. 在产物目录执行 python3 -m http.server <port>
3. 输出下载 URL
4. 等待用户按 Enter
5. SSH 到编译服务器，关闭 HTTP 服务
```

### 10.2 产物路径确定

优先级：
1. `--artifact <path>` 命令行指定（最高）
2. `deploy config` 中配置的 `artifacts`
3. 从 target 的 build output 路径自动推导

### 10.3 deploy vs build --download

| 命令 | 流程 |
|------|------|
| `forja build --download` | sync + 远程 build + scpDownload 到本地 |
| `forja deploy` | sync + 远程 build + scpDownload + scpUpload 到实体机 |

`deploy` 是全流程，`build --download` 只到本地。

### 10.4 diverged 处理

与 remote behind/ahead 相同——询问用户选择，不自动处理。

### 10.5 模式可见性

`forja status` 输出中显示当前模式：

```
$ forja status
模式: 远程 (dev-server)
...
```

删除 `forja remote` 裸命令后，这是查看模式的唯一入口。

### 10.6 scpDownload 支持范围

- 单文件下载
- 目录递归下载（`scp -r`）
- 产物可能是单个可执行文件，也可能是包含 .so 的目录

### 10.7 JSON 输出

所有新增命令支持 `--json` flag：
- `forja remote on/off` → `{ ok: true, action: "remote", remoteAction: "on" }`
- `forja remote check` → `{ ok: true, action: "remote", remoteAction: "check", repos: [...] }`
- `forja deploy` → `{ ok: true, action: "deploy", transferred: [...] }`
- `forja deploy config` → `{ ok: true, action: "deploy", deployAction: "config" }`

### 10.8 远程 build 自动 sync

远程模式下 `forja build` 自动先 sync（`executeRemotePlan` → `prepareRemoteWorkspace` 已内置 overlay sync）。用户不需要手动先跑 `forja sync`。

但独立的 `forja sync` 命令仍然有用——用户可能只想同步代码不构建。

## 十一、验证方式

1. `forja remote on` → `forja status` 显示 "模式: 远程"
2. `forja remote off` → `forja status` 显示 "模式: 本地"
3. `forja remote check` → 正确报告分支/commit 差异并询问用户
4. `forja build`（远程模式）→ 自动 sync + 远程构建
5. `forja build --download` → 构建后产物下载到本地（支持文件和目录）
6. `forja deploy`（SSH 可用）→ 全流程：build + download + upload 到实体机
7. `forja deploy`（SSH 不可用）→ 降级到编译机临时 HTTP 服务
8. `forja deploy --artifact <path>` → 使用指定的产物路径
9. 所有新命令 `--json` 输出格式正确

## 十二、复用的已有基础设施

| 模块 | 文件 | 用途 |
|------|------|------|
| `executeRemotePlan` | `src/remote/core/plan.ts` | 远程构建（已实现，未接 CLI） |
| `executePreparedRemoteAction` | `src/remote/core/pipeline.ts` | 远程管道编排 |
| `executeRemoteBridge` | `src/remote/core/bridge.ts` | SSH 执行远程 forja 命令 |
| `RemoteTransferSettings` | `src/core/settingsIO.ts` | 部署配置数据模型（已定义，未接 CLI） |
| `executeRemoteTransfer` | `src/remote/core/transfer.ts` | 远程间传输（可参考，deploy 用本地中继） |
| `scpUpload` | `src/core/sshTransport.ts` | SCP 上传（复用） |
| `createAskpassEnv` | `src/core/ssh.ts` | SSH password auth（复用） |
| `createSshRunner` | `src/remote/core/shell.ts` | SSH runner（复用） |
| `createScpUploader` | `src/remote/core/shell.ts` | SCP uploader（复用） |
