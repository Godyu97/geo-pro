# optimization-tasks Delta

## ADDED Requirements

### Requirement: 受控公开页面抓取

系统 SHALL 在单次最多 5 个 URL 的页面检查中保留显式 fixture。未提供 fixture 且服务端未开启公开抓取时 MUST 记为受控关闭，不得访问网络。开启后 MUST 只读抓取，阻断私网、回环、链路本地、元数据地址及解析到这些地址的主机名，并限制跳转、超时和正文大小。失败结果 MUST NOT 记录解析出的内网地址。可执行指令只作只读标记，不得据此宣称收录。

#### Scenario: 抓取关闭

- **GIVEN** 公开抓取开关未开启
- **WHEN** 对未提供 fixture 的 URL 执行页面检查
- **THEN** 状态为待核验，访问条件标明受控关闭，且不发出网络请求

#### Scenario: 重定向到非公开地址

- **GIVEN** 公开抓取已开启，目标先返回重定向
- **WHEN** 下一跳解析到私网、回环或元数据地址
- **THEN** 检查被阻断，结果不包含该解析地址，也不宣称页面损坏或引擎收录
