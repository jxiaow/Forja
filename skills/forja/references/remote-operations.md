# 远程与同步

执行 `server`、`remote` 或 `sync` 前完整读取本文件。

## Server 管理

`forja server ...` 管理全局服务器配置，不依赖当前工作区或已选择的构建目标，因此不要先执行 `forja status`。

- 查询、添加或更新服务器时，直接执行相应的 `forja server ... --json` 命令。
- 删除服务器前，先展示服务器名称和地址并取得明确授权，再执行
  `forja server remove <id> --force --json`。

## Remote 与同步流程

1. 执行 `forja status --json`。
2. 同步前执行 `forja sync status --json`。
3. 未配置时使用
   `forja remote setup --server <id> --remote-path <path> --json`，绑定当前 workroot、启用
   同步并部署远端 Forja。
4. 执行 `forja sync --dry-run --json`，完整展示上传、删除和跳过的文件。
5. 只有用户已授权目标服务器和文件范围后，才执行 `forja sync --json`。

## 安全规则

- `forja sync --json` 跳过交互确认并直接执行，不要把 dry-run 当作执行授权。
- `sync reset` 会改变持久状态。先说明精确目标并取得用户明确授权；JSON 模式使用
  `forja sync reset --force --json`。
- 只在命令确实支持 `--plan` 时使用它；`sync reset` 和 `server remove` 不支持
  `--plan`，不要构造不存在的参数。
- 不输出服务器密码、私钥内容或其他凭据；只把用户提供的凭据引用传给 Forja。
- 同步、SSH 或 SCP 由 Forja 完成，不要自行拼接替代命令。
