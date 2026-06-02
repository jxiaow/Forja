# Forja Skill

AI 编程助手的 C++ 构建能力扩展。安装后，AI 在遇到构建任务时自动调用 `forja` 命令。

## 前提

```bash
npm install -g forja-cli-x.x.x.tgz
forja --version
```

## 安装

将 `skills/forja/` 目录复制到对应 AI 工具的 skill 目录即可。

### Kiro

```bash
# Windows
xcopy /E /I skills\forja "%USERPROFILE%\.kiro\skills\forja"

# macOS / Linux
cp -r skills/forja/ ~/.kiro/skills/forja/
```

### Codex

```bash
# Windows
xcopy /E /I skills\forja "%USERPROFILE%\.codex\skills\forja"

# macOS / Linux
cp -r skills/forja/ ~/.codex/skills/forja/
```

### Cursor

```bash
# Windows
xcopy /E /I skills\forja "%USERPROFILE%\.cursor\skills\forja"

# macOS / Linux
cp -r skills/forja/ ~/.cursor/skills/forja/
```

### 其他工具

将 `skills/forja/` 整个目录复制到对应工具的全局 skills 目录：

```bash
cp -r skills/forja/ ~/.<tool-name>/skills/forja/
```

## 使用

安装后在 AI 对话中直接描述需求即可：

- "编译这个项目"
- "运行一下看看效果"
- "清理重新编译"
- "同步到服务器"
- "看看构建环境状态"
- "初始化构建环境"
- "切到 release 模式编译"
- "用 x64 架构重新编译"
- "停掉正在运行的程序"
- "看看编译日志"

AI 会自动调用对应的 `forja` 命令。首次使用时让 AI "初始化构建环境"即可。
Skill 会先执行 `forja qt status --json` 或 `forja sdk status --json` 检查当前工作区，再根据状态提示运行 `init` 或 `use`。`init` 只做自动初始化；项目、mode、arch 和工具链路径的显式选择都通过 `use` 写入。

## 支持的项目类型

| 类型 | 入口文件 | 子命令 |
|------|----------|--------|
| Qt (qmake) | `.pro` | `forja qt ...` |
| SDK (MSBuild) | `.sln` | `forja sdk ...` |
| SDK (Make) | `Makefile` | `forja sdk ...` |

## 文件说明

```
skills/forja/
├── SKILL.md    # AI 读取的指令文件（核心）
└── README.md   # 本文件（安装说明）
```
