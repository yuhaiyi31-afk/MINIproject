'use strict';

const { collections } = require('./shared');

const LIVE_ENVIRONMENT = 'cloud1-d9glh048lb56b8a00';
const MISSING = new Set(['DOCUMENT_NOT_FOUND', 'DATABASE_DOCUMENT_NOT_FOUND', '-502001']);
const ID = /^[A-Za-z0-9_-]{1,128}$/;

function previewConfig(env) {
  const environmentId = env.MARKET_TRADE_PREVIEW_ENV;
  const configuredApp = env.MARKET_TRADE_WECHAT_APP_ID;
  const runtimeIds = [env.TCB_ENV, env.SCF_NAMESPACE].filter(Boolean);
  if (!/^[a-z0-9-]{1,64}$/.test(environmentId || '') || environmentId === LIVE_ENVIRONMENT
    || !/^wx[a-f0-9]{16}$/.test(configuredApp || '')
    || !runtimeIds.length || !runtimeIds.every(value => value === environmentId)) return null;
  const bucket = env.MARKET_CATALOG_PREVIEW_BUCKET;
  const mediaRoot = /^[a-z0-9-]{1,128}$/.test(bucket || '') ? `${environmentId}.${bucket}` : '';
  return { environmentId, wechatAppId: configuredApp, allowTestProfiles: env.MARKET_TRADE_TEST_PROFILES === 'true', mediaRoot };
}

async function principalFrom(auth, wechatAppId) {
  const user = auth.getUserInfo();
  if (!user || user.isAnonymous || user.customUserId) return null;
  if (user.openId || user.appId) {
    return user.appId === wechatAppId && ID.test(user.openId || '') ? { provider: 'wx', id: user.openId } : null;
  }
  if (typeof user.uid !== 'string' || !ID.test(user.uid)) return null;
  // The argument comes solely from the runtime identity injected by CloudBase.
  const { userInfo } = await auth.getEndUserInfo(user.uid);
  return userInfo?.uid === user.uid && !userInfo.isAnonymous && !userInfo.openId && !userInfo.customUserId
      && !['blocked', 'banned', 'deleted', 'pending'].includes(String(userInfo.status || '').toLowerCase())
      && typeof userInfo.email === 'string' && /^[^\s@]+@[^\s@]+$/.test(userInfo.email)
    ? { provider: 'app', id: user.uid }
    : null;
}

function isMissing(error) {
  // Some CloudBase runtimes return an empty data array for a missing document.
  return [error?.code, error?.errCode].some(value => MISSING.has(String(value)))
    && /document.*(?:not exist|not found)|DOCUMENT_NOT_FOUND/i.test(error?.message || error?.errMsg || error?.code || '');
}

function ensureResponse(response) {
  if (response?.code) throw Object.assign(new Error(response.message), { code: response.code });
  return response;
}

function storeFor(db) {
  async function get(transaction, collection, id) {
    try {
      const { data } = ensureResponse(await transaction.collection(collection).doc(id).get());
      return Array.isArray(data) ? data[0] || null : data || null;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async function query(collection, filters, orderField, limit) {
    const response = db.collection(collection).where(filters);
    const result = orderField ? response.orderBy(orderField, 'desc') : response;
    const { data } = ensureResponse(await result.limit(limit).get());
    if (!Array.isArray(data)) throw new TypeError('Invalid query response');
    return data;
  }

  return {
    transaction: callback => db.runTransaction(transaction => {
      const doc = (collection, id) => transaction.collection(collection).doc(id);
      const update = async (collection, id, value) => {
        const response = ensureResponse(await doc(collection, id).update(value));
        if (response.updated !== 1) throw new Error('Expected one updated document');
      };
      return callback({
        get: (collection, id) => get(transaction, collection, id),
        add: async (collection, id, value) => {
          const response = ensureResponse(await transaction.collection(collection).add({ ...value, _id: id }));
          if (response.id !== id) throw new Error('Unexpected inserted document');
        },
        set: async (collection, id, value) => ensureResponse(await doc(collection, id).set(value)),
        update,
        remove: async (collection, id) => {
          const response = ensureResponse(await doc(collection, id).remove());
          if (response.deleted !== 1) throw new Error('Expected one removed document');
        },
        appendMessage: (conversationId, message, unreadField) => update(collections.conversations, conversationId, {
          messages: db.command.push([message]),
          [unreadField]: db.command.inc(1),
          lastMessage: message.text,
          updatedAtMs: message.createdAt
        })
      });
    }),
    async conversationsFor(openId) {
      const queries = ['buyerOpenId', 'sellerOpenId'].map(field => query(collections.conversations, { [field]: openId }, 'updatedAtMs', 25));
      return (await Promise.all(queries)).flat();
    },
    async findConversationId(itemId, buyerOpenId, sellerOpenId) {
      const rows = await query(collections.conversations, { itemId, buyerOpenId, sellerOpenId }, '', 2);
      if (rows.length > 1) throw new Error('Duplicate existing conversations');
      return rows[0]?._id;
    },
    notificationsFor: openId => query(collections.notifications, { recipientOpenId: openId }, 'createdAtMs', 25),
    activeItemsById: ids => query(collections.items, { _id: db.command.in(ids), publishType: 'market', status: 'active' }, '', 20),
    async itemsFor(openId, status, offset) {
      const where = { ownerOpenId: openId, publishType: 'market' };
      if (status) where.status = status;
      const { data } = ensureResponse(await db.collection(collections.items)
        .where(where).orderBy('createdAtMs', 'desc').orderBy('_id', 'desc').skip(offset).limit(21).get());
      if (!Array.isArray(data)) throw new TypeError('Invalid item query response');
      return data;
    }
  };
}

module.exports = { previewConfig, principalFrom, storeFor };
