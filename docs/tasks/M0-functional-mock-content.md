# 功能性 mock：草稿与审核导出

[T-M0-09](M0.md#t-m0-09) 与 [T-M0-10](M0.md#t-m0-10) 保持未勾选。

## 做了什么

- 内容列表在 mock 模式提供一个按钮，复用现有 Brief、模板生成、送审、批准和导出命令。
- 正文来自已批准的 mock 事实主张，标题带 `[FUNCTIONAL-MOCK]`。不调用付费模型。
- 在送审前把标识 profile 版本写成 `functional-mock`、状态写成 `verified`。这是页面上已有的 fixture 字段，不是真实渠道核验。
- 导出沿用现有预检和确认。重复点击使用稳定操作标识。

## Mock 边界

没有真实生成，没有真实渠道标识，没有对象存储。主页面是 `https://functional-mock.example.com/faq`，不会去抓取。

## 不能当作真实验收

不勾选 T-M0-09 或 T-M0-10。导出成功仍然不是公开发布。
