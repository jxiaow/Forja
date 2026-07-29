# Adapter Profiles

profiles 是可选参考，不属于默认通用模板。

使用方式：

1. 先复制 `_template/` 生成最小通用 adapter。
2. 再按项目技术栈从 profiles 中挑选规则思路。
3. 只复制适用内容；不适用的 profile 不进入 `project/local/`。

已有项目适配层可以继续使用 `project/local/rules/` 中的具体规则；新仓库不应默认继承这些技术栈假设。
