# Compilot

C++ 项目构建工具链，包含 VSCode 扩展和独立 CLI 两种使用方式。

支持 Qt (qmake) 项目和 SDK (.sln/Makefile) 项目，覆盖 Windows（MSVC）和 Linux 平台。

## 组件

| 组件 | 说明 | 文档 |
|------|------|------|
| **VSCode 扩展** | 图形化构建、调试、远程同步 | [docs/README-vscode.md](docs/README-vscode.md) |
| **CLI** | 命令行构建工具，支持 AI 编程工具集成 | [docs/README-cli.md](docs/README-cli.md) |
| **AI Skill** | 为 AI 助手提供构建能力的指令文件 | [skills/compilot/README.md](skills/compilot/README.md) |

## 安装

### VSCode 扩展

```bash
# 从 .vsix 文件安装
code --install-extension compilot-x.x.x.vsix
```

### CLI

```bash
# 从 .tgz 文件全局安装
npm install -g compilot-cli-x.x.x.tgz
```

### AI Skill

将 `skills/compilot/SKILL.md` 复制到对应 AI 工具的 skills 目录：

```bash
# Kiro（项目级自动加载）
cp -r skills/compilot/ .kiro/skills/compilot/

# 全局
cp -r skills/compilot/ ~/.kiro/skills/compilot/
```

## 构建与打包

```bash
# 编译 TypeScript
npm run compile

# 打包全部（bump version + VS 扩展 + CLI）
npm run package:all

# 仅打包 VS 扩展 → dist/<version>/vs/
npm run package

# 仅打包 CLI → dist/<version>/cli/
npm run package:cli
```

打包产物：

```
dist/
└── <version>/
    ├── vs/                          # VSCode 扩展
    │   ├── compilot-x.x.x.vsix
    │   └── README.md
    └── cli/                         # CLI + AI Skill
        ├── compilot-cli-x.x.x.tgz
        ├── README.md
        └── skills/
            └── compilot/
                ├── SKILL.md
                └── README.md
```

## 支持平台

- Windows (MSVC + jom / MSBuild)
- Linux (GCC + make)

## License

MIT
