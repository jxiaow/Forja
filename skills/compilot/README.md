# Compilot Skill

AI 编程助手的 C++ 构建能力扩展。安装后，AI 在遇到构建任务时自动调用 `compilot` 命令。

## 前提

```bash
npm install -g compilot-cli-x.x.x.tgz
compilot --version
```

## 安装

```bash
# Kiro — 全局（所有项目生效）
cp -r skills/compilot/ ~/.kiro/skills/compilot/

# Kiro — 项目级（仅当前项目）
cp -r skills/compilot/ <project>/.kiro/skills/compilot/
```

## 使用

安装后在 AI 对话中直接描述需求即可：

- "编译这个项目"
- "运行一下看看效果"
- "清理重新编译"
- "同步到远程服务器"
- "看看构建环境状态"

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
├── SKILL.md    # AI 读取的指令文件
└── README.md   # 本文件（安装说明）
```
