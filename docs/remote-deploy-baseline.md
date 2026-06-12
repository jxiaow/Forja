# 远程基线与状态设计

本文补充 `docs/remote-deploy-v3.md` 中 baseline、dirty、sync overlay、state 和 restore 的细节。v3 保留总体方案，本文负责第一版可执行边界。

## 目标

远端编译目录不是本地 workspace 的无条件镜像：

- 远端 git baseline 要和本地 committed 基线对齐
- 远端可能保留打包环境带来的 tracked dirty 修改
- 本地未提交修改通过 sync overlay 覆盖到远端
- 上一次 sync overlay 不得在本地撤销后继续污染远端 build

## 远端文件分类

每个远端 `git` repo 的工作树差异分为：

| 分类 | 含义 | 默认处理 |
| --- | --- | --- |
| `preservedTracked` | 远端本来就有的 tracked dirty，且不属于 Forja sync overlay | branchSync 时 stash/pop 保留 |
| `overlayTracked` | 上一次 Forja sync 上传后造成的 tracked dirty | branchSync 前恢复到 git baseline，再按本次 sync 重放 |
| `overlayUntracked` | 上一次 Forja sync 上传的 untracked 文件 | branchSync 前删除该 overlay 文件，再按本次 sync 重放 |
| `overlayDeletedTracked` | 本地未提交删除在远端 baseline 上形成的 tracked 删除 | branchSync 前 git restore，再按本次 sync 重放 |
| `underlayTracked` | overlay 上传或删除前，远端本来存在的 tracked dirty 内容 | overlay 清理时恢复这份远端内容 |
| `unknownUntracked` | 远端已有但不由 Forja 记录的 untracked 文件 | 默认保留；阻塞 git 操作时失败 |
| `ignored` | 远端 git ignored 文件 | 默认不检查、不清理 |

`preservedTracked` 和 sync overlay 都可能被本次 sync 覆盖；差别只在 git baseline 阶段是否恢复。

## Overlay Manifest

仅复用本地 mtime sync state 不足以恢复远端 baseline。remote 需要额外维护 overlay manifest，记录上一次由 remote sync 成功上传到每个 repo 的文件。

manifest 的真相必须在远端 target state 中。本地可以缓存最近一次 pipeline 摘要，但不能作为清理远端 overlay 的权威来源，因为同一个远端 target 可能被另一台本地机器、VSCode 或 CLI 使用。

```ts
interface RemoteOverlayManifest {
  version: 1;
  workspace: string;
  serverId: string;
  remotePath: string;
  repos: Record<string, {
    tracked: string[];
    untracked: string[];
    deletedTracked: string[];
    underlayTracked?: Record<string, {
      backupRef: string;
      mode?: string;
      capturedAt: string;
    }>;
    lastSyncedAt: string;
  }>;
}
```

远端建议存储：

```text
~/.forja/remote-state/<targetId>/overlay.json
~/.forja/remote-state/<targetId>/underlay/
```

manifest 是“Forja 在该远端工作区留下过哪些 overlay 文件”的记录，不是 run-state，也不替代现有 sync mtime state。

每次 remote sync 成功后：

1. 以本次上传结果更新 manifest
2. 按 repo 区分本地 tracked dirty、untracked 上传文件和 tracked deletion
3. 不把普通 `forja qt sync` 的历史文件自动视为 remote overlay，除非 remote sync 明确接管该写入路径
4. 如果本次 overlay 上传或删除会覆盖 preserved tracked dirty，先把覆盖前的远端内容保存为 underlay，再执行 overlay 操作

如果 remote sync 在部分文件已经上传或删除后失败，必须先把已完成部分写入 manifest，再返回失败诊断。下一次运行才能按 manifest 还原这些已落地 overlay，避免“本轮失败但远端已被部分污染”的状态被遗忘。

manifest 只识别当前 remote pipeline 写入并记录过的 overlay。其他本地机器、普通 sync 命令或人工 SCP 写入的远端文件，不得因为路径相似就自动清理；它们会落入 preserved/unknown 分类。第一版因此默认一个远端 build target 由受控 remote pipeline 写 overlay，status 需要暴露 target 是否处于 files-only 或 dirty preserved 状态。

本次 overlay 写入前，如果目标路径在远端存在但不是 git tracked 文件，也不在 manifest 管理范围内，视为 unknown untracked 碰撞并阻塞。不能上传覆盖，也不能把它当作可删除 overlay 清理。

## Branch Sync

remote build/run 的 git 阶段按 repo 执行：

```text
load overlay manifest
restore previous overlay
stash preserved tracked dirty
fetch
checkout target branch
pull --ff-only
stash pop
```

### 1. 恢复旧 Overlay

对 manifest 中记录的旧 overlay：

- tracked 文件如果有 underlay 备份，先恢复 underlay；否则使用 git restore 恢复到远端当前 HEAD
- untracked 文件只删除 manifest 精确记录的路径
- deleted tracked 文件如果有 underlay 备份，先恢复 underlay；否则使用 git restore 恢复到远端当前 HEAD
- 删除前必须确认目标路径仍位于 repo 根内
- 路径缺失视为已清理，不报错

这样本地已经撤销或提交掉的旧 overlay 不会继续参与下一次 build。

underlay 恢复成功后删除对应 backupRef 和 manifest 条目。underlay 恢复失败时阻塞，不允许继续 branchSync，因为继续 git restore 会丢失远端打包修改。

### 2. 保留远端 Tracked Dirty

恢复旧 overlay 后，剩余 tracked dirty 视为远端 preserved dirty：

```bash
git stash push -m "forja-remote-preserve" -- <tracked paths>
```

第一版 stash 范围只包含 tracked dirty，不把 unknown untracked 和 ignored 文件纳入 stash。

tracked rename 必须把旧路径和新路径同时纳入 stash 路径集。只保留新路径会丢失远端原有 rename 的删除侧，后续 checkout/pull/restore 无法完整还原 preserved dirty。

### 3. 拉取 Git Baseline

第一版 target branch 是本地 repo 当前命名分支，不做 pinned branch。branchSync 前需要本地 precheck：

- detached HEAD 阻塞
- 当前 branch 没有可用 upstream/fetch target 时阻塞
- 本地 HEAD 还未 push 到远端可拉取 baseline 时阻塞

sync 只传本地未提交 overlay，不负责传输本地已提交但远端仓库 fetch 不到的 commit。

远端执行：

```bash
git fetch
git checkout <target-branch>
git pull --ff-only
```

失败规则：

| 场景 | 行为 |
| --- | --- |
| fetch 失败 | 阻塞 |
| target branch 不存在 | 阻塞 |
| checkout 被 unknown untracked 挡住 | 阻塞并列出文件 |
| pull 不能 fast-forward | 阻塞 |
| stash pop 冲突 | 阻塞，保留 stash 诊断 |

默认禁止：

```bash
git reset --hard
git checkout -- .
git clean -fd
```

### 4. 恢复 Preserved Dirty

baseline 拉取完成后执行 stash pop。成功后，远端打包修改回到工作树。stash pop 冲突时不得继续 sync/build。

## Sync 顺序

branchSync 成功后才 sync 本地 dirty/untracked：

```text
branchSync -> sync -> baselineCheck -> action
```

sync 规则：

- 上传本地 git diff、cached diff 和 untracked changed files
- 对本地未提交 tracked deletion，在远端删除对应 tracked path 并记录 `deletedTracked`
- 继续使用 sync ignore、server 和 remotePath
- deletion operation 由 git status/diff 判定，不因本地 stat 缺失被 mtime 过滤跳过
- 本次 remote sync 上传结果写入 overlay manifest
- sync 可以覆盖 preserved dirty 文件

remote sync 的正确性不能依赖 mtime skip。branchSync 会先恢复旧 overlay，如果本地当前 dirty 文件没有重新上传，远端就会丢失本次工作区状态。因此 `git` repo 模式下，每次 pipeline 都要从当前本地 git status/diff 得到 desired overlay set，并重放全部 tracked dirty、staged、untracked 和 tracked deletion 操作。mtime state 可以作为普通 sync 的优化或记录，但不能作为 remote overlay 是否需要重放的唯一依据。

desired overlay set 的文件内容规则：

- tracked dirty 或 staged dirty：上传本地工作树当前文件内容，不上传 index blob
- staged-only 文件：工作树内容等于 staged 内容时正常上传
- staged + unstaged 同一路径：以上传工作树最终内容为准
- rename：按旧路径 tracked deletion + 新路径 upload 处理
- mode change：记录可执行位等必要 mode，远端尽量复现；复现失败时 warning
- symlink：第一版按普通文件路径安全规则处理；跨平台 symlink 语义不保证，必要时 warning
- submodule gitlink：第一版不作为普通文件 overlay 上传；检测到 dirty submodule 时阻塞

sync 上传或删除 preserved dirty 文件前必须捕获 underlay：

1. 在远端检查目标 tracked path 是否 dirty，且不属于当前 overlay manifest
2. 如果是 preserved dirty，把当前文件内容和必要 mode 复制到 `remote-state/<targetId>/underlay/`
3. 上传本地 overlay 文件，或执行本地 tracked deletion 对应的远端删除
4. manifest 记录该 path 的 overlay 和 underlay backupRef

这样用户后续撤销本地 overlay 或执行下一次 branchSync 时，远端打包修改能恢复到 overlay 覆盖前的内容，而不是被还原到 git HEAD。

remote sync 复用当前 sync 的 server、remotePath 和 ignore，但必须补 deletion operation；普通 SCP 上传不足以复现本地未提交删除。

远端没有 `.git` 的 repo 是 files-only：

- 不做 overlay restore 分类
- 不做 branchSync
- 不承诺删除本地已撤销的历史上传文件

files-only 的限制必须在 JSON/status 中显式返回。

## Submodule

第一版支持 committed submodule gitlink，不支持 submodule dirty overlay。

规则：

- 本地 submodule dirty、untracked 或未提交 gitlink 变更阻塞
- 远端 submodule dirty 阻塞，不做 underlay 保护
- parent repo branchSync 成功后执行 `git submodule sync --recursive`
- 然后执行 `git submodule update --init --recursive --checkout`
- submodule update 失败阻塞，不继续 sync/build

这意味着 remote pipeline 只复现已经提交并可从远端拉取的 submodule 状态。本地 submodule 内未提交修改必须先提交并 push，或不使用第一版 remote build。

## Baseline Check

baselineCheck 不要求远端工作树 clean，但必须输出结构化状态。

```ts
interface RepoBaselineState {
  name: string;
  mode: 'git' | 'files';
  localCommit?: string;
  remoteCommit?: string;
  commitAligned?: boolean;
  preservedTracked?: string[];
  overlayUploaded?: string[];
  unknownUntracked?: string[];
}
```

阻塞规则：

- `git` repo 的 commit 不一致时阻塞
- branchSync 中 stash pop 冲突时阻塞
- unknown untracked 阻塞 checkout/pull 时阻塞
- files-only repo 不因缺 commit 阻塞，但状态必须降级展示

dirty 本身不是失败条件；实现需要说明它属于 preserved、overlay 还是 unknown untracked。

## State Ownership

| 状态 | 真相来源 | 用途 |
| --- | --- | --- |
| sync mtime state | 本地 `~/.forja/sync/` | 普通 sync 的上传优化；remote git repo 不以它决定 overlay 是否重放 |
| remote overlay manifest | 远端 `~/.forja/remote-state/<targetId>/` | 下次 branchSync 前清理上次 remote sync overlay |
| remote underlay backup | 远端 `~/.forja/remote-state/<targetId>/underlay/` | 恢复被 overlay 覆盖的远端 preserved dirty |
| remote pipeline state | 本地 `~/.forja/remote-state/` | 最近阶段、失败点、server/remotePath 摘要 |
| remote run-state | 远端 forja workspace state | `remote qt ps/stop` 的 PID/logFile 真相 |
| remote target lock | 远端用户目录 | 阻止多个本地客户端并发修改同一远端 checkout |

本地 remote pipeline state 不缓存远端进程存活结论。`remote qt ps` 必须向远端 forja 查询。

### Target Lock

branchSync 前通过 SSH 在远端用户目录原子获取 target lock：

```text
~/.forja/locks/<targetId>/
```

锁元数据记录 remotePath、repo 列表、客户端 workspace、开始时间和 stage。pipeline 结束或取消时释放锁。

这个锁保护的是远端 checkout，而不是本地命令进程：

- 同一远端 target 的 CLI 和 VSCode pipeline 互斥
- CLI foreground run 和 VSCode foreground Terminal session 都必须持有该 lock，直到远端 `qt run` 会话退出或取消
- stale lock 不能仅靠本地 PID 判断；第一版应显示锁元数据并要求显式清理/force 流程

## Restore

restore 是路径级破坏性动作：

```bash
forja remote qt restore --repo qt-app -- src/main.cpp generated/version.h
```

路径规则：

- 必须显式提供至少一个 pathspec
- 多 repo workspace 必须显式 `--repo`
- 路径按 repo 内相对路径处理
- 拒绝绝对路径、空路径、包含 `..` 的规范化逃逸路径和 NUL
- 第一版不做 shell glob 展开；用户给出的值按 git pathspec 传递
- 远端命令必须用参数级转义，不能把 pathspec 拼进未转义 shell 片段

restore 只对 tracked 路径执行 git restore，不清理 untracked，也不触发 build/run。

成功 restore 如果命中当前 overlay manifest 中的 tracked 或 deleted tracked 路径，需要同步移除对应 manifest 记录。若该路径有关联 underlay backup，restore 表示用户明确要回到远端当前 git HEAD，因此也要删除 underlay backup，而不是恢复远端 preserved dirty。

## JSON 摘要

branchSync/baseline stage 至少要能表达：

```json
{
  "stage": "baselineCheck",
  "ok": true,
  "repos": [
    {
      "name": "qt-app",
      "mode": "git",
      "localCommit": "abc1234",
      "remoteCommit": "abc1234",
      "commitAligned": true,
      "preservedTrackedCount": 2,
      "overlayUploadedCount": 1,
      "unknownUntrackedCount": 0
    }
  ]
}
```

文件列表默认可截断，完整明细写日志。
