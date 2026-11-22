# 三端商品联调

这个独立的微信测试项目只调用 `market-catalog-api` 的列表和详情。用微信开发者工具导入本目录，选择已关联隔离环境、可供开发和真机预览的 AppID，再填入测试环境 ID。仓库的 `touristappid` 只是导入占位值。原小程序工程排除了这份测试项目。

先在隔离环境启用文档接口能力，部署 `market-catalog-api`，并按函数 README 配置索引和最小调用权限。新环境使用 PostgreSQL 的 Document 插件提供文档接口。测试目录只需要经过授权的测试商品，勿复制生产用户或聊天数据。

1. 微信预览读取在售商品，打开同一件商品详情，选择「复制验收结果」。
2. 分别在 Android 和 iOS 的 App 预览中打开同一个商品 ID，复制验收结果。三份记录只包含测试环境、平台、商品 ID、状态、币种和价格分值。
3. 保存为 `wechat.json`、`android.json`、`ios.json`（一份 JSON 对应一个设备结果），运行 `node check-evidence.cjs wechat.json android.json ios.json`。只有平台齐全且各字段完全一致时才通过。若验收已售状态，用同一商品的三份新记录分别再跑一次；已售详情的价格必须为空。

运行 `node --test test/*.test.cjs` 可以在开发机检查 SDK 调用参数、环境限制和结果比较。它使用测试夹具，和真机联调是两种不同的验收记录。
