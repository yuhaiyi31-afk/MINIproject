# 跨端交易联调

微信小程序与 Android、iOS 的联调页面调用同一个交易函数。商品目录仍由 `market-catalog-api` 提供。交易函数使用现有数据结构，直接读取 `market_items`、`user_profiles`、`market_conversations` 和 `market_notifications`。共享业务状态分别保存在商品、收藏列表、会话和通知的原始记录里。

## 账号与 API

微信端从 CloudBase 调用上下文读取 OPENID 和小程序 AppID。App 端从同一测试环境的调用上下文读取 CloudBase Auth UID，并由服务端查询有登录邮箱的用户。测试认证仅开放邮箱验证码。微信账号须通过现有身份与协议检查。联调工具可选择使用带内测资格、已接受协议的合成档案。

| 接口 | 用途 |
| --- | --- |
| `identity.start`、`identity.claim`、`identity.confirm` | 微信生成限时配对码。App 登录后换取确认码。原微信会话提交确认码，完成绑定或解绑。 |
| `identity.status` | 查询当前账号的绑定状态和统一用户 ID。 |
| `items.options`、`items.mine`、`items.getOwned` | 读取共用发布选项、我的商品和卖家编辑所需的商品版本。 |
| `media.upload` | 发送一张压缩后的图片。输入包含 `requestId` 和 `imageBase64`，返回当前卖家的 `assetId`。 |
| `items.publish`、`items.edit` | 发布或编辑 `market_items`。接受 `title`、`description`、`price`、`category`、`condition`、`region`、`deliveryMethod`。发布还需 `requestId`、`promiseReal` 和 `photoAssetIds`。编辑提交 `itemId`、`revision` 和 `requestId`，省略 `photoAssetIds` 时保留原图。 |
| `items.transition`、`items.markSold` | 卖家下架、重新上架、售出或软删除同一条记录。状态变更使用 `itemId` 和商品版本，售出快捷操作可用 `items.markSold`。 |
| `favorites.get`、`favorites.set`、`favorites.list` | 读取或设置收藏，按页查询当前用户收藏的在售商品。 |
| `chat.list`、`chat.ensure`、`chat.get` | 查询自己的会话，按商品打开买卖会话，或读取其中最近 200 条消息。 |
| `chat.send`、`chat.markRead` | 发送或标记会话已读。发送重试沿用同一个 `requestId`。 |
| `notifications.list`、`notifications.markRead` | 读取和标记现有收件人通知。 |

两个配对步骤生成独立随机码，有效期五分钟。服务端仅保存码的摘要。若 App 已经领取确认码但网络中断丢失了响应，请在微信端生成新的配对码。绑定索引的双向记录在同一事务内增删。平台用户 ID 基于环境、小程序 AppID 和原有微信身份生成，同一微信身份在该环境内解绑再绑定仍得到相同 ID。旧商品归属、收藏和聊天继续通过原微信身份识别。

商品目录响应由公开字段白名单生成。交易函数检查商品所有权、会话参与身份及通知收件人，响应省去联系方式和底层身份字段。平台用户 ID 只出现在已登录账号的绑定结果中。未认证请求、第三人读取聊天、跨账号写入和重复发送均由本地测试覆盖。

## 商品、图片与状态

服务端把 JPEG、PNG 或 WebP 静态图片重新编码为 JPEG，移除 EXIF 等元数据。一次最多传一张 512 KB 压缩图，每件商品可挂 1 至 9 张。图片必须先由当前账号上传并取得有效凭据，再与同一个商品 ID 绑定，上传和发布重试沿用原请求编号。后台每个卖家每十分钟最多取得 24 个新图片凭据，未挂接的凭据有效期为 24 小时。

在售可以下架、售出或删除。下架可以重新上架、售出或删除。已售可以重新上架或删除。已删除和平台暂停的商品由卖家操作时会拒绝。公开目录仅列在售商品，已售详情保留原 ID 和已售状态。

删除会保存商品墓碑和已有聊天，撤下公开照片引用。图片文件保留在私有测试存储，已签发的图片链接按原期限失效，最多五分钟。未发布、替换后或删除后的图片实际清理策略需在正式切换前确认。正式数据保留原商品 ID 和微信归属，现有聊天和通知保留当时的商品快照。

## 本地验证

使用 Node.js 20.9 或更新版本，在本目录运行 `npm ci --ignore-scripts --include=optional` 和 `npm test`。联合跑两个仓库时，在 `SECONDHAND_APP` 运行 `node scripts/verify-catalog-local.cjs <MINIproject 目录>`，需要 Node.js 22.13 或更新版本。联合测试通过模拟传输执行客户端请求、图片解码编码和后端处理器，使用合成账号、商品和照片。独立函数随包保存现有小程序的内容策略，自动测试核对两份规则一致。

## 云端验收

1. 选用已获授权的独立环境和测试用微信小程序。将项目 `tools/catalog-preview` 的 AppID 替换成它的测试 AppID。在该环境开启邮箱验证码登录，配置客户端可公开使用的 Publishable Key。
2. 准备 `market_items`、`user_profiles`、`market_conversations`、`market_notifications`、`market_identity_links`、`market_identity_invites`、`market_trade_media`、`market_trade_limits`。数据库集合和图片桶均仅允许服务端直接访问。按现有会话的买家或卖家、`updatedAtMs`，通知的 `recipientOpenId`、`createdAtMs`，及我的商品的 `ownerOpenId`、`publishType`、可选 `status`、`createdAtMs`、`_id` 查询建立需要的索引。历史会话查找按 `itemId`、`buyerOpenId`、`sellerOpenId` 查询。
3. 在该环境部署两个事件函数。交易函数使用 Node.js 20.9 或更新版本，安装匹配云端体系结构的 Sharp 可选依赖。配置 `MARKET_TRADE_PREVIEW_ENV` 和 `MARKET_TRADE_WECHAT_APP_ID`。两个函数的 `MARKET_CATALOG_PREVIEW_BUCKET` 填同一个测试桶后缀，保持 `cloud://环境ID.桶后缀` 与上传返回值一致。仅合成内测档案使用 `MARKET_TRADE_TEST_PROFILES=true`。建议给图片处理配置 512 MB 和 30 秒，并在测试环境核对真实响应耗时。交易函数仅由经过认证的测试客户端调用。
4. 在小程序生成配对码，由 App 邮箱登录后换取确认码，再回小程序确认。分别用微信、Android 和 iOS 上传合成照片，各发布一件商品。核对三个客户端的 ID、价格和照片一致。用另一端编辑、换图、下架、重新上架、标为已售和删除。核对超时重试仅有一条商品记录、无关账号无法操作以及删除后原会话仍可访问。
5. 使用 App 收藏，回小程序查看同一份收藏。测试双方读写原会话，重试发送并核对只有一条新消息。核对无关账号的私信和通知，以及解绑后的 App 写入权限。

正式切换、举报、拉黑管理、账号恢复和通知推送有单独的验收与交付范围。
