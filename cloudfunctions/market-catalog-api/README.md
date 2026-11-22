# 集市商品目录预览

此事件云函数只读查询 `market_items`，沿用现有 `_id`。小程序已有的四个函数和页面入口不变。这个函数只用于独立测试环境的两端目录联调，部署前须验证调用权限和索引。

| `action` | 参数 | 成功回包 `data` |
| --- | --- | --- |
| `items.browse` | 可选 `keyword`、`category`、`region`、`minPrice`、`maxPrice`、`days`、`sort`、`cursor`、`limit` | `items` 与 `page`。只列 `active` 商品。最大每页 30 条。 |
| `items.get` | `itemId`，即原商品 `_id` | 在售商品详情；已售时只返回 ID、币种和 `SOLD` 状态。 |

微信端用 [独立联调入口](../../tools/catalog-preview/README.md) 在测试环境通过 `wx.cloud.callFunction` 调用 `market-catalog-api`。原生 App 使用环境自己的 CloudBase HTTPS 云函数入口。排序从 `LATEST`、`PRICE_ASC`、`PRICE_DESC` 选择。App 的“附近”沿用指定的大概区域并按最新排序，无需定位。每次刷新使用新游标；短时间翻页保持同一排序和筛选。价格变化后使用刷新重新取排序一致的列表。

响应由显式字段选择生成，不查询账号、收藏或聊天集合。精确位置、联系方式、内部身份、视频和卖家资料不属于目录响应。自由文本的联系方式检查和媒体路径检查是预览保护，公开网页和搜索索引在将来仍需独立审核、同意和图片处理。未设置媒体桶时不返回图片；有媒体桶时只签发该测试环境 `market/images` 和 `market/thumbnails` 的短期链接。

启用前，在专用测试环境准备经过授权或脱敏的数据与调用权限。使用支持的 Node.js 20 或更新事件函数运行时，设置 `MARKET_CATALOG_PREVIEW_ENV` 为实际运行环境 ID，可选填 `MARKET_CATALOG_PREVIEW_BUCKET` 为同环境存储桶名。预览要求运行环境与配置一致，生产环境被显式排除。检查 `(publishType, status, createdAtMs, _id)` 和按价格排序、区域与分类筛选所需的组合索引。对测试 Publishable Key 只授予这个只读函数的调用权限。仓库中不存放密钥。

运行 `node --test cloudfunctions/market-catalog-api/test/*.test.js` 检查投影、翻页、售出状态、媒体路径和权限边界。联调后可关闭预览开关及测试调用权限来撤回，原商品、用户和会话无需移动或回滚。
