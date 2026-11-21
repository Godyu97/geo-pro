# 功能性 mock：品牌入口

[T-M0-01](M0.md#t-m0-01) 保持未勾选。本文只记录标明的 mock 路径，不是 AC-M0-01 的真实验收。

## 做了什么

- `GEO_FUNCTIONAL_MOCK=1` 且请求主机与 `BETTER_AUTH_URL` 一致时，品牌读写进入 `mock` 模式。回环上的 `GEO_BRANDS_FIXTURE=1` 仍然优先，正式五项记录仍然单独判断。
- 现有三步建档表单不重做。mock 模式多一个「填入 mock 品牌资料」按钮，字段带 `[FUNCTIONAL-MOCK]`，保存仍走原有校验。
- 工作台和侧栏把这个模式标成功能性 mock，不写成正式建档或真实监测。

## Mock 边界

品牌名、一句话业务、别名、竞品和问题草稿都是仓库内的合成文案。没有真实品牌资料，没有邮件投递、账户恢复、保留披露、备份演练或获准试点。`readPilotAdmission().realIntakeOpen` 在只打开这个开关时仍为 false。

## 不能当作真实验收

- 不勾选 T-M0-01，不关闭 Issue #21。
- mock 行写进开发库后仍然是 mock，不能拿去申报试点。
