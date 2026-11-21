# 功能性 mock：自行发布与公开核验

[T-M0-11](M0.md#t-m0-11) 保持未勾选。

提交：`0508460d94f5ba1d0995b01b61c68057ea42c14e`

## 做了什么

- mock 模式对已批准且正文含 `[FUNCTIONAL-MOCK]` 的内容版本调用现有发布命令。
- 核验输入是内存 fixture：公开、HTTP 200、正文包含 mock 事实主张。不设置 `GEO_PUBLIC_PAGE_FETCH`，也不发起抓取。
- 发布地址是 `https://functional-mock.example.com/published`。渠道声明写明这是合成获准站点。
- 同一操作标识重复提交会返回已有记录。

## Mock 边界

没有获准用户站点，没有真实发布。分类器若给出 `verified_public`，只表示这份内存页面与 mock 主张匹配，不是公开生效。

## 不能当作真实验收

不勾选 T-M0-11。登录墙、草稿和主张不匹配仍然不会被写成已公开生效；本路径只提供一份标明的合成页。
