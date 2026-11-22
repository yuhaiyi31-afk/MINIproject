# 跨端交易联调

微信小程序与 Android、iOS 的联调页面调用同一个交易函数。商品目录仍由 `market-catalog-api` 提供。交易函数使用现有数据结构，直接读取 `market_items`、`user_profiles`、`market_conversations` 和 `market_notifications`。共享业务状态分别保存在商品、收藏列表、会话和通知的原始记录里。

## 账号与 API

微信端从 CloudBase 调用上下文读取 OPENID 和小程序 AppID。App 端从同一测试环境的调用上下文读取 CloudBase Auth UID，并由服务端查询有登录邮箱的用户。测试认证仅开放邮箱验证码。微信账号须通过现有身份与协议检查。联调工具可选择使用带内测资格、已接受协议的合成档案。

| 接口 | 用途 |
| --- | --- |
| `identity.start`、`identity.claim`、`identity.confirm` | 微信生成限时配对码。App 登录后换取确认码。原微信会话提交确认码，完成绑定或解绑。 |
| `identity.status` | 查询当前账号的绑定状态和统一用户 ID。 |
| `items.markSold` | 卖家将同一个 `market_items` 记录从在售变成已售。该操作可重试。 |
| `favorites.get`、`favorites.set` | 读取或设置当前账号对商品的收藏。 |
| `chat.list`、`chat.ensure`、`chat.get` | 查询自己的会话，按商品打开买卖会话，或读取其中最近 200 条消息。 |
| `chat.send`、`chat.markRead` | 发送或标记会话已读。发送重试沿用同一个 `requestId`。 |
| `notifications.list`、`notifications.markRead` | 读取和标记现有收件人通知。 |

两个配对步骤生成独立随机码，有效期五分钟。服务端仅保存码的摘要。若 App 已经领取确认码但网络中断丢失了响应，请在微信端生成新的配对码。绑定索引的双向记录在同一事务内增删。平台用户 ID 基于环境、小程序 AppID 和原有微信身份生成，同一微信身份在该环境内解绑再绑定仍得到相同 ID。旧商品归属、收藏和聊天继续通过原微信身份识别。

商品目录响应由公开字段白名单生成。交易函数检查商品所有权、会话参与身份及通知收件人，响应省去联系方式和底层身份字段。平台用户 ID 只出现在已登录账号的绑定结果中。未认证请求、第三人读取聊天、跨账号写入和重复发送均由本地测试覆盖。

## 本地验证

使用 Node.js 20 或更新版本，在本目录运行 `npm ci --ignore-scripts` 和 `npm test`。联合跑两个仓库时，在 `SECONDHAND_APP` 运行 `node scripts/verify-catalog-local.cjs <MINIproject 目录>`，需要 Node.js 22.13 或更新版本。联合测试执行两个客户端的请求适配器和后端处理器，使用合成数据和模拟传输。

## 云端验收

1. 选用已获授权的独立环境和测试用微信小程序。将项目 `tools/catalog-preview` 的 AppID 替换成它的测试 AppID。在该环境开启邮箱验证码登录，配置客户端可公开使用的 Publishable Key。
2. 使用测试数据准备 `market_items`、`user_profiles`、`market_conversations`、`market_notifications`、`market_identity_links`、`market_identity_invites`。这六个集合应仅允许服务端访问。用真实测试账号的身份和合成业务记录进行验收。会话列表依赖买家或卖家字段与 `updatedAtMs` 的排序查询，历史会话查找按 `itemId`、`buyerOpenId`、`sellerOpenId` 查询，通知按 `recipientOpenId` 和 `createdAtMs` 查询。结合测试环境实际查询结果建立需要的索引。
3. 在该环境部署 `market-catalog-api` 和 `market-trade-preview` 的事件函数。配置 `MARKET_TRADE_PREVIEW_ENV` 和 `MARKET_TRADE_WECHAT_APP_ID`。仅在使用虚构内测档案时设置 `MARKET_TRADE_TEST_PROFILES=true`。交易函数入口要求配置与实际云函数环境一致，并硬性拒绝已知正式环境。交易函数的调用权限仅开放给经过认证的测试客户端。
4. 在小程序生成配对码，由 App 邮箱登录后领取确认码，再回小程序确认。使用 App 收藏，回小程序读取收藏状态。用无关账号尝试标记已售，确认被拒绝，再由卖家操作，刷新三个客户端并核对原商品 ID 和已售状态。
5. 测试会话两方读取同一段历史并各发一条消息，以原请求编号重试，核对仅生成一条记录。核对无关账号的会话、通知响应和解绑后的访问被拒绝。测试账号使用完毕后其授权可从测试配置撤销。

联调范围为商品目录、绑定和解绑、标记已售、收藏、聊天和现有通知。照片上传及商品发布、编辑、删除、举报、拉黑、平台管理、通知推送和账号恢复尚待接入共用模式。正式切换需要单独验证。
