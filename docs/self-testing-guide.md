# Forja v2 自测验证指南

本文档提供完整的自测流程，帮助你验证 Forja v2 命令面的功能完整性。

## 目录

- [环境准备](#环境准备)
- [基础命令测试](#基础命令测试)
- [远程配置测试](#远程配置测试)
- [高级功能测试](#高级功能测试)
- [边界条件测试](#边界条件测试)
- [常见问题排查](#常见问题排查)

---

## 环境准备

### 1. 编译项目

```bash
npm run compile
```

### 2. 全局链接（可选）

```bash
npm link
```

这样可以在任意目录使用 `forja` 命令。

### 3. 准备测试工作区

创建一个测试目录：

```bash
mkdir forja-test
cd forja-test
git init
```

---

## 基础命令测试

### 1. 状态查看

```bash
# 查看当前状态（应该提示未配置）
forja status --json

# 预期输出：ok: false, 提示需要 init 或 use target
```

### 2. 初始化

```bash
# 自动初始化
forja init --json

# 如果有 .pro 文件，应该自动检测
# 如果没有，提示使用 use target
```

### 3. 列表命令

```bash
# 列出可用目标
forja list targets --json

# 列出服务器
forja server --json

# 列出环境
forja list env --json

# 列出远程配置
forja remote --json

```

### 4. 使用命令

```bash
# 选择目标项目
forja use target --project src/app.pro --json

# 设置模式
forja use target --mode release --json

# 设置架构
forja use target --arch x64 --json

# 切换执行位置
forja use target --run-at remote --json
forja use target --run-at local --json
```

### 5. 构建命令

```bash
# 查看构建计划（不执行）
forja build --plan --json

# 执行构建
forja build --json

# 清理后重新构建
forja build fresh --json

# 仅运行 qmake
forja build qmake --json
```

### 6. 运行命令

```bash
# 前台运行
forja run --json

# 后台运行
forja run --detach --json

# 打开 Qt Designer
forja run designer src/main.ui --json
```

### 7. 停止和清理

```bash
# 停止运行中的程序
forja stop --json

# 清理构建产物
forja clean --json
```

---

## 远程配置测试

### 1. 添加服务器

```bash
# 添加测试服务器
forja server add --name test-server --host 192.168.1.100 --username dev --json

# 预期输出：ok: true, 包含 server id
```

### 2. 配置远程执行

```bash
# 设置远程服务器和路径
forja remote set --server <server-id> --remote-path /home/dev/workspace --json

# 验证配置
forja remote --json
```

### 3. Qt 工具链配置

```bash
# 设置 Qt 路径
forja use target --qt /opt/Qt/5.15.2/gcc_64 --json

# 设置 VS 路径（Windows）
forja use target --vs "C:\Program Files\Microsoft Visual Studio\2022\Community" --json

# 设置 jom 路径
forja use target --jom /opt/Qt/Tools/jom --json
```

### 4. C++ 工具链配置

```bash
# 设置 VS 路径（Windows）
forja use target --vs "C:\Program Files\Microsoft Visual Studio\2022\Community" --json
```

---

## 高级功能测试

### 1. 同步命令

```bash
# 查看同步计划
forja sync --dry-run --json

# 同步单个文件
forja sync --file src/main.cpp --json

# 同步指定仓库
forja sync --repo qt_client --json

# 重置同步状态
forja sync reset --json
```

### 2. 诊断命令

```bash
# 本地诊断
forja doctor --json

# 远程诊断
forja doctor --remote --json

# 修复远程问题
forja doctor fix --remote --json
```

### 3. 服务器管理

```bash
# 列出所有服务器
forja server --json

# 查看服务器详情
forja server --detail <server-id> --json

# 更新服务器
forja server update <server-id> --host 192.168.1.101 --json

# 删除服务器
forja server remove <server-id> --json
```

---

## 边界条件测试

### 1. 无效参数测试

```bash
# 未知的 list 分类
forja list invalid --json
# 预期：ok: false, 错误提示

# 未知的 build 子命令
forja build invalid --json
# 预期：ok: false, 错误提示

# 未知的 sync 动作
forja sync invalid --json
# 预期：ok: false, 错误提示

# 无效的端口号
forja server add --name test --host 127.0.0.1 --username dev --port abc --json
# 预期：ok: false, 端口验证错误
```

### 2. 参数缺失测试

```bash
# use target 查看配置
forja use target --json
# 预期：ok: true, 显示当前 target 配置

# use target --run-at 无效值
forja use target --run-at invalid --json
# 预期：ok: false, 提示 --run-at 只接受 local 或 remote

# remote set 缺少 --server
forja remote set --json
# 预期：ok: false, 提示缺少必要参数
```

---

## 常见问题排查

### 1. 命令找不到

**问题**：运行 `forja` 提示命令找不到

**解决**：
```bash
# 检查是否已链接
npm link

# 或直接使用 node 运行
node out/cli/index.js status --json
```

### 2. 配置未生效

**问题**：修改配置后命令行为未改变

**解决**：
```bash

# 清除配置重新初始化
# 清除 workroot 注册（谨慎操作）
forja init --json
```

### 3. 远程命令失败

**问题**：远程命令提示服务器未配置

**解决**：
```bash
# 检查服务器配置
forja server --json

# 检查远程配置
forja remote --json

# 重新配置
forja remote set --server <id> --remote-path <path> --json
```

### 4. nextActions 显示旧命令

**问题**：错误提示中显示 `forja qt ...` 旧命令

**解决**：
这是已知问题，已在 build/run/clean 中添加映射逻辑。如果仍然看到旧命令，请检查：
- 是否使用了最新编译的代码
- 错误是否来自 qtCore.ts 内部（部分内部错误仍可能显示旧命令）

### 5. list remote repos 段字段完整性

**问题**：`forja remote` 的 repos 段需包含 baseline/overlay/mount 等字段

**解决**：
已修复。`RemoteConfigDetail.repos` 字段包含完整的 `RemoteRepoSettings` 定义。

---

## 测试检查清单

使用以下清单确保所有功能已验证：

### 基础命令
- [ ] `forja status --json`
- [ ] `forja init --json`
- [ ] `forja list targets --json`
- [ ] `forja server --json`
- [ ] `forja list env --json`
- [ ] `forja remote --json`
- [ ] `forja use target --project <path> --json`
- [ ] `forja use target --run-at remote --json`
- [ ] `forja build --json`
- [ ] `forja run --detach --json`
- [ ] `forja stop --json`
- [ ] `forja clean --json`

### 远程配置
- [ ] `forja server add --name <name> --host <host> --username <user> --json`
- [ ] `forja remote set --server <id> --remote-path <path> --json`

### 高级功能
- [ ] `forja sync --dry-run --json`
- [ ] `forja doctor --remote --json`
- [ ] `forja run designer <ui-file> --json`

### 边界条件
- [ ] 无效参数返回错误
- [ ] 参数缺失提示

---

## 自动化测试脚本

创建一个简单的测试脚本：

```bash
#!/bin/bash
# test-forja.sh

set -e

echo "=== Forja v2 自动化测试 ==="

# 1. 基础命令
echo "测试基础命令..."
forja status --json > /dev/null
forja list targets --json > /dev/null
forja server --json > /dev/null
forja list env --json > /dev/null
echo "✓ 基础命令通过"

# 2. 错误处理
echo "测试错误处理..."
if forja list invalid --json 2>/dev/null; then
  echo "✗ 应该拒绝无效分类"
  exit 1
fi
echo "✓ 错误处理通过"

# 3. 参数验证
echo "测试参数验证..."
if forja use target --run-at invalid --json 2>/dev/null; then
  echo "✗ 应该拒绝无效的 --run-at 值"
  exit 1
fi
echo "✓ 参数验证通过"

echo ""
echo "=== 所有测试通过 ==="
```

使用方法：
```bash
chmod +x test-forja.sh
./test-forja.sh
```

---

## 总结

本文档覆盖了 Forja v2 的主要功能和边界条件。按照以下步骤进行自测：

1. **环境准备**：编译项目，全局链接
2. **基础命令**：逐个测试 status/init/list/use/build/run/stop/clean
3. **远程配置**：测试 server/remote set
4. **高级功能**：测试 sync/doctor/designer
5. **边界条件**：测试无效参数、安全校验、必填字段
6. **问题排查**：参考常见问题部分

如果所有测试通过，说明 v2 命令面功能完整且稳定。
