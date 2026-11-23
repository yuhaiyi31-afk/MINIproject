# 新版微信小程序预览

新版微信、Android 和 iOS 共用 SECONDHAND_APP 中的页面、图标和交互。原小程序的线上代码仍位于本仓库根目录。

1. 将两个仓库放在同一目录，切换到包含统一界面的版本。也可用环境变量 `SECONDHAND_APP_DIR` 指向 App 仓库。
2. 在本仓库执行 `node tools/unified-ui/prepare.cjs`，打开命令打印的临时目录。
3. 在 HBuilderX 选择「运行到小程序模拟器 → 微信开发者工具」。手动导入时请选择生成的 `mp-weixin` 目录，开发者工具会读取其中的 `project.config.json`。

示例预览可试用八个首页入口、集市搜索、商品和服务详情、收藏及聊天。页面上的「交互预览」标识代表本地示例数据。账号、真实商品和历史聊天的联调使用原有独立流程。此工具不参与原微信小程序的打包。

需要构建使用实际服务的新版客户端时，运行 `node tools/unified-ui/prepare.cjs --source`。在 HBuilderX 打开输出的共享项目路径，按 App 的环境联调说明配置，再选择对应平台。工具不会替你设置 CloudBase 凭证或微信 AppID。

[共用页面源码](https://github.com/yuhaiyi31-afk/SECONDHAND_APP/tree/codex/shared-market-catalog-20261122/client/pages) · [App 预览说明](https://github.com/yuhaiyi31-afk/SECONDHAND_APP/blob/codex/shared-market-catalog-20261122/docs/SHARED_CATALOG_PREVIEW.md)
