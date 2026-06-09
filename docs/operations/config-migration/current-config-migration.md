# Config Migration: 配置存储迁移到用户数据目录

> Status date: 2026-06-09

- [Execution Board](./config-migration-board.md)
- [Verification Matrix](./config-migration-matrix.md)
- [Decision Log](./config-migration-decisions.md)

## 1. Current Conclusion

- Primary goal: 将旧项目目录配置迁移到用户数据目录 `~/.forja/projects/`，保持项目目录干净
- Current assessment: 已完成；Qt、SDK、sync 配置按类型写入 `~/.forja/projects/<hash>.json`
- Current biggest issue: 后续需保持文档、测试和脚本注释与 Forja 命名一致

## 2. Stage-Level Todo

### Stage 1: settingsIO 层改造

- Goal: 将配置读写路径改为 `~/.forja/projects/<hash>.json`，平铺格式，不加 qt/sdk/sync 前缀分组
- Non-goal: 不改 CLI 参数接口，不改 VSCode 命令 ID
- Completion criteria: loadSettings/saveSettings 读写新路径；单元测试通过

### Stage 2: sync 配置分离 + 向上查找

- Goal: sync 配置独立存储（workspace 级），读取时向上一级查找
- Non-goal: 不改 sync 的功能逻辑
- Completion criteria: 三种场景（打开 dev/、多根、单独打开子目录）都能正确读到 sync 配置

### Stage 3: 去除项目目录下的旧配置目录

- Goal: init 不再在项目目录下创建旧配置目录；旧数据由用户自行清理
- Non-goal: 不强制删除用户已有旧配置目录
- Completion criteria: 新 init 不产生项目目录下旧配置目录；CLI 和 VSCode 扩展功能正常

### Stage 4: cleanup 命令

- Goal: 提供 `forja cleanup` 清理已删除/移动项目的残留配置
- Non-goal: 不自动清理
- Completion criteria: 命令能扫描并列出/删除无效配置文件

## 3. Execution Order

1. Stage 1: settingsIO 层改造
2. Stage 2: sync 配置分离
3. Stage 3: 去除项目目录旧配置目录
4. Stage 4: cleanup 命令

Current next item: complete
