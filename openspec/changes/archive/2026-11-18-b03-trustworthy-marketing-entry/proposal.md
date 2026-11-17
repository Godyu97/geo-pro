# Proposal

## Why

M0 / R-M0-01、T-M0-01 的 B03（Issue #3）要求访客理解产品价值和当前开放范围。现有官网已有规划模块，但缺少适用客群、真实试点前置条件及按有效身份分流的入口，容易混淆基础账号体验与真实业务开放。

## What Changes

- 补齐中英文客群、当前账号/空工作台、未开放品牌建档、无真实监测通道与试点前置条件说明。
- 官网依据已有服务端会话状态显示开始体验、登录或继续工作台；未配置和故障不假称已登录或正常可用。
- 明示流程为产品方向示意，不展示虚构案例、覆盖、效果或免费额度。
- 建立公开文案依据、维护责任和更新条件记录，补齐双语言、三种宽度、键盘、身份与故障验收。

## Capabilities

### New Capabilities

- `public-product-entry`: 公开官网的可信能力说明、身份入口与可访问双语言导航。

### Modified Capabilities

无。复用 `account-session` 的权威身份和工作台返回行为，不修改其合同。

## Impact

- 影响官网薄路由、`src/features/marketing/`、两种语言消息、浏览器验收和 B03 交付记录。
- 依据：Intent §1–2/6、PRD PAGE-01 与 §8、公共 SPEC ui-i18n-v1、Issue #3 D5。
- 只复用 `getSessionState`，不修改认证选项、Schema/migration、DAO、缓存或依赖；已有 Playwright 可直接复用（配置中的旧测试现状以 package.json 和治理当前事实为准）。
- Out-of-Scope：B04 品牌引导/草稿/归属、B09 能力台账、B16/B17 邮件、数据请求渠道本身、真实试点开放、定价/CMS，以及 M1/M2。B04 上线后由工作台接入真实品牌引导，本次不创建虚假品牌入口。
