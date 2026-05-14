# Compilot Skill

为 AI 编程工具提供 C++ 项目构建能力的 Skill 文件。

## 什么是 Skill

Skill 是一份结构化的指令文档，告诉 AI 编程助手在特定场景下如何使用某个工具。安装后，AI 助手在遇到 C++ 构建相关任务时会自动调用 `compilot` 命令完成编译、运行、调试等操作。

## 前提条件

机器上需要先安装 `compilot` CLI：

```bash
npm install -g compilot-cli-x.x.x.tgz
```

安装后验证：

```bash
compilot --version
```

## 安装 Skill

将 `SKILL.md` 文件放到对应 AI 工具的 skills 目录下即可。

### Kiro

Kiro 会自动加载项目内 `skills/` 目录下的 Skill 文件，无需额外操作。

如果想全局生效（所有项目都能用），复制到用户级目录：

```bash
mkdir -p ~/.kiro/skills/compilot
cp skills/compilot/SKILL.md ~/.kiro/skills/compilot/
```

### 其他 AI 工具

根据工具的 skills 目录约定，复制 `SKILL.md`：

```bash
# Claude Code
mkdir -p ~/.claude/skills/compilot
cp skills/compilot/SKILL.md ~/.claude/skills/compilot/

# Codex
mkdir -p ~/.codex/skills/compilot
cp skills/compilot/SKILL.md ~/.codex/skills/compilot/
```

## 使用方式

安装完成后，在 AI 对话中直接描述构建需求即可：

- "编译这个项目"
- "运行一下看看效果"
- "清理重新编译"
- "把代码同步到远程服务器"

AI 助手会自动识别场景并调用对应的 `compilot` 命令。

## 首次使用

在 Qt 项目目录下，让 AI 执行一次初始化：

```
帮我初始化一下构建环境
```

AI 会执行 `compilot qt init --execute`，自动检测 Qt 和 Visual Studio 路径并保存配置。之后的构建命令不再需要指定路径参数。

## 支持的项目类型

| 类型 | 入口文件 | 子命令 |
|------|----------|--------|
| Qt (qmake) | `.pro` | `compilot qt ...` |
| SDK (MSBuild) | `.sln` | `compilot sdk ...` |
| SDK (Make) | `Makefile` | `compilot sdk ...` |

## 文件说明

```
skills/compilot/
├── SKILL.md    # AI 工具读取的指令文件（核心）
└── README.md   # 本文件（人类阅读的安装说明）
```
