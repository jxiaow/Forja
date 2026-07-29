# Platform Abstraction

## Goal

确保平台相关逻辑集中在 `platform/` 层，业务模块通过接口调用，不散落平台判断。

## Repo Facts

```
src/qt/platform/
├── builder.ts          # PlatformBuilder 接口 + createBuilder 工厂
├── platformConfig.ts   # PlatformConfig 平台抽象接口
├── shellPlan.ts        # BuildConfig / CommandPlan / ShellPlanBuilder
├── win/               # Windows 平台实现
│   └── ...
└── linux/             # Linux 平台实现
    └── ...

src/sdk/platform/
├── index.ts           # 平台检测
├── windows.ts         # Windows 命令生成
└── linux.ts           # Linux 命令生成
```

**核心接口：**

- `PlatformBuilder`：平台构建器接口（`makeExec`, `qmakeCommands`, `buildCommands`, `cleanCommands`, `stopCommands`）
- `PlatformConfig`：平台配置接口（`initCommands`, `cdCommand`, `killCommand`, `qmakeSpec`, `buildCommand` 等）
- `BuildConfig`：构建配置数据结构（`vsDevShell`, `qtPath`, `projectDir`, `proFile`, `arch`, `mode` 等）
- `CommandPlan`：命令执行计划（`commands: string[]`, `matcher`）
- `ShellPlanBuilder`：Shell 命令组装器接口，由 `createShellPlanBuilder(config)` 创建

## Core Rules

### 平台逻辑集中

- 所有 `process.platform` 判断必须在 `platform/` 层
- 业务模块通过 `createBuilder(platformConfig)` 获取平台实现，不直接判断 OS
- `platformConfig` 由 `win/` 或 `linux/` 目录提供具体实现
- 路径分隔符处理集中在平台层

```typescript
// Good: 通过工厂获取平台实现
import { createBuilder } from './platform/builder';
import { winConfig } from './platform/win/config';

const builder = createBuilder(winConfig);
const execution = builder.makeExec(plan.commands);

// Bad: 业务模块中直接判断平台
if (process.platform === 'win32') {
    command = 'jom.exe';
} else {
    command = 'make';
}
```

### Shell 命令组装

- 使用 `createShellPlanBuilder(config)` 创建命令组装器
- 通过 `ShellPlanBuilder` 接口的方法生成 `CommandPlan`
- 不在业务模块中拼接 shell 字符串
- DevShell 初始化由 `PlatformConfig.initCommands()` 负责

```typescript
// Good: 使用 ShellPlanBuilder
const shellBuilder = createShellPlanBuilder(platformConfig);
const plan = shellBuilder.buildCommands(buildConfig);
// plan.commands = ['devshell init', 'cd projectDir', 'jom']

// Bad: 手动拼接
const cmd = `"${devShellPath}" & qmake & jom`;
```

### 路径处理

- Windows 路径使用 `path.win32` 或 `path.resolve`
- 不硬编码路径分隔符
- Qt 路径、DevShell 路径等由 configService 提供

## Design Checklist

- 新功能是否涉及平台差异
- 是否可以通过现有 PlatformBuilder 接口扩展
- 是否需要新增平台配置项
- Linux 支持是否需要同步实现

## Implementation Checklist

- 平台判断是否集中在 platform/ 层
- 是否通过工厂模式获取平台实现
- Shell 命令是否通过 ShellPlanBuilder 组装
- 路径是否使用 path 模块处理
- 新增平台配置是否同时更新 win/ 和 linux/

## Common Smells

- 业务模块中出现 `process.platform === 'win32'`
- 手动拼接 shell 命令字符串
- 硬编码 `\\` 或 `/` 作为路径分隔符
- 只实现 Windows 而忘记 Linux 占位
- DevShell 初始化逻辑散落在构建模块中
- 平台工具路径硬编码而不是从配置读取
