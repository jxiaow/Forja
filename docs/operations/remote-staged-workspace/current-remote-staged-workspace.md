# Remote Staged Workspace 方案

> Status date: 2026-06-12

本文记录 `forja remote` 后续实现要遵守的完整策略。当前结论：远程构建不应直接覆盖用户已有 Linux 工作区，而应由 Forja 维护一个可重建的远端 staged workspace，并用显式 repo 角色和基线策略决定每个仓库如何处理。

## 0. 当前实现状态

截至 2026-06-12，本方案已落地的部分：

- remote settings 已支持 `workspaceMode`、`profile`、`remoteWorkspace`、`repos`。
- CLI 已支持 `forja remote workspace status|use|clear` 和 `forja remote repo list|set|remove|clear`，`remote repo set` 支持 `--asset local[=remote]` 声明被 git ignore 的本地依赖资产。
- `forja remote status --json` 在 staged 模式下会输出 `remotePlan`，即使远端 Forja CLI 缺失，也会继续完成本地/远端 repo 策略规划，并给出 `forja remote bootstrap` nextAction。
- staged pipeline 已接入 `baselinePlan -> acquireLock -> stagedWorkspacePrepare -> bundleBaseline -> workspaceLink -> overlaySync -> baselineCheck`。
- bundle baseline 和 workspace link 已通过单元测试和 WSL smoke 验证。
- staged overlay 已支持 repo assets：即使本地 SDK/headers 被 `.gitignore` 忽略，也可按配置上传；`local=remote` 可处理 Windows/Linux 目录名或大小写差异。
- CLI 已支持 `forja remote forja-bin status|use|clear`，可为远端 Forja 指定带环境初始化的 wrapper，例如补齐 Qt/ICU 的 `LD_LIBRARY_PATH`。
- staged pipeline 在远端 Forja CLI 缺失或不可执行时，已支持 Qt `qmake/build/clean/run/ps/stop` 和 SDK `build/rebuild/clean` 的 POSIX shell fallback。fallback 不使用 Windows 本地 Qt/VS 配置，只在远端 staged workspace 内查找 `.pro` 或 `Makefile` 并执行 `qmake` / `make`；`run/ps/stop` 使用 staged workspace 内的 `.forja/run-state` 记录最小进程状态。

仍未完整落地的部分：

- staged clean/reset/profile remove 生命周期命令还未作为 CLI 用户入口完整暴露。
- 真实 `qt_client` 项目构建尚未作为验收执行；目前只执行了受控临时 git repo 的 WSL smoke。

本轮复核（2026-06-12）：

- `npm test` 通过：352 pass，1 skip，0 fail。
- `npm run build:cli` 通过，CLI 包含 staged remote 相关模块。
- 使用临时 `FORJA_CONFIG_DIR` 重跑真实 `qt_client` 的只读 staged remote smoke 时，配置解析和 staged workspace plan 生效，但 SSH 在 `xw@172.31.158.44` 返回 `Permission denied (publickey,password)`；因此本轮未重跑真实 WSL status/test/build 验收。

## 1. 当前真实场景判断

已确认的测试环境：

| 位置 | 路径 | 当前状态 | Forja 处理方式 |
| --- | --- | --- | --- |
| Windows 本地 primary repo | `C:\Code\workspace\dev-private\qt_client` | 分支 `release_6.0_3.9_20231229c_custom_cvcs`，本地 HEAD `a51ba1f...`，对 upstream ahead | 作为本地源仓库 |
| WSL 已有 Linux repo | `/home/xw/workspace/dev/qt_client` | 分支 `master_6.0_3.11`，HEAD `eeb153...`，与 Windows 不同基线 | 只读检查，不覆盖 |
| WSL staged workspace | `/home/xw/workspace/forja-remote/<profile>/` | 由 Forja 创建和维护 | remote build 的真实执行目录 |

因此 `/home/xw/workspace/dev/qt_client` 应被分类为：

```text
existing-non-staged + baseline-mismatch + branch-mismatch
```

该分类的结果必须是 `blocked` 或 `status-only`，禁止自动 `reset --hard`、禁止自动 overlay、禁止自动删除。

## 2. 目标和非目标

目标：

- 让远端构建目录可恢复、可重建、可安全清理。
- 保证 primary repo 的远端基线和 Windows 本地当前 commit 一致。
- 支持远端无法访问 Git 仓库时，通过本地 git bundle 完成基线同步。
- 支持 Windows/Linux 仓库名或实现不同的情况，例如 `xylib_win32` 对应 `xylib_arm64`。
- 保持 Qt/qmake 依赖同级仓库的布局，不因单独同步 `qt_client` 导致编译路径断裂。

非目标：

- 不把用户已有 Linux workspace 当作默认同步目标。
- 不自动推断不同名字的仓库是同一个依赖。
- 不自动覆盖、重置或删除 remote-only 仓库。
- 不把普通 scp 全量覆盖作为基线同步降级方案。

## 3. 核心模型

远端能力应围绕一个staged workspace root 运转，而不是围绕单个 repo 运转。

推荐布局：

```text
/home/xw/workspace/forja-remote/<profile>/
  qt_client/
  xylib_arm64 -> /home/xw/workspace/dev/xylib_arm64
  other_dep/
```

其中：

- `qt_client/` 是 Forja 管理的 primary repo，可以 bundle、checkout、reset、overlay。
- `xylib_arm64` 可以是同 workspace 内的staged repo，也可以是指向已有 Linux repo 的 symlink。
- workspace root 需要有 Forja 管理记录，删除或 reset 前必须验证该记录。

建议配置模型：

```json
{
  "remote": {
    "workspaceMode": "staged",
    "profile": "release_6.0_3.9",
    "remoteWorkspace": "/home/xw/workspace/forja-remote/release_6.0_3.9",
    "repos": [
      {
        "localName": "qt_client",
        "remoteName": "qt_client",
        "role": "primary",
        "baseline": "auto",
        "overlay": true,
        "assets": [
          {
            "localPath": "XYMeetingKit_DLLs/NemoSDK/headers",
            "remotePath": "XYMeetingkit_DLLs/NemoSDK/headers"
          }
        ]
      },
      {
        "localName": "xylib_win32",
        "remoteName": "xylib_arm64",
        "role": "remote-only",
        "remotePath": "/home/xw/workspace/dev/xylib_arm64",
        "baseline": "status-only",
        "overlay": false,
        "mount": "symlink"
      }
    ]
  }
}
```

## 4. Repo 角色

| Role | 含义 | 允许动作 | 禁止动作 |
| --- | --- | --- | --- |
| `primary` | 当前本地要构建的主仓库 | baseline sync、overlay、构建入口解析 | 覆盖非staged路径 |
| `mapped` | Windows/Linux 同源但名字或路径显式映射的仓库 | 按策略 baseline sync，可选择 overlay | 自动猜测映射 |
| `remote-only` | 只存在于远端或 Linux 版本不同的依赖仓库 | status 检查、workspace link | overlay、reset、删除 |
| `existing-remote` | 用户已有远端仓库，例如 `/home/xw/workspace/dev/qt_client` | status 检查、诊断输出 | 作为默认同步目标 |
| `skip` | 当前 remote profile 不参与的仓库 | 不处理 | 参与 baseline 或 overlay |

默认规则：

- 只有 `primary` 和显式 `overlay: true` 的 `mapped` repo 可以同步本地文件。
- `remote-only` 必须保持只读语义。
- 不同 repo 名称必须显式配置，不允许按相似名称自动匹配。

## 5. 基线策略选择

Forja 应先做 plan，再执行。每个 repo 的策略按以下顺序选择：

1. `reuse-ready`
   - 条件：远端 repo 已经在目标 commit。
   - 动作：不做 git 同步，只进入 overlay 或构建阶段。

2. `git-pull`
   - 条件：本地 commit 已存在 upstream，远端可访问该仓库，远端 repo 是staged路径或明确允许更新。
   - 动作：远端 fetch/checkout/reset 到目标 commit。

3. `bundle-fetch`
   - 条件：远端 repo 已存在且由 Forja staged，本地 commit 不在远端可访问的 upstream，或远端无法访问仓库。
   - 动作：本地生成 git bundle，经 SSH 上传到远端，再由远端 `git fetch` bundle 并 checkout。

4. `bundle-clone`
   - 条件：远端staged repo 不存在，或目录为空。
   - 动作：本地生成 bundle，远端从 bundle 初始化 repo。

5. `status-only`
   - 条件：repo 是 `remote-only` 或 `existing-remote`。
   - 动作：只检查存在性、分支、commit、dirty 状态和可读性。

6. `blocked`
   - 条件：本地 behind/diverged、远端目录非空但非 git、远端非staged repo 与目标基线不一致、缺少 git、路径安全检查失败。
   - 动作：停止执行破坏性步骤，输出 diagnostics 和 nextActions。

禁止策略：

- 禁止在基线不一致时直接 scp 覆盖整个 repo。
- 禁止对非staged repo 自动 `reset --hard`。
- 禁止在未确认 mapping 时把 Windows `xylib_win32` 同步到 Linux `xylib_arm64`。

## 6. 远端无法访问 Git 仓库

如果远端无法访问 GitLab/Gitee/内部仓库：

- 对 `primary` 和staged `mapped` repo，选择 `bundle-clone` 或 `bundle-fetch`。
- 本地负责创建 bundle，远端只需要能执行 `git`。
- 如果远端缺少 `git`，结果必须是 `blocked`，提示安装 git 或切换到可用远端。
- 不允许降级为裸 scp 全量覆盖，因为该方式无法证明基线一致，也无法安全处理删除、重命名和子模块。

## 7. 远端无法安装 Forja CLI

远端 CLI 安装失败不应直接让整个 remote 能力失效。策略：

| 远端能力 | 使用方式 |
| --- | --- |
| 有 node/npm 且可写 `$HOME/.forja` | 可上传临时 Forja CLI 或 worker |
| 无 node/npm，但有 shell/git/构建工具 | 本地 Forja 编排，远端执行最小 shell 脚本 |
| 无 git | baseline 阶段 blocked |
| 无 qmake/make/构建工具 | target readiness blocked |

远端 shell fallback 只负责原子动作：创建目录、解包/读取 bundle、git checkout、建立 symlink、执行非交互构建命令、清理临时文件。策略判断仍在本地完成。

当前 shell fallback 覆盖：

- Qt：`qmake`、`build`、`clean`、`run`、`ps`、`stop`
- SDK：`build`、`rebuild`、`clean`

当前 shell fallback 限制：

- `qt run` 会先执行 `make`，再在构建目录下按最近修改时间查找可执行文件并用 `nohup` 后台启动；`qt ps/stop` 只读取 `.forja/run-state`，不提供远端 Forja CLI 的完整进程发现能力。
- 需要显式远端 Qt 路径、qmake spec 或复杂环境初始化的项目；这类项目应优先安装远端 Forja CLI，或在远端 shell 环境中预先配置 `qmake` / `make`。

## 8. 依赖仓库和同级路径

Qt/qmake 项目常依赖同级仓库，不能只同步 `qt_client` 一个目录。staged workspace 需要保持与真实开发 workspace 相同的相对路径关系。

处理规则：

- 如果依赖 repo 与本地同源，配置为 `mapped`，可参与 baseline sync。
- 如果依赖 repo 是 Linux 专用版本，配置为 `remote-only`。
- 如果构建脚本要求同级路径，Forja 在staged workspace 下创建 symlink：

```text
/home/xw/workspace/forja-remote/<profile>/xylib_arm64
  -> /home/xw/workspace/dev/xylib_arm64
```

- 如果远端系统不支持 symlink 或权限不足，结果应降级为 `blocked` 或使用显式 `remotePath` 直接构建，但不能复制并覆盖 remote-only 仓库。
- 如果主仓库依赖被 `.gitignore` 忽略的本地 SDK/headers，配置 `--asset <local>[=<remote>]`，由 overlay 阶段上传到staged repo 内。两侧路径都是仓库内相对路径；右侧用于 Linux 侧目录名和大小写与 Windows 不一致的情况，例如 `XYMeetingKit_DLLs/...=XYMeetingkit_DLLs/...`。

## 9. 生命周期和删除策略

分三层处理：

| 层级 | 示例 | 默认处理 | 何时删除 |
| --- | --- | --- | --- |
| 临时产物 | bundle、staging、临时 shell 脚本 | 成功后自动清理 | 失败时可短期保留用于诊断 |
| staged workspace | `/home/xw/workspace/forja-remote/<profile>` | 默认保留 | 用户执行 staged clean/reset/profile remove |
| 用户真实 workspace | `/home/xw/workspace/dev/qt_client` | 永不自动删除 | 不由 Forja 删除 |

删除前必须满足：

- 目标路径在 Forja staged registry 中。
- registry 记录匹配当前 server/workspace/profile。
- 目标不是 `remote-only` repo。
- 目标不是用户显式配置的真实 Linux workspace。

建议远端 registry：

```json
{
  "path": "/home/xw/workspace/forja-remote/release_6.0_3.9",
  "createdBy": "forja",
  "workspaceId": "qt-client-release-6.0-3.9",
  "serverId": "real-wsl",
  "repos": ["qt_client"],
  "createdAt": "2026-06-12T00:00:00.000Z"
}
```

一句话规则：staged区是可重建缓存，默认保留；真实远端工作区是用户资产，绝不自动删除。

## 10. Pipeline 行为

`forja remote status`：

- 只生成策略 plan。
- 检查本地 repo、远端 repo、远端工具链、workspace link、staged registry。
- 不做 checkout、reset、overlay、删除。

`forja remote qt build` / `forja remote sdk build`：

1. `targetReadiness`
2. `baselinePlan`
3. `acquireLock`
4. `stagedWorkspacePrepare`
5. `baselineApply`
6. `workspaceLink`
7. `overlaySync`
8. `baselineCheck`
9. `remoteAction`
10. `releaseLock`
11. `tempCleanup`

失败时：

- 已进入 lock 的流程必须尝试 release lock。
- 破坏性步骤前必须完成 plan 和安全检查。
- 输出中必须包含被阻塞 repo、阻塞原因和可执行 nextActions。

## 11. 当前环境推荐处理

当前这台机器/WSL 环境应这样配置和验证：

1. 不覆盖 `/home/xw/workspace/dev/qt_client`。
2. 创建staged workspace：`/home/xw/workspace/forja-remote/release_6.0_3.9`。
3. 将 Windows `qt_client` 作为 `primary`，用 bundle 建立远端同 commit 基线。
4. 将 Linux-only 依赖配置为 `remote-only`，通过 symlink 暴露到staged workspace。
5. 先跑 `remote status --json` 验证策略 plan。
6. 再跑受控 `remote qt build --json`，确认每个 stage 顺序和失败诊断。

## 12. 实施分期

| 阶段 | 目标 | 验证 |
| --- | --- | --- |
| Phase 1 | 增加 repo mapping 和 strategy planner | 单元测试覆盖角色分类和策略选择 |
| Phase 2 | 增加 staged workspace registry 和路径安全检查 | 单元测试覆盖允许/拒绝删除和 reset |
| Phase 3 | 增加 bundle-clone/bundle-fetch | 临时 git repo e2e 测试 |
| Phase 4 | 增加 workspace link/mount | 单元测试和 WSL smoke |
| Phase 5 | 接入 remote pipeline | pipeline stage 测试和真实 WSL smoke |
| Phase 6 | 文档和 CLI/JSON 输出收敛 | `npm test`、CLI 打包、remote status/build smoke |

实现时必须按 TDD：先写每个策略和安全规则的失败测试，再写最小实现。

## 13. 验收标准

功能验收：

- 对当前真实 `/home/xw/workspace/dev/qt_client`，Forja 能识别为非staged且基线不一致，不会覆盖。
- 对staged workspace，Forja 能通过 bundle 建立与 Windows 本地 commit 一致的 `qt_client`。
- 对 `remote-only` 依赖，Forja 只检查和 link，不 overlay、不 reset。
- 对远端无法访问仓库的情况，Forja 能自动选择 bundle 策略。
- 对远端缺少 git 的情况，Forja 明确 blocked。
- 对远端缺少 node/npm 的情况，Forja 仍可走 shell fallback 到基线和构建阶段。

安全验收：

- 非staged路径不执行 reset/delete。
- remote-only repo 不执行 overlay/delete。
- 删除只允许作用于 staged registry 记录中的路径。
- 所有路径操作都在远端 workspace/profile 边界内完成。

验证验收：

- strategy planner 单元测试通过。
- bundle baseline 临时 git repo 测试通过。
- pipeline stage 测试通过。
- WSL controlled e2e 通过。
- 真实 WSL 项目先通过 `remote status --json`，再按需执行 build。
