# Templates

本目录承载任务类型模板。

模板列表：

- `new-feature.md`
- `bug-fix.md`
- `refactor.md`
- `ui-adjustment.md`
- `cross-module-change.md`

选择规则：

- 新增功能或新页面：`new-feature.md`
- 修复异常或回归：`bug-fix.md`
- 调整结构但不改目标行为：`refactor.md`
- 样式或交互局部调整：`ui-adjustment.md`
- 涉及多模块协同改动：`cross-module-change.md`

默认要求：

- 先匹配最接近的主模板
- 只补最小分析点；默认内联到 Requirement / Design gate，不单独输出模板段落
- 命中多个模板时，以主模板为主，次模板只补缺的边界

任务尺寸：

- `tiny`：模板只取 2-3 个关键字段，仍要输出 Requirement / Design gate
- `normal`：使用模板默认最小分析点
- `long-running`：模板字段之外，必须先有阶段级 todo/checklist、执行顺序和当前第一工作包

示例：

```text
Refactor gate
- 目标：精简流程文档重复说明
- 边界：只改 harness/process 文档，不改业务代码
- 整理点：任务尺寸、职责分层、收口证据
- 验证：Markdown 静态检查和 diff 审阅
```
