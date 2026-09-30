/**
 * CLI UI text dictionary shard — per-command help texts.
 * Split from types.ts (entries copied verbatim; do not edit wording).
 */
export const UI_HELP: Record<string, { en: string; zh: string }> = {
    // help texts
    'help.toplevel': {
        en: `Usage: forja <command> [action] [options]

Commands:
  init       Register work root and configure initial target
  status     Show workspace readiness
  list       List targets, env
  use        Select target and execution mode
  server     Manage remote servers (add/update/remove)
  remote     Manage remote configuration
  build      Build the active target
  run        Run the built application
  stop       Stop a running application
  clean      Clean build artifacts
  sync       Sync files with remote server
  deploy     Build remote and deploy to target machine

Global options:
  --help, -h       Show help
  --version, -v    Show version
  --json           JSON output
  --lang <locale>  Language: zh or en
  --workspace <p>  Specify workspace (default: cwd)`,
        zh: `用法: forja <命令> [动作] [选项]

命令:
  init       注册工作根目录并配置初始目标
  status     查看工作区就绪状态
  list       列出目标、环境
  use        选择目标和执行模式
  server     管理远程服务器（添加/更新/删除）
  remote     管理远程配置
  build      构建当前目标
  run        运行已构建的应用
  stop       停止运行中的应用
  clean      清理构建产物
  sync       与远程服务器同步文件
  deploy     远程构建并部署到实体机

全局选项:
  --help, -h       显示帮助
  --version, -v    显示版本
  --json           JSON 输出
  --lang <locale>  语言: zh 或 en
  --workspace <p>  指定工作区（默认当前目录）`,
    },
    'help.status': {
        en: `Usage:
  forja status                     Show workspace readiness and runtime status

Options:
  --json                  Output as JSON
  --lang <locale>         Language: zh or en
  --workspace <path>      Workspace directory (default: current directory)`,
        zh: `用法:
  forja status                     查看工作区就绪状态和运行时信息

选项:
  --json                  JSON 格式输出
  --lang <locale>         语言: zh 或 en
  --workspace <路径>      工作区目录（默认当前目录）`,
    },
    'help.list': {
        en: `Usage:
  forja list targets               List saved targets
  forja list targets --all         Include discovered targets (scan)
  forja list env                   List all environment tools
  forja list env --qt|--vs|--jom|--make  List specific environment tool

Options:
  --json                  Output as JSON`,
        zh: `用法:
  forja list targets               列出已保存目标
  forja list targets --all         同时列出扫描发现的目标
  forja list env                   列出所有环境工具
  forja list env --qt|--vs|--jom|--make  列出指定环境工具

选项:
  --json                  JSON 格式输出`,
    },
    'help.use': {
        en: `Usage: forja use target [options] [--json]
       forja use --jobs <N>          Set global parallel build jobs (persisted)
       forja use --rcc <path>        Set RCC project path

Target options:
  --project <path>        Select target by project path or label
  --answers <file>        Continue a needs-input flow from a JSON answers file
  --mode <debug|release>  Set build mode
  --arch <x86|x64>        Set target architecture
  --qt <path>             Set Qt installation path
  --vs <path>             Set Visual Studio installation path
  --jom <path>            Set jom installation path
  --rcc <path>            Set RCC project path
  --executable-name <name> Rename executable after build (overrides .pro TARGET)
  --build-script <path>   Set custom build script (.sh/.bat, C++ targets only)
  suppress-warnings [codes]     Manage suppressed warnings (no args = show)
    --add <codes>               Add to list
    --rm <codes>                Remove from list
  qmake-args [args]             Manage persistent qmake arguments (no args = show)
    --add <args>                Add args (auto-dedup)
    --rm <args>                 Remove args
  cmake-args [args]             Manage persistent CMake configure args (no args = show)
    --add <args>                Add args (auto-dedup)
    --rm <args>                 Remove args`,
        zh: `用法: forja use target [选项] [--json]
       forja use --jobs <N>          设置全局并行编译数（持久化）
       forja use --rcc <路径>        设置 RCC 项目路径

Target 选项:
  --project <路径>        按项目路径或标签选择目标
  --answers <文件>        使用 JSON 答案文件继续 needs-input 流程
  --mode <debug|release>  设置构建模式
  --arch <x86|x64>        设置目标架构
  --qt <路径>             设置 Qt 安装路径
  --vs <路径>             设置 Visual Studio 安装路径
  --jom <路径>            设置 jom 安装路径
  --rcc <路径>            设置 RCC 项目路径
  --executable-name <名称> 构建后重命名可执行文件（覆盖 .pro 的 TARGET）
  --build-script <路径>   设置自定义构建脚本（.sh/.bat，仅 C++ 目标）
  suppress-warnings [代码]      管理被过滤的构建警告（无参数=查看）
    --add <代码>                追加到列表
    --rm <代码>                 从列表删除
  qmake-args [参数]             管理持久化 qmake 参数（无参数=查看）
    --add <参数>                添加参数（自动去重）
    --rm <参数>                 删除参数
  cmake-args [参数]             管理持久化 CMake 配置参数（无参数=查看）
    --add <参数>                添加参数（自动去重）
    --rm <参数>                 删除参数`,
    },
    'help.remote': {
        en: `Usage: forja remote [action] [options] [--json]

  forja remote                                    Show remote mode status
  forja remote on                                 Enable remote mode (persistent)
  forja remote off                                Disable remote mode
  forja remote check                              Check code consistency (branch + commit)
  forja remote bootstrap                         Package and install the current local CLI remotely
`,
        zh: `用法: forja remote [动作] [选项] [--json]

  forja remote                                    显示远程模式状态
  forja remote on                                 开启远程模式（持久化）
  forja remote off                                关闭远程模式
  forja remote check                              检查代码一致性（分支 + 提交）
  forja remote bootstrap                         打包当前本地 CLI 并安装到远端
`,
    },
    'help.build': {
        en: `Usage:
  forja build                      Build current active target
  forja build fresh                Clean and rebuild from scratch
  forja build qmake                Regenerate Makefile only
  forja build rcc                  Compile Qt resource files only

Options:
  --plan                  Dry run, show commands without executing
  --project <path>        Build a specific project file (.pro/.sln/Makefile/CMakeLists.txt)
  --jobs <N>              Parallel build jobs (e.g. -jN / jom /m:N; omit to use saved default)
  --json                  Output as JSON
  --lang <locale>         Language: zh or en
  --workspace <path>      Workspace directory (default: current directory)`,
        zh: `用法:
  forja build                      构建当前活动目标
  forja build fresh                清理后全量重建
  forja build qmake                仅重新生成 Makefile
  forja build rcc                  仅编译 Qt 资源文件

选项:
  --plan                  预演模式，只显示命令不执行
  --project <路径>        构建指定项目文件（.pro/.sln/Makefile/CMakeLists.txt）
  --jobs <N>              并行编译数（如 -jN / jom /m:N；不指定则使用已保存的默认值）
  --json                  JSON 格式输出
  --lang <locale>         语言: zh 或 en
  --workspace <路径>      工作区目录（默认当前目录）`,
    },
    'help.run': {
        en: `Usage: forja run [subcommand] [options] [--json]

Subcommands:
  designer <ui-file>                       Open Qt Designer with UI file
  custom <name>                            Run custom command

Options:
  --detach                                 Run in background
  --plan                                   Dry run, show commands without executing
  --json                                   Output as JSON`,
        zh: `用法: forja run [子命令] [选项] [--json]

子命令:
  designer <ui文件>                        打开 Qt Designer 加载 UI 文件
  custom <名称>                            运行自定义命令

选项:
  --detach                                 后台运行
  --plan                                   预演模式，只显示命令不执行
  --json                                   JSON 输出`,
    },
    'help.stop': {
        en: 'Usage: forja stop [--json]',
        zh: '用法: forja stop [--json]',
    },
    'help.clean': {
        en: 'Usage: forja clean [--plan] [--json]',
        zh: '用法: forja clean [--plan] [--json]',
    },
    'help.init': {
        en: `Usage:
  forja init                     Register work root and configure initial target
  forja init --workroot <path>   Specify work root directory

Options:
  --workroot <path>       Work root directory (default: current directory)
  --answers <file>        JSON file with pre-configured answers (for automation)
  --lang <zh|en>          Set display language (persisted)
  --json                  Output as JSON`,
        zh: `用法:
  forja init                     注册工作根目录并配置初始目标
  forja init --workroot <path>   指定工作根目录

选项:
  --workroot <path>       工作根目录（默认当前目录）
  --answers <file>        预配置答案的 JSON 文件（用于自动化）
  --lang <zh|en>          设置显示语言（持久化）
  --json                  JSON 格式输出`,
    },
    // sync help fix — actual supported usage
    'help.sync.actual': {
        en: `Usage:
  forja sync                                        Sync changed files (interactive confirm)
  forja sync --yes                                  Skip confirmation
  forja sync --dry-run                              Preview pending changes
  forja sync reset                                  Clear sync state
  forja sync status                                 Show sync configuration
  forja sync ignore                                 List ignore patterns
  forja sync ignore --add <pattern>                 Add an ignore pattern
  forja sync ignore --rm <pattern>                  Remove an ignore pattern
  forja sync --file <path-or-glob>                  Sync specific file or glob (repeatable)

Options:
  --json                                  JSON output`,
        zh: `用法:
  forja sync                                        同步变更文件（交互确认）
  forja sync --yes                                  跳过确认
  forja sync --dry-run                              预览待同步文件
  forja sync reset                                  清除同步状态
  forja sync status                                 查看同步配置
  forja sync ignore                                 列出忽略规则
  forja sync ignore --add <pattern>                 添加忽略规则
  forja sync ignore --rm <pattern>                  移除忽略规则
  forja sync --file <路径或通配符>                  同步指定文件或通配符（可重复）

选项:
  --json                                  JSON 格式输出`,
    },
    // server help — document no-arg list behavior
    'help.server.full': {
        en: `Usage: forja server [<add|update|remove>] [options] [--json]

  forja server                  List all servers
  forja server --detail <id>    Show detailed info for a server
  forja server add              Add a new server
  forja server update <id>      Update an existing server
  forja server remove <id> [--force]
                                Remove a server (--force for non-interactive)`,
        zh: `用法: forja server [<add|update|remove>] [选项] [--json]

  forja server                  列出所有服务器
  forja server --detail <id>    查看指定服务器详细信息
  forja server add              添加新服务器
  forja server update <id>      更新已有服务器
  forja server remove <id> [--force]
                                删除服务器（非交互模式需 --force）`,
    },
    'help.deploy': {
        en: `Usage:
  forja deploy                                  Build on remote, download artifacts, deploy to target
  forja deploy --artifact <path>                Specify artifact path (repeatable)
  forja deploy config --server <name>           Configure deploy target server
  forja deploy config --deploy-path <path>      Configure deploy directory on target
  forja deploy config --artifact <path>         Configure artifact paths

Options:
  --artifact <path>                     Artifact path relative to remote workspace
  --json                                JSON output`,
        zh: `用法:
  forja deploy                                  远程构建、下载产物、部署到实体机
  forja deploy --artifact <path>                指定产物路径（可重复）
  forja deploy config --server <name>           配置部署目标服务器
  forja deploy config --deploy-path <path>      配置实体机上的部署目录
  forja deploy config --artifact <path>         配置产物路径

选项:
  --artifact <path>                     产物路径（相对于远程工作区）
  --json                                JSON 格式输出`,
    },
};
