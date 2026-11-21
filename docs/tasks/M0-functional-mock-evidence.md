# 功能性 mock：回答证据

[T-M0-06](M0.md#t-m0-06) 保持未勾选。

## 做了什么

- mock 模式把已经采纳、且原文含 `[FUNCTIONAL-MOCK]` 的采样槽位写入现有 Observation。重复点击沿用同一操作标识。
- 另外写入一条消费者人工存证：采集方式 `manual`，定位符 `functional-mock://consumer-capture/1`，采集人 `functional-mock-collector`。引用 URL 只是占位，没有抓取。
- 回答列表和运行详情都能触发这一步。现有证据页不重做。

## Mock 边界

没有真实供应商原文，没有真实消费者截图，没有真实采集人。证据状态只说明 mock 记录通过了现有完整性校验。

## 不能当作真实验收

不勾选 T-M0-06。已勾选的 T-M0-07 / T-M0-08 可以读这些记录，但读到 mock 不等于试点投递。
