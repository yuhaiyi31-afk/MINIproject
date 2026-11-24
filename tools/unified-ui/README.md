# 一套前端源码 · 微信小程序 / Android / iOS

**目标：不再分别维护两套相似页面。** 以后 `SECONDHAND_APP/client` 是首页、集市、服务大厅、商品详情、发布、消息、聊天和我的页的**唯一 UI 源码**。这份源码由 uni-app x 编译成微信小程序、Android 与 iOS。原生 `MINIproject` 根目录暂时保留作为已有小程序的回退方案，不会被自动替换或发布。

> 目前是开发阶段，**没有**证明正式小程序已切换、真实微信登录已接通或真机 UI 达到像素级一致。不同平台的状态栏、系统授权、字体与键盘仍允许必要差异。只以 HBuilderX + 微信开发者工具 + 两台手机的真实结果为准。

## 准备

把 `SECONDHAND_APP` 与 `MINIproject` 克隆到同一个文件夹的**两个并列目录**，并切换到对应的 PR 开发分支。如果目录位置不同，指定 `SECONDHAND_APP_DIR` 为 App 仓库根目录。不要在两个仓库里直接写测试用的密钥。

需要 Node.js 22；微信小程序编译需要 **HBuilderX 支持 uni-app x 的版本**，之后由微信开发者工具预览。Android/iOS 仍需要原生编译与签名。

## 三条明确分开的命令

在 `MINIproject` 根目录：

```bash
# A. 生成“同一套 UI”的离线演示工程（示例商品，不是真实服务）
node tools/unified-ui/prepare.cjs --preview

# B. 生成不含真实配置的共享前端工程（页面/组件/样式/图标直接复制 App 源码）
node tools/unified-ui/prepare.cjs --stage

# C. 验证生成项目仍与 SECONDHAND_APP/client 对应版本逐文件一致
node tools/unified-ui/prepare.cjs --verify /上一步显示的完整生成路径
```

也可以使用 `--source` 输出共享源项目的 `client` 路径，直接通过 HBuilderX 打开。不要对旧小程序仓库根目录运行编译命令来判定“统一 UI 是否有效”，那样打开的依然是原生旧页面。

`--stage` 可加一个**不存在**且位于两个仓库之外的目标目录，例如 `node tools/unified-ui/prepare.cjs --stage /tmp/campus-client-test`。工具从相同页面、组件、`App.uvue`、`uni.scss`、`styles/`、`static/ui/` 创建隔离副本，写入 `shared-ui-source.json` 文件哈希校验记录，生成后立即自动验证；任何源文件不同步都报错。

### 在 HBuilderX 内实际预览

1. 打开 `--stage` 或 `--preview` 输出的 **client 工程目录**。
2. 运行 → 运行到小程序模拟器 → 微信开发者工具；随后用开发者工具打开**编译生成的 mp-weixin 目录**，不是原生 MINIproject 根目录。
3. Android / iOS 也使用完全相同的 `SECONDHAND_APP/client` 页面与 UI 组件源码构建。
4. 用相同测试商品数据截取首页、集市、发布、详情、聊天和我的页的三端截图并逐项比对。

`--stage` 不会修改 App 源码、旧微信小程序根目录、GitHub main、腾讯云函数或数据库。默认 CloudBase env/API URL/客户端公开凭据是**未配置**状态、微信 AppID 是 `touristappid`、DCloud appid 为空、`uiPreview=false`；这是为了不能误把演示包当成生产发布包。**不要在尚未验证身份认证之前设置真实生产环境和发布。**

## 真实账号及云端阻断

- 共享页面在微信小程序上不能直接冒充原生 App 的邮箱 token 登录；当前 MP-WEIXIN 登录入口会明确说明未完成身份桥接。
- 后端负责人需提供真实微信身份来源、App UID 与 OPENID 的服务端验证绑定、API 契约；前端完成平台适配后，测试两账号的发布/收藏/聊天/退出登录。
- 真实交易接口和账号绑定尚未完成真机验证前，原生 MINIproject 仍是回退，不要删除旧代码，不要覆盖小程序正式版本，不要把 `market-catalog-api` 的联调模式当作生产接口。

## 通过条件

- **源码一致**：`--verify` 通过；相同页面、图标、样式不再复制手工维护。
- **编译一致**：小程序 / Android / iOS 分别完成正式开发工具编译，不依赖模拟成功提示。
- **视觉一致**：三端核心页面截图和主要行为逐项对照，保留必须的平台原生差异。
- **业务一致**：真实身份和云端数据跨端一致，发布、编辑、下架、聊天、收藏、举报权限通过。

此 README 不授予上线许可；发布前仍要单独验证合规、生产权限、备份、回滚和商店审核。
