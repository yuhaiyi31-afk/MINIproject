'use strict';

const { createTradeHandler } = require('./trade');
const { previewConfig, principalFrom, storeFor } = require('./runtime');

const config = previewConfig(process.env);
let handler;

exports.main = async event => {
  if (!config) return { ok: false, error: { code: 'TRADE_DISABLED', message: '交易联调未开放' } };
  if (!handler) {
    const sdk = require('@cloudbase/node-sdk');
    const app = sdk.init({ env: config.environmentId, timeout: 4000 });
    handler = createTradeHandler({
      ...config,
      store: storeFor(app.database()),
      authenticate: () => principalFrom(app.auth(), config.wechatAppId),
      uploadFile: (cloudPath, fileContent) => app.uploadFile({ cloudPath, fileContent }),
      signFiles: fileList => app.getTempFileURL({ fileList })
    });
  }
  return handler(event);
};
