'use strict';

const { collections, createTradeHandler } = require('../trade');
const { storeFor } = require('../runtime');

const ENV = 'shared-market-fixture';
const MEDIA_ROOT = `${ENV}.fixture-bucket`;
const WX_APP = 'wx0123456789abcdef';
const SELLER = 'wx-fixture-seller';
const BUYER = 'wx-fixture-buyer';
const OTHER = 'wx-fixture-other';
const APP = 'uid-fixture-seller';
const ITEM = 'fixture-monitor';
const CHAT = 'fixture-conversation';

function fixture({ failAdd, onUpload } = {}) {
  const seedTime = 1795320000000;
  const profile = _id => ({
    _id, nickName: 'Fixture account', internalTestAccess: true, status: 'active',
    policiesAcceptedAtMs: seedTime, termsAcceptedVersion: 'fixture-v1',
    blockedUserIds: [], favoriteItemIds: [], privatePhone: 'synthetic-private-value'
  });
  let rows = new Map([
    [collections.profiles, new Map([[SELLER, profile(SELLER)], [BUYER, profile(BUYER)], [OTHER, profile(OTHER)]])],
    [collections.links, new Map()],
    [collections.invites, new Map()],
    [collections.media, new Map()],
    [collections.limits, new Map()],
    [collections.items, new Map([
      [ITEM, {
        _id: ITEM, ownerOpenId: SELLER, publishType: 'market', status: 'active', title: 'Fixture monitor',
        price: 500, region: 'Auckland CBD', category: '电子产品', description: 'Fixture listing',
        createdAtMs: seedTime, contact: 'synthetic-private-value'
      }],
      ['fixture-second-item', {
        _id: 'fixture-second-item', ownerOpenId: SELLER, publishType: 'market', status: 'active',
        title: 'Fixture keyboard', price: 30, category: '电子产品', region: 'Auckland CBD', createdAtMs: seedTime
      }],
      ['fixture-service', { _id: 'fixture-service', ownerOpenId: SELLER, publishType: 'service', status: 'active' }],
      ['fixture-deleted', { _id: 'fixture-deleted', ownerOpenId: SELLER, publishType: 'market', status: 'deleted' }]
    ])],
    [collections.conversations, new Map([[CHAT, {
      _id: CHAT, itemId: ITEM, itemTitle: 'Fixture monitor', buyerOpenId: BUYER, sellerOpenId: SELLER,
      updatedAtMs: seedTime, unreadForSeller: 1, unreadForBuyer: 0,
      messages: [{ id: 'legacy-msg-1', senderOpenId: BUYER, senderRole: 'buyer', text: 'Is it available?', createdAt: seedTime }]
    }]])],
    [collections.notifications, new Map([['fixture-notice', {
      _id: 'fixture-notice', recipientOpenId: SELLER, actorOpenId: BUYER, itemId: ITEM,
      itemTitle: 'Fixture monitor', type: 'favorite', read: false,
      createdAtMs: seedTime, text: 'Fixture buyer saved your listing', privatePhone: 'synthetic-private-value'
    }]])]
  ]);
  let ready = Promise.resolve();
  let clock = seedTime;
  const copy = value => structuredClone(value);
  const objects = new Map();
  const uploadFile = async (path, bytes) => {
    await onUpload?.(path, bytes);
    const fileID = `cloud://${MEDIA_ROOT}/${path}`;
    objects.set(fileID, Buffer.from(bytes));
    return { fileID };
  };

  function collection(view, name) {
    const docs = view.get(name);
    return {
      doc(id) {
        return {
          async get() { return { data: docs.has(id) ? copy(docs.get(id)) : null }; },
          async set(value) { docs.set(id, { ...copy(value), _id: id }); return {}; },
          async update(values) {
            const doc = docs.get(id);
            if (!doc) throw new Error('missing fixture document');
            for (const [field, value] of Object.entries(values)) {
              if (value?.operation === 'push') doc[field] = [...(doc[field] || []), ...value.value];
              else if (value?.operation === 'inc') doc[field] = (doc[field] || 0) + value.value;
              else doc[field] = copy(value);
            }
            return { updated: 1 };
          },
          async remove() { return { deleted: Number(docs.delete(id)) }; }
        };
      },
      async add(data) {
        if (failAdd?.(data) || docs.has(data._id)) return { code: 'DATABASE_REQUEST_FAILED', message: 'insert failed' };
        docs.set(data._id, copy(data));
        return { id: data._id };
      },
      where(filters) {
        const order = [];
        let offset = 0;
        let count = 100;
        const query = {
          orderBy(field, direction) { order.push([field, direction === 'desc' ? -1 : 1]); return query; },
          skip(value) { offset = value; return query; },
          limit(value) { count = value; return query; },
          async get() {
            const matched = [...docs.values()].filter(row => Object.entries(filters)
              .every(([key, value]) => value?.operation === 'in' ? value.value.includes(row[key]) : row[key] === value));
            matched.sort((left, right) => {
              for (const [key, sign] of order) {
                if (left[key] < right[key]) return -sign;
                if (left[key] > right[key]) return sign;
              }
              return 0;
            });
            return { data: copy(matched.slice(offset, offset + count)) };
          }
        };
        return query;
      }
    };
  }

  const store = storeFor({
    command: {
      push: value => ({ operation: 'push', value }), inc: value => ({ operation: 'inc', value }),
      in: value => ({ operation: 'in', value })
    },
    collection: name => collection(rows, name),
    runTransaction(callback) {
      const operation = ready.then(async () => {
        const pending = copy(rows);
        const result = await callback({ collection: name => collection(pending, name) });
        rows = pending;
        return result;
      });
      ready = operation.catch(() => {});
      return operation;
    }
  });
  const handler = (provider, id, options = {}) => createTradeHandler({
    environmentId: ENV, wechatAppId: WX_APP, allowTestProfiles: true, store,
    mediaRoot: MEDIA_ROOT, uploadFile, now: () => clock, authenticate: () => provider ? { provider, id } : null, ...options
  });
  return {
    handler, store, objects, rows: name => [...rows.get(name).values()].map(copy),
    advance: milliseconds => { clock += milliseconds; },
    catalogStore: {
      list: async () => [...rows.get(collections.items).values()].filter(item => item.status === 'active' && item.publishType === 'market').map(copy),
      get: async id => copy(rows.get(collections.items).get(id) || null)
    }
  };
}

module.exports = { fixture, ENV, MEDIA_ROOT, WX_APP, SELLER, BUYER, OTHER, APP, ITEM, CHAT };
