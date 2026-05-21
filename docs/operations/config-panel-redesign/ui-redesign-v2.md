# 配置面板 UI 重设计 v2

## 背景

当前配置面板按功能类型分页（项目/环境/同步/高级），每个页面混合 Qt 和 SDK 内容。未激活模块用灰色遮罩处理，视觉效果差且交互不清晰。

## 设计方案：按功能分页 + 未激活模块折叠为一行

### 核心原则

1. **激活的模块展开显示完整内容**
2. **未激活的模块折叠为一行摘要**，不占空间，不用灰色遮罩
3. **折叠状态下仍可操作项目选择**（让用户能手动激活）
4. **远程同步是通用功能**，不绑定特定模块

### 页面结构

#### 项目配置

```
┌─────────────────────────────────────────┐
│ 项目配置                                 │
│ 管理构建参数和 IntelliSense 设置          │
│                                         │
│ ▼ Qt 项目                               │  ← 激活时默认展开
│   当前项目: XYWinQT [切换] [手动指定]     │
│   构建模式: [debug] [release]            │
│   目标架构: [x86] [x64]                  │
│   语言标准: C11 / C++17                  │
│                                         │
│ ▶ SDK 项目 · 未检测到                    │  ← 未激活时折叠为一行
│                                         │
└─────────────────────────────────────────┘
```

未激活模块展开后：

```
│ ▼ SDK 项目 · 未检测到                    │
│   未检测到 SDK 项目（.sln / Makefile）    │
│   [选择项目文件]                         │  ← 唯一可操作的按钮
│                                         │
```

激活后（有项目）：

```
│ ▼ SDK 项目                              │
│   当前项目: NemoSDK [切换]               │
│   构建模式: [debug] [release]            │
│   目标架构: [x86] [x64]                  │
│                                         │
```

#### 环境配置

```
┌─────────────────────────────────────────┐
│ 环境配置                                 │
│ 管理构建工具链                            │
│                                         │
│ ▼ Qt 工具链                             │
│   Visual Studio: VS 2022 Community ✓    │
│   Qt: 5.15.13 (msvc2019) ✓             │
│   jom: ✓                                │
│                                         │
│ ▶ SDK 工具链 · 未检测到                  │
│                                         │
│ [重新扫描工具链]                         │
└─────────────────────────────────────────┘
```

SDK 工具链激活后：

```
│ ▼ SDK 工具链                            │
│   Visual Studio: VsDevCmd.bat ✓         │
│   [修改路径]                             │
│                                         │
```

#### 远程同步

通用功能，不区分模块。只要有任一模块激活就可用。

```
┌─────────────────────────────────────────┐
│ 远程同步                                 │
│ 将变更文件同步到远程服务器                 │
│                                         │
│ （正常显示同步配置，无模块区分）           │
└─────────────────────────────────────────┘
```

无任何模块激活时：

```
│ 未检测到项目，远程同步不可用              │
```

#### 高级

Qt 相关配置。无 Qt 项目时显示提示。

```
┌─────────────────────────────────────────┐
│ 高级配置                                 │
│                                         │
│ 提醒                                    │
│   文件同步提醒: [✓]                      │
│   QMake 提醒: [✓]                       │
│                                         │
└─────────────────────────────────────────┘
```

### 交互规则

| 状态 | section header | 展开内容 |
|------|---------------|---------|
| 激活 + 有项目 | `▼ Qt 项目` | 完整配置 |
| 激活 + 无项目 | `▼ Qt 项目` | 项目选择 + 配置（默认值） |
| 未激活 | `▶ SDK 项目 · 未检测到` | 提示 + 选择项目按钮 |

### 视觉规范

- section 用 `<details>` 实现折叠
- 激活模块默认 `open`，未激活默认折叠
- header 字体 14px 加粗，未激活时追加灰色摘要文字
- 不使用灰色遮罩、不使用 `pointer-events: none`
- 未激活展开后，只显示提示文字和项目选择按钮，不显示其他配置项
- 配置项之间间距紧凑（8-12px），section 之间 16px

### 数据依赖

`TemplateData` 需要：
- `qtActive: boolean` — Qt 模块是否激活（resolveProjectRoot('qt') 非空）
- `sdkActive: boolean` — SDK 模块是否激活（resolveProjectRoot('sdk') 非空）

### 改动文件

- `src/ui/configPanel/pages/project.ts` — 重写 Qt/SDK section
- `src/ui/configPanel/pages/env.ts` — 重写，加 SDK 工具链 section
- `src/ui/configPanel/pages/sync.ts` — 改禁用条件
- `src/ui/configPanel/pages/advanced.ts` — 改禁用条件
- `src/ui/configPanel/pageCss.ts` — 调整 section 样式
- `src/ui/configPanel/template.ts` — 加 qtActive/sdkActive 字段
- `src/ui/configPanel/templateData.ts` — 填充 qtActive/sdkActive
- `src/ui/configPanel/index.ts` — 填充 qtActive/sdkActive
- `src/test/configPanelHtml.test.ts` — 更新测试数据
- `src/test/fileReminderSettings.test.ts` — 更新测试数据
