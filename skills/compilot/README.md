# Compilot Skill

AI 编程助手的 C++ 构建能力扩展。安装后，AI 在遇到构建任务时自动调用 `compilot` 命令。

## 前提

```bash
npm install -g compilot-cli-x.x.x.tgz
compilot --version
```

## 安装

将 `skills/compilot/` 目录复制到对应 AI 工具的 skill 目录即可。

### Kiro

```bash
# Windows
xcopy /E /I skills\compilot "%USERPROFILE%\.kiro\skills\compilot"

# macOS / Linux
cp -r skills/compilot/ ~/.kiro/skills/compilot/
```

### Codex

```bash
# Windows
xcopy /E /I skills\compilot "%USERPROFILE%\.codex\skills\compilot"

# macOS / Linux
cp -r skills/compilot/ ~/.codex/skills/compilot/
```

### Cursor

```bash
# Windows
xcopy /E /I skills\compilot "%USERPROFILE%\.cursor\skills\compilot"

# macOS / Linux
cp -r skills/compilot/ ~/.cursor/skills/compilot/
```

### 其他工具

将 `skills/compilot/` 整个目录复制到对应工具的全局 skills 目录：

```bash
cp -r skills/compilot/ ~/.<tool-name>/skills/compilot/
```

## 使用

安装后在 AI 对话中直接描述需求即可：

- "编译这个项目"
- "运行一下看看效果"
- "清理重新编译"
- "同步到远程服务器"
- "看看构建环境状态"
- "初始化构建环境"
- "切到 release 模式编译"
- "用 x64 架构重新编译"
- "停掉正在运行的程序"
- "看看编译日志"

AI 会自动调用对应的 `compilot` 命令。首次使用时让 AI "初始化构建环境"即可。

## 支持的项目类型

| 类型 | 入口文件 | 子命令 |
|------|----------|--------|
| Qt (qmake) | `.pro` | `compilot qt ...` |
| SDK (MSBuild) | `.sln` | `compilot sdk ...` |
| SDK (Make) | `Makefile` | `compilot sdk ...` |

## 文件说明

```
skills/compilot/
├── SKILL.md    # AI 读取的指令文件（核心）
└── README.md   # 本文件（安装说明）
```
