# 对象存储功能规格（SPEC）

> 版本：1.0｜上级合同：[对象存储 PRD](01-对象存储需求-PRD.md)｜代码与验证范围见 [交付进度](../tasks/delivery-progress.md)。

<a id="oss-spec"></a>

本规格约束 Next.js 应用如何通过 S3 API 存放 GeoPro 用户文件。本地实现目标是 SeaweedFS 4.54，生产兼容目标是阿里云 OSS 的 S3 API。两套环境只改变端点、区域、桶、密钥和路径风格。

<a id="oss-client"></a>

## 1. 模块边界

| 路径 | 职责 |
| --- | --- |
| `src/lib/storage/` | 服务端 S3 客户端、环境读取、字节写入、读取、删除和预签名。文件首行引入 `server-only` |
| `src/features/stored-objects/` | 对象元数据、归属校验、类别规则和与业务标识的绑定 |
| 既有 `src/features/content/`、`reports/`、`data-exports/`、`brands/` | 继续拥有审批、快照、导出和清除语义，调用对象模块保存字节 |

`src/app/` 只做薄路由。Client Component 不得导入 `src/lib/storage/`。密钥、桶名和未授权对象键不进入页面 props。

依赖只增加 `@aws-sdk/client-s3` 与 `@aws-sdk/s3-request-presigner`。业务代码通过 `src/lib/storage/` 使用它们，不在功能模块里各自 `new S3Client`。

<a id="oss-sdk"></a>

## 2. 客户端

服务端客户端和浏览器签名客户端分开构造，避免把回环地址签进浏览器链接。

```ts
import { S3Client } from "@aws-sdk/client-s3";

function createClient(endpoint: string) {
  return new S3Client({
    region: required("S3_REGION"),
    endpoint,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    credentials: {
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    },
  });
}
```

约束：

1. 服务端客户端必须配置 `S3_ENDPOINT`、`S3_REGION`、桶和凭据。浏览器签名使用单独配置的 `S3_ENDPOINT_BROWSER`，缺失时签发失败。
2. `S3_FORCE_PATH_STYLE` 只有精确等于 `false` 时才关闭路径风格。本地 SeaweedFS 保持开启；阿里云 OSS 设为 `false`。
3. 区域参与 SigV4，但请求发往 `endpoint`。阿里云使用 OSS 地域标识，例如控制台给出的 `oss-cn-hangzhou`，由环境变量提供，源码不写死地域。
4. 若所选 SDK 版本默认附加 `aws-chunked`、CRC32 或 `x-amz-checksum-*` 请求头，客户端必须关闭该默认行为。应用自己计算 SHA-256。上传使用普通 `PutObject` 字节体，保证 SeaweedFS 与阿里云 OSS 都能接受。
5. 应用调用限于 `PutObject`、`GetObject`、`HeadObject`、`DeleteObject`。不向用户提供 `ListBucket`。服务端内部不得用桶列举代替主键查询。
6. 预签名只签 `GetObject`，默认 300 秒，上限 900 秒。签名客户端使用 `S3_ENDPOINT_BROWSER`。返回前不得改写协议、主机或端口。
7. 浏览器预签名响应带附件 `Content-Disposition` 和已登记的 `Content-Type`。对象 ACL 保持私有，不设置公共读。

<a id="oss-keys"></a>

## 3. 键与元数据

键格式：

```text
v1/{ownerId}/{scopeId}/{class}/{objectId}/{fileName}
```

`scopeId` 是品牌标识；本人导出没有品牌时使用固定段 `account`。`fileName` 只保留基名，去掉路径分隔符和 `..`，长度 1–120。调用方传入的字符串不能决定 `ownerId`、`scopeId`、`class` 或 `objectId`。

元数据表 `stored_object` 同时有 PostgreSQL 与 SQLite 迁移，字节不写入该表。

| 字段 | 规则 |
| --- | --- |
| `id` | 主键，即 `objectId` |
| `owner_id` | 账号归属，必填 |
| `brand_id` | 品牌文件必填；本人导出为空 |
| `class` | 第 4 节类别之一 |
| `visibility` | `internal` 或 `public`。仅 `authorized-media` 可以是 `public`；其余类别固定 `internal` |
| `status` | `pending`、`ready`、`failed`、`tombstoned` |
| `bucket` | 写入时的桶名 |
| `object_key` | 完整键 |
| `content_type` | 允许列表中的类型 |
| `byte_size` | 十进制字节数，1 至类别上限 |
| `sha256` | 小写十六进制 SHA-256 |
| `file_name` | 清洗后的文件名。清除后置空 |
| `immutable` | 交付包、报告、导出、核验证据为 1 |
| `created_at` / `ready_at` / `deleted_at` | ISO 时间 |

索引至少覆盖：`(owner_id, brand_id, class, created_at, id)`、`(brand_id, created_at, id)`、主键和 `object_key` 唯一。按这些路径批量读取，不用逐键查询业务表。

已有内联数据保持可读。`files_json`、`html_bytes`、`json_bytes` 中的历史正文仍从数据库返回。新写入的交付包和报告把正文放到对象存储，行内改为对象标识、文件名、类型、字节数和 SHA-256。本规格不要求把历史大字段搬迁进桶。

<a id="oss-commands"></a>

## 4. 命令

### 4.1 保存

1. 校验会话、品牌归属、类别、类型和大小。失败则不建记录。
2. 插入 `pending` 行并提交对象键。
3. `PutObject`。随后 `GetObject`，核对字节数与 SHA-256。
4. 核对通过后把行更新为 `ready`。用户可见的成功只来自 `ready`。
5. 上传或核对失败时把行标为 `failed`，并 `DeleteObject`。删除失败时保留 `failed` 行供同一品牌的下一次写入重试清理。响应不返回存储端错误原文。
6. `immutable = 1` 的 `ready` 对象拒绝再次 `PutObject`。

### 4.2 读取与预签名

读取 `ready` 对象前重新加载业务授权：

- 品牌文件要求当前用户仍拥有该品牌，且品牌未处于冻结后的普通拒绝状态。
- `internal` 对象要求内部资料权限。M0 由品牌负责人持有。
- 正式交付包组装时，解析图片引用只能取 `class=authorized-media`、`visibility=public`、审核通过且权利有效的 `ready` 对象。`internal-material` 与 `publication-evidence` 即使键已知也不能打进正式包。
- 本人导出只允许记录上的 `owner_id`。范围、指纹或记录被替换后，旧对象的下载失败。
- 素材 `revoked` / `expired` 或成员授权已撤销时，预签名失败，历史行保留。

服务端处理文件使用 `GetObject` 与 `S3_ENDPOINT`。交给浏览器的地址使用第 2 节的预签名。两种地址都不再做主机替换。

### 4.3 删除

业务清除到期后：

1. 用当时的 `object_key` 调用 `DeleteObject`。对象已不存在视为删除成功。
2. 删除成功后把行标为 `tombstoned`，清空 `file_name` 和 `object_key`。
3. 保留 `id`、`owner_id`、`brand_id`、`class`、`byte_size`、`sha256`、`created_at`、`deleted_at`。
4. 审计和用户界面不再显示正文、预签名 URL 或原文件名。

冻结只改变授权结果，不立即删除字节。

<a id="oss-mapping"></a>

## 5. 与现有业务对象的对应

| 业务动作 | 对象类别 | 既有合同 |
| --- | --- | --- |
| 登记内部附件 | `internal-material` | [S-M0-02](../specs/M0.md#s-m0-02)、[S-M0-10](../specs/M0.md#s-m0-10) |
| 登记封面、正文图 | `authorized-media` | [S-M0-10](../specs/M0.md#s-m0-10) |
| 生成正式包或审阅稿 | `delivery-package` | [S-M0-10](../specs/M0.md#s-m0-10)；正式包文件仍为 `content.md`、`content.html`、`manifest.json`、`public-sources.json`、`publish-checklist.md`，图片可选 |
| 生成报告快照 | `report-snapshot`，HTML 与 JSON 各一对象 | [S-M0-12](../specs/M0.md#s-m0-12) |
| 生成本人导出 | `owned-export` | [S-M0-01](../specs/M0.md#s-m0-01) 的导出与下载限制 |
| 保存人工核验截图 | `publication-evidence` | [S-M0-11](../specs/M0.md#s-m0-11) |
| 导入资料原件 | `source-original` | [S-M1-04](../specs/M1.md#s-m1-04) |

交付包 `manifest` 为每个文件记录对象标识、文件名、内容类型、字节数和 SHA-256。包指纹覆盖这些指纹。审阅稿继续带“非发布用”标记，生成成功仍然不是公开发布。

<a id="oss-failures"></a>

## 6. 失败语义

| 条件 | 结果 |
| --- | --- |
| 缺少服务端端点、区域、桶名或凭据 | 常规启动检查返回配置错误。独立调用存储命令时返回配置失败 |
| 缺少浏览器端点 | 浏览器签发命令返回配置失败，应用内授权下载仍按现有服务端路径处理 |
| 错误密钥 | 对用户为保存或下载失败。自动化测试可断言存储端拒绝，断言里不打印密钥 |
| 端点不可达 | 命令失败且可重试。不得把 `pending` 显示成已保存 |
| 字节或 SHA-256 不一致 | 对象不可下载，记录为 `failed` |
| 超过 10 MiB，或导出范围超过现有 8 MiB | 拒绝该文件或该范围，已成功的同批其他文件保留 |
| 内容类型不在允许列表 | 拒绝，不写对象 |
| 越权、冻结、撤销、未知标识 | 与不存在相同的拒绝，不泄露桶内是否有该键 |
| 预签名过期 | 存储端拒绝。用户回到应用内重新请求下载，应用再次鉴权后重新签名 |

界面文案遵守 `zh-CN` / `en`。错误句包含失败原因类别和下一步，不包含端点、键和堆栈。

<a id="oss-security"></a>

## 7. 安全

- `S3_SECRET_ACCESS_KEY` 只出现在服务端环境。`.env.example` 留空。
- 日志禁止打印密钥、预签名 URL 的签名参数和文件正文。
- 下载响应使用 `private, no-store`。
- 单测使用回环 HTTP mock 实现 S3 的 Put、Get、Head、Delete 和错误签名。mock 不访问 `127.0.0.1:8333`，也不访问阿里云。
- `pnpm env:check` 使用配置的开发桶上传、读回校验并删除一次性探针。清理失败时报告该探针的定位。浏览器预签名与下载在对应授权流程另行验证。

<a id="oss-switch"></a>

## 8. 从 SeaweedFS 切到阿里云 OSS

保留全部变量名，只替换值：

| 变量 | 阿里云 OSS |
| --- | --- |
| `S3_ENDPOINT` | OSS S3 兼容端点，如 `https://oss-cn-hangzhou.aliyuncs.com` |
| `S3_ENDPOINT_BROWSER` | 浏览器能够访问的同一类端点。公网用户与服务端使用同一 HTTPS 端点时，两者相同 |
| `S3_REGION` | 与端点一致的 OSS 地域 |
| `S3_BUCKET` | OSS 桶 |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | 仅授权该桶读写删除的 RAM 密钥 |
| `S3_FORCE_PATH_STYLE` | `false` |

切换验收：同一 Next.js 服务端代码完成 Put、Get、SHA-256 一致、错误密钥拒绝，以及一条用浏览器端点签出的 Get URL 能下载同一字节。桶策略保持私有。应用仍不使用文件浏览基本认证。

本地 SeaweedFS 的运维事实，供配置对照，不构成第二套代码路径：镜像 `chrislusf/seaweedfs:4.54`，桶 `app-files`，区域 `us-east-1`，路径风格开启，宿主机只发布 `8333`（S3）和 `8888`（运维文件入口）。Master、Volume、Filer gRPC、WebDAV、Iceberg、Lance 和 Admin 端口不映射、不进入应用配置。

<a id="oss-acceptance"></a>

## 9. 软件验收

| ID | Given | When | Then |
| --- | --- | --- | --- |
| OSS-AC-01 | 配置了路径风格的 S3 mock | 服务端写入并读回对象 | 字节与 SHA-256 一致；客户端使用 `@aws-sdk/client-s3` |
| OSS-AC-02 | 同一 mock 以虚拟主机风格重放 | `S3_FORCE_PATH_STYLE=false` 且端点改为 HTTPS 主机 | Put、Get 仍成功，请求主机包含桶名 |
| OSS-AC-03 | 浏览器端点与服务端端点不同 | 为 `ready` 对象预签名 | URL 的协议、主机和端口等于 `S3_ENDPOINT_BROWSER`，有效期不超过 900 秒 |
| OSS-AC-04 | 对象含内部附件和一条公开图片 | 组装正式交付包 | 包内只有公开图片和公开正文，内部对象键不出现 |
| OSS-AC-05 | 已有 `ready` 的报告或交付包对象 | 再次生成 | 新对象键不同；旧对象字节和指纹不变 |
| OSS-AC-06 | 导出记录属于另一用户，或本用户已重新生成 | 用旧对象标识请求下载 | 拒绝且响应不含文件字节 |
| OSS-AC-07 | 品牌已冻结或素材已撤销 | 请求新预签名 | 拒绝；历史元数据仍可按授权查询 |
| OSS-AC-08 | 清除到期 | 执行对象删除 | 存储端对象消失；墓碑行无文件名和正文 |
| OSS-AC-09 | 密钥错误或端点拒绝 | 保存文件 | 用户结果为失败，行不是 `ready`，响应和日志没有密钥 |
| OSS-AC-10 | 历史交付包仍把正文放在 `files_json` | 下载该历史包 | 仍返回原字节，不要求桶里已有同名对象 |

`OSS-AC-*` 是本模块的软件验收，不替代 `AC-M0-*` 或 `AC-M1-*`。实现时两类都要测。双库迁移、全量 DDL 和批量查询按 [数据访问与缓存工程约束](../architecture/data-access.md) 执行。
