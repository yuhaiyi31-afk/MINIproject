const FUNCTION_NAME = 'message-api';
const MESSAGE_CACHE_KEY = 'messageCloudCacheV1';

function ensureCloud() {
  if (!wx.cloud || !wx.cloud.callFunction) throw new Error('当前小程序尚未开通消息云服务');
}

async function call(action, data) {
  ensureCloud();
  const response = await wx.cloud.callFunction({
    name: FUNCTION_NAME,
    data: { action, ...(data || {}) }
  });
  const result = response && response.result;
  if (!result || result.ok !== true) throw new Error((result && result.message) || '消息云服务返回异常');
  return result;
}

function itemId(item) {
  return item && (item._id || item.id) ? String(item._id || item.id) : '';
}

async function ensureConversation(item) {
  const result = await call('ensureConversation', { itemId: itemId(item) });
  return result.conversation;
}

async function getConversation(conversationId) {
  const result = await call('getConversation', { conversationId });
  return result.conversation;
}

async function pollConversation(conversationId, sinceUpdatedAt) {
  const result = await call('pollConversation', {
    conversationId,
    sinceUpdatedAt: Number(sinceUpdatedAt) || 0
  });
  const update = {
    messages: Array.isArray(result.messages) ? result.messages : [],
    updatedAt: Number(result.updatedAt) || 0,
    currentUserRole: result.currentUserRole || ''
  };
  if (update.messages.length) clearMessageCaches();
  return update;
}

async function addMessage(conversationId, text, kind) {
  const result = await call('addMessage', { conversationId, text, kind: kind || 'text' });
  clearMessageCaches();
  return result.message;
}

async function createPurchaseIntent(item) {
  const result = await call('createPurchaseIntent', { itemId: itemId(item) });
  return result.conversation;
}

async function notifyFavorite(item) {
  const result = await call('notifyFavorite', { itemId: itemId(item) });
  return result.notification;
}

async function listMessages(options) {
  const input = options || {};
  const result = await call('list', {
    conversationSkip: Number(input.conversationSkip) || 0,
    notificationSkip: Number(input.notificationSkip) || 0,
    limit: Number(input.limit) || 20
  });
  const page = {
    conversations: Array.isArray(result.conversations) ? result.conversations : [],
    notifications: Array.isArray(result.notifications) ? result.notifications : [],
    conversationSkip: Number(result.conversationSkip) || 0,
    notificationSkip: Number(result.notificationSkip) || 0,
    hasMore: !!result.hasMore
  };
  if (!Number(input.conversationSkip) && !Number(input.notificationSkip)) {
    try { wx.setStorageSync(MESSAGE_CACHE_KEY, { savedAt: Date.now(), value: page }); } catch (error) { /* 忽略缓存写入失败 */ }
  }
  return page;
}

function getCachedMessages() {
  try {
    const cached = wx.getStorageSync(MESSAGE_CACHE_KEY);
    if (cached && cached.savedAt && Date.now() - cached.savedAt < 30 * 60 * 1000) return cached.value || null;
  } catch (error) { /* 无缓存 */ }
  return null;
}

function clearMessageCaches() {
  try {
    wx.removeStorageSync(MESSAGE_CACHE_KEY);
    wx.removeStorageSync('mineStatsCacheV1');
  } catch (error) { /* 忽略缓存清理失败 */ }
}

async function markConversationRead(conversationId) {
  const result = await call('markConversationRead', { conversationId });
  clearMessageCaches();
  return result;
}

async function markNotificationRead(notificationId) {
  const result = await call('markNotificationRead', { notificationId });
  clearMessageCaches();
  return result;
}

async function markAllRead() {
  const result = await call('markAllRead');
  clearMessageCaches();
  return result;
}

function getErrorMessage(error) {
  const message = String(error && (error.errMsg || error.message) || '');
  if (message.includes('FunctionName') || message.includes('function')) return '云函数 message-api 尚未部署';
  if (message.includes('collection') || message.includes('-502005')) return '消息数据库集合尚未创建';
  if (message.includes('商品不存在或已下架') || message.includes('发布不存在或已下架')) {
    return '该内容已下架，暂时无法联系发布者';
  }
  if (message.includes('不能与自己的商品')) return '这是你自己发布的内容';
  return message || '消息服务暂时不可用';
}

module.exports = {
  ensureConversation,
  getConversation,
  pollConversation,
  addMessage,
  createPurchaseIntent,
  notifyFavorite,
  listMessages,
  getCachedMessages,
  markConversationRead,
  markNotificationRead,
  markAllRead,
  getErrorMessage
};
