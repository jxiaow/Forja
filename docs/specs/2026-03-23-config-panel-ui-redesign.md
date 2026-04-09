# Qt Pilot 配置面板 UI 重设计

日期: 2026-03-23

## 概述

重新设计 Qt Pilot 扩展的配置面板 UI，改进视觉层次、简化交互流程、提升用户体验。只包含现有功能，不新增功能。

## 设计目标

### 主要问题
当前配置面板存在以下问题：
1. **视觉层次不清** - 信息堆叠，重点不突出
2. **操作繁琐** - 每个区块都有独立的保存按钮
3. **状态指示分散** - 环境状态在各区块重复显示
4. **整体风格过时** - UI 看起来老旧

### 设计原则
1. **状态优先** - 环境状态一目了然
2. **自动保存** - 修改即时生效，无需手动保存
3. **渐进式展示** - 常用信息直接显示，不常用的折叠隐藏
4. **紧凑布局** - 减少重复文字，信息密度适中

## UI 结构设计

### 区块划分

```
┌─────────────────────────────────────┐
│ 环境状态（顶部，始终可见）            │
│ ● ● ○ VS 2022 · Qt 6.5 · jom 未找到 │
│                           [展开 ▼]  │
├─────────────────────────────────────┤
│ 项目                                 │
│ my-project                   [切换] │
│ ▶ 高级设置                          │
│   ├─ C 标准 / C++ 标准              │
│   ├─ 排除目录                       │
│   └─ [生成 IntelliSense 配置]       │
├─────────────────────────────────────┤
│ Visual Studio                       │
│ ● Visual Studio      自动检测       │
│ C:\...\Launch-VsDevShell.ps1       │
│ ▼ 手动覆盖                          │
│   ├─ [快速选择版本]                  │
│   └─ [路径输入] [浏览]               │
├─────────────────────────────────────┤
│ Qt                                  │
│ ● Qt                自动检测        │
│ C:\Qt\6.5.3\msvc2019_64            │
│ ▼ 手动覆盖                          │
│   └─ [路径输入] [浏览]               │
└─────────────────────────────────────┘
```

### 各区块详细设计

#### 1. 环境状态区块

**功能**: 显示 VS、Qt、jom 的检测状态

**布局**:
- 三色状态指示灯（绿=正常，黄=警告，灰=检测中）
- 摘要文本："VS 2022 · Qt 6.5 · jom 未找到"
- 展开按钮（▼）

**展开后显示**:
```
● VS 2022 Community
● Qt 6.5.3 (msvc2019_64)
○ jom 未找到
[刷新检测]
```

**交互**:
- 点击区块或展开按钮，展开/收起详情
- 点击"刷新检测"按钮，重新检测环境

#### 2. 项目区块

**功能**: 项目选择、C/C++标准、排除目录、生成 IntelliSense

**布局**:
- 项目名称（大字体，突出显示）
- 切换按钮（右侧）
- 高级设置（折叠）

**高级设置展开后**:
```
C 标准        C++ 标准
[ C11 ▼ ]    [ C++17 ▼ ]

排除目录
[ thirdparty, vendor        ]
已内置: build*, debug, release

[生成 IntelliSense 配置]
```

**交互**:
- 点击"切换"按钮，调用 `vscode.commands.executeCommand('qtPilot.selectProject')`，弹出 QuickPick 列表让用户选择项目
- 选择 C/C++ 标准，自动保存
- 输入排除目录，自动保存
- 点击"生成 IntelliSense 配置"，执行生成

#### 3. Visual Studio 区块

**功能**: VS DevShell 路径配置

**布局**:
- 状态指示灯 + 标题
- 来源标签（自动检测/手动配置）
- 检测到的路径
- 手动覆盖（折叠）

**快速选择版本下拉框选项**:
| 选项值 | 显示文本 | 填充路径 |
|--------|----------|----------|
| 2022_community | VS 2022 Community | C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\Launch-VsDevShell.ps1 |
| 2022_professional | VS 2022 Professional | C:\Program Files\Microsoft Visual Studio\2022\Professional\Common7\Tools\Launch-VsDevShell.ps1 |
| 2022_enterprise | VS 2022 Enterprise | C:\Program Files\Microsoft Visual Studio\2022\Enterprise\Common7\Tools\Launch-VsDevShell.ps1 |
| 2019_community | VS 2019 Community | C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\Common7\Tools\Launch-VsDevShell.ps1 |
| 2019_professional | VS 2019 Professional | C:\Program Files (x86)\Microsoft Visual Studio\2019\Professional\Common7\Tools\Launch-VsDevShell.ps1 |
| 2019_enterprise | VS 2019 Enterprise | C:\Program Files (x86)\Microsoft Visual Studio\2019\Enterprise\Common7\Tools\Launch-VsDevShell.ps1 |

**交互**:
- 快速选择版本：选择后自动填充路径到输入框
- 路径输入：失焦后自动保存
- 浏览按钮：发送 `browse` 消息，后端调用 `vscode.window.showOpenDialog()` 打开文件选择器（.ps1 文件）

#### 4. Qt 区块

**功能**: Qt 路径配置

**布局**:
- 状态指示灯 + 标题
- 来源标签（自动检测/手动配置）
- 检测到的路径
- 手动覆盖（折叠）

**交互**:
- 路径输入：失焦后自动保存
- 浏览按钮：发送 `browse` 消息，后端调用 `vscode.window.showOpenDialog()` 打开目录选择器

## 视觉设计

### 颜色方案

采用深色主题，基于 VSCode 主题变量：

| 元素 | 颜色 | CSS 变量 |
|------|------|----------|
| 背景 | #0F172A | --vscode-sideBar-background |
| 卡片背景 | #1E293B | --vscode-input-background |
| 边框 | #334155 | --vscode-input-border |
| 主文字 | #F8FAFC | --vscode-foreground |
| 次要文字 | #94A3B8 | --vscode-descriptionForeground |
| 成功状态 | #22C55E | --vscode-testing-iconPassed |
| 警告状态 | #F59E0B | --vscode-statusBarItem-warningBackground |
| 按钮 | #334155 | --vscode-button-secondaryBackground |

### 字体

使用 VSCode 默认字体：
```css
font-family: var(--vscode-font-family);
font-size: var(--vscode-font-size);
```

### 间距

- 区块内边距: 12px
- 区块间距: 1px（边框分隔）
- 元素间距: 8px
- 折叠内容边距: 10px

### 圆角

- 卡片: 6px
- 输入框: 4px
- 按钮: 4px

## 交互设计

### 自动保存机制

所有配置项修改后自动保存，无需手动点击保存按钮：

| 配置项 | 触发时机 |
|--------|----------|
| C 标准 | select change 事件 |
| C++ 标准 | select change 事件 |
| 排除目录 | input blur 事件 |
| VS DevShell 路径 | input blur 事件 |
| Qt 路径 | input blur 事件 |

### 折叠/展开动画

使用 CSS transition 实现平滑动画：
```css
transition: max-height 0.2s ease-out;
```

### 状态指示灯动画

检测中状态使用脉冲动画：
```css
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
```

## 数据流

### 初始化流程

```
1. ConfigPanel.resolveWebviewView() 被调用
2. 调用 detectEnv() 获取环境信息
3. 调用 getCurrentProject() 获取当前项目
4. 调用 _getHtml() 生成 HTML
5. postMessage 推送环境状态更新
```

### 状态更新流程

```
用户操作 → postMessage → extension.ts 处理
         → 更新配置 → 重新检测环境 → postMessage 推送更新
```

### 消息类型

| 消息 | 方向 | 说明 |
|------|------|------|
| refreshEnv | 前端→后端 | 刷新环境检测 |
| selectProject | 前端→后端 | 调用 qtPilot.selectProject 命令 |
| saveExcludeDirs | 前端→后端 | 保存排除目录到 qtPilot.scanExcludeDirs 配置 |
| generateIntelliSense | 前端→后端 | 生成 c_cpp_properties.json |
| browse | 前端→后端 | `{ targetId: string, isDir: boolean }` 打开文件/目录选择器，选择后发送 setPath |
| envUpdated | 后端→前端 | 环境状态更新 |
| setPath | 后端→前端 | `{ targetId: string, value: string }` 设置输入框值 |

## 错误处理

### 环境检测失败

- 状态指示灯显示警告色（黄色）
- 文本显示"未检测到"或"未找到"
- 用户可以手动配置覆盖

### 配置保存失败

- 显示错误消息：`vscode.window.showErrorMessage()`
- 不阻塞用户操作，允许重试

### IntelliSense 生成失败

- 显示警告消息
- 提示用户检查项目配置

### 无效路径输入

- 输入路径后失焦时，不进行路径有效性验证
- 用户可输入任意路径（可能是网络路径或尚未创建的目录）
- 环境检测时会验证路径，若无效则状态显示警告

## 实现要点

### 移除保存按钮

将原来的显式保存改为自动保存：
- 移除所有 `onclick="save()"` 按钮
- 为输入框添加 `blur` 事件监听器
- 为下拉框添加 `change` 事件监听器

### 折叠组件实现

使用 HTML `<details>` 元素实现折叠，语义化且无需额外 JS：
```html
<details>
  <summary style="cursor:pointer;list-style:none;">
    <span class="arrow">▶</span> 高级设置
  </summary>
  <div class="details-content">
    <!-- 折叠内容 -->
  </div>
</details>
```

CSS 样式：
```css
details summary::-webkit-details-marker { display: none; }
details[open] .arrow { transform: rotate(90deg); }
details .arrow { display: inline-block; transition: transform 0.2s; }
```

### 状态指示灯

使用 CSS 实现：
```html
<span class="status-dot ok"></span>
```
```css
.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.status-dot.ok { background: #22C55E; }
.status-dot.warn { background: #F59E0B; }
.status-dot.detecting { 
  background: #64748B;
  animation: pulse 1.2s ease-in-out infinite;
}
```

## 测试要点

1. **自动保存**: 修改任意配置项，检查是否自动保存到 VSCode 配置
2. **折叠/展开**: 点击各区块的折叠按钮，检查动画是否正常
3. **状态指示**: 环境检测完成后，检查状态指示灯颜色是否正确
4. **响应式**: 在不同宽度的侧边栏中检查布局是否正常
5. **深色/浅色主题**: 切换 VSCode 主题，检查颜色是否正确适配
6. **取消文件选择**: 点击浏览按钮后取消选择器，确认输入框值不变
7. **项目选择取消**: 点击切换按钮后取消 QuickPick，确认项目不变
8. **边界情况**: 输入超长路径，检查布局是否正常
