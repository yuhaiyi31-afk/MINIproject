# 集市商品目录预览

此事件云函数只读查询 `market_items`，沿用现有 `_id`。它供独立测试环境的小程序、Android 和 iOS 读取同一份商品与服务目录。

| `action` | 参数 | 成功回包 `data` |
| --- | --- | --- |
| `items.browse` | 可选 `keyword`、`category`、`region`、`minPrice`、`maxPrice`、`days`、`sort`、`cursor`、`limit` | `items` 与 `page`。只列 `active` 商品。最大每页 30 条。 |
| `items.get` | `itemId`，即原商品 `_id`。可选 `includeEvidence: true` | 返回在售商品详情。请求验收信息时另返回 `evidence.contentSha256` 和 `evidence.photoCount`。已售详情保留 ID、币种和 `SOLD` 状态，照片为空。 |
| `services.browse` | 可选服务分类 `category`、`cursor`、`limit` | 按分类返回在展示中的服务与分页游标。 |
| `services.get` | `itemId`，即原服务 `_id` | 服务详情与照片。服务结束时保留 ID 和状态。 |

微信端用 [独立联调入口](../../tools/catalog-preview/README.md) 在测试环境通过 `wx.cloud.callFunction` 调用 `market-catalog-api`。原生 App 使用环境自己的 CloudBase HTTPS 云函数入口。排序从 `LATEST`、`PRICE_ASC`、`PRICE_DESC` 选择。App 的“附近”沿用指定的大概区域并按最新排序，无需定位。每次刷新使用新游标；短时间翻页保持同一排序和筛选。价格变化后使用刷新重新取排序一致的列表。

响应由显式字段白名单生成。服务端仅从 `user_profiles` 查询候选发布者的封禁标记，封禁账号的在售内容不会进入共享目录。目录响应省去精确位置、联系方式、内部身份、视频和卖家资料。自由文本的联系方式检查和媒体路径检查用于目录，公开网页和搜索索引还需独立审核、同意和图片处理。只为本环境 `market/images` 和 `market/thumbnails` 目录下的有效图片签发短期链接。

启用前，在专用测试环境准备经过授权或脱敏的数据与调用权限。使用支持的 Node.js 20 或更新事件函数运行时，设置 `MARKET_CATALOG_PREVIEW_ENV` 为实际运行环境 ID，可选填 `MARKET_CATALOG_PREVIEW_BUCKET` 为同环境存储桶名。预览要求运行环境与配置一致，生产环境被显式排除。检查 `(publishType, status, createdAtMs, _id)` 和按价格排序、区域与分类筛选所需的组合索引。对测试 Publishable Key 只授予这个只读函数的调用权限。仓库中不存放密钥。

同一件在售商品的验收摘要覆盖公开标题、描述和有序图片引用，在签发临时 URL 前计算。`photoCount` 记录通过路径检查的源图片数量。设备需验证相应数量的照片全部加载完成才能生成新版记录。

运行 `node --test cloudfunctions/market-catalog-api/test/*.test.js` 检查投影、翻页、售出状态、媒体路径和权限边界。联调后可关闭预览开关及测试调用权限来撤回，原商品、用户和会话无需移动或回滚。
