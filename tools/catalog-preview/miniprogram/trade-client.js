'use strict';

const { testEnvironment } = require('./catalog-client');
const ACTIONS = new Set([
  'identity.status', 'identity.start', 'identity.confirm', 'items.markSold',
  'items.options', 'items.mine', 'items.getOwned', 'items.publish', 'items.edit', 'items.transition', 'media.upload',
  'favorites.get', 'favorites.set', 'favorites.list', 'chat.list', 'chat.ensure', 'chat.get', 'chat.send', 'chat.markRead',
  'notifications.list', 'notifications.markRead'
]);

function createWechatTrade(cloud, value) {
  const env = testEnvironment(value);
  if (typeof cloud?.init !== 'function' || typeof cloud.callFunction !== 'function') {
    throw new Error('当前微信小程序没有可用的云开发能力');
  }
  cloud.init({ env, traceUser: false });
  return async (action, payload = {}) => {
    if (!ACTIONS.has(action)) throw new Error('该操作未开放交易联调');
    const { result } = await cloud.callFunction({
      name: 'market-trade-preview', config: { env }, data: { ...payload, action }
    });
    if (result?.ok !== true || result.data == null) {
      const error = new Error(result?.error?.message || '交易联调暂不可用');
      error.code = result?.error?.code;
      throw error;
    }
    return result.data;
  };
}

module.exports = { createWechatTrade };
