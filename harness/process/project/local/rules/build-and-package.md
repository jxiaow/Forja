# Build And Package

本项目的构建和打包命令已在 `package.json` 的 `scripts` 中定义。agent 执行构建/打包时必须使用这些命令，禁止自行拼接底层工具调用。

## 命令映射

| 用户意图 | 正确命令 | 说明 |
|----------|----------|------|
| 编译 | `npm run compile` | TypeScript 编译 + 复制 HTML |
| 运行测试 | `npm test` | 编译 + node:test |
| 打包全部 | `npm run package:all` | bump version + VS 扩展 + CLI |
| 仅打包 VS 扩展 | `npm run package` | 编译 + 生成 .vsix 到 dist/vs/ |
| 仅打包 CLI | `npm run package:cli` | 编译 + 生成 .tgz 到 dist/cli/ |
| 类型检查 | `npx tsc --noEmit` | 不生成文件，仅检查类型 |

## 规则

- 用户说"打包"且未指定范围时，默认使用 `npm run package:all`
- 用户说"打包扩展"或"打包 vsix"时，使用 `npm run package`
- 用户说"打包 CLI"时，使用 `npm run package:cli`
- 禁止直接调用 `vsce package`、`node scripts/build-cli.js` 等底层命令，除非在调试脚本本身
- 禁止用 `npm run compile` 替代打包；编译不等于打包
- `npm run package:all` 会自动 bump version，不需要手动改 `package.json` 的 version 字段

## 打包产物

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
```

## Verification

打包后的验证最小集：

- 确认 `dist/<version>/vs/` 下生成了 `.vsix` 文件
- 确认 `dist/<version>/cli/` 下生成了 `.tgz` 文件
- 如果只打包了其中一个，只验证对应产物
