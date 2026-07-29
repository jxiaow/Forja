# Decision Log

> Status date: 2026-06-09

## DEC-001 配置存储位置

- Date: 2026-05-20
- Conclusion: 所有项目配置存放在用户数据目录 `~/.forja/projects/` 下，不在项目目录下创建旧配置目录
- Reason: 保持项目目录干净，不需要 .gitignore 排除
- Impact: 项目移动/删除后配置残留，需 cleanup 命令清理
- Reopen condition: 如果用户强烈需要配置跟着项目走（如团队共享配置）

## DEC-002 配置文件命名

- Date: 2026-05-20
- Conclusion: 文件名用 workspace 完整路径的 sha256 前 12 位，文件内容带 `workspace` 字段标识来源
- Reason: 避免路径特殊字符和长度问题
- Impact: 用户无法从文件名直接看出对应哪个项目，需打开文件看 workspace 字段
- Reopen condition: 如果 hash 冲突成为实际问题

## DEC-003 配置格式

- Date: 2026-05-20
- Conclusion: 每个配置文件只存一种配置（qt 或 sdk 或 sync），字段平铺不加前缀分组
- Reason: 每个目录只有一种项目类型，不需要混合；平铺更简洁
- Impact: 场景 1（打开 dev/）时 qt 和 sdk 配置分别在各自子目录对应的配置文件里，不在 dev/ 的配置文件里
- Reopen condition: 如果出现一个目录同时是 qt 和 sdk 项目的情况

## DEC-004 sync 配置归属

- Date: 2026-05-20
- Conclusion: sync 是工作空间级配置，存在 workspace 根目录对应的配置文件里；子目录读取时向上一级查找
- Reason: sync 包含 qt 和 sdk 两种项目的同步，不属于某个子项目
- Impact: 需要实现向上一级查找逻辑
- Reopen condition: 如果不同子项目需要完全独立的 sync 配置

## DEC-005 旧配置兼容

- Date: 2026-05-20
- Conclusion: 不做兼容，不做迁移。直接切到新路径，旧项目目录配置由用户自行删除
- Reason: 用户明确不需要兼容，减少代码复杂度
- Impact: 升级后需要重新 init
- Reopen condition: 无
