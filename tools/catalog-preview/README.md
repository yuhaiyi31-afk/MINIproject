# 三端商品联调

这个独立的微信测试项目通过 `market-catalog-api` 读取商品列表和详情，另有交易联调入口。用微信开发者工具导入本目录，选择已关联隔离环境、可供开发和真机预览的 AppID，再填入测试环境 ID。仓库的 `touristappid` 是导入占位值。原小程序工程排除了这份测试项目。

先在隔离环境启用文档接口能力，部署 `market-catalog-api`，并按函数 README 配置索引和最小调用权限。新环境使用 PostgreSQL 的 Document 插件提供文档接口。测试目录只需要经过授权的测试商品，勿复制生产用户或聊天数据。

1. 用微信测试账号发布一件带至少两张不同照片的商品。在微信、Android 和 iOS 打开同一个商品 ID，核对标题、描述、价格及图片顺序。滑动查看全部图片后，分别点「复制验收结果」。
2. 将三份记录保存为 `wechat-active.json`、`android-active.json`、`ios-active.json`。用卖家账号把商品标记为已售。在三端刷新列表，再用原 ID 打开详情，把三份新记录保存为对应的 `*-sold.json`。
3. 运行 `node check-evidence.cjs --sale-cycle wechat-active.json android-active.json ios-active.json wechat-sold.json android-sold.json ios-sold.json`。工具核对同一环境、同一商品、价格和状态，比较在售内容摘要和照片数量，并检查已售详情已收起照片和价格。

新版记录包含发布内容的摘要和本次成功加载的照片数。摘要取自服务端已经筛选的公开标题、描述和有序图片引用，不含临时链接。单次核对仍可用 `node check-evidence.cjs wechat.json android.json ios.json`。旧版记录只核对环境、ID、币种、价格和状态，完整售出验收需要六份新版记录。

运行 `node --test test/*.test.cjs` 可以在开发机检查 SDK 调用参数、环境限制和结果比较。它使用测试夹具，和真机联调是两种不同的验收记录。

## 交易联调入口

在同一个隔离测试环境配置交易函数后，从商品目录联调页面进入「交易联调」。绑定或解绑从微信端发起，再由 App 换取确认码并在微信确认。进入「发布和管理我的商品」可用测试照片发布、换图、编辑和改变状态。在列表复制同一商品 ID，回商品目录核对结果。测试步骤见 [跨端交易联调](../../cloudfunctions/market-trade-preview/README.md)。
