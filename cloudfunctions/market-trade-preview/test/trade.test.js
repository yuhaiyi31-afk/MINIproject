'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { collections } = require('../trade');
const { previewConfig, principalFrom } = require('../runtime');
const { createCatalogHandler } = require('../../market-catalog-api/catalog');
const { fixture, ENV, WX_APP, SELLER, BUYER, OTHER, APP, ITEM, CHAT } = require('./fixture');

function call(handler, action, input = {}) {
  return handler({ ...input, action });
}

async function data(handler, action, input) {
  const response = await call(handler, action, input);
  assert.equal(response.ok, true, JSON.stringify(response));
  return response.data;
}

async function code(handler, action, input, expected) {
  assert.equal((await call(handler, action, input)).error?.code, expected);
}

async function pair(wx, app, mode = 'link') {
  const { invite } = await data(wx, 'identity.start', { mode });
  const { confirmation } = await data(app, 'identity.claim', { invite });
  return data(wx, 'identity.confirm', { confirmation, mode });
}

test('runtime requires a matching isolated environment and rejects live before SDK initialization', async () => {
  const config = { MARKET_TRADE_PREVIEW_ENV: ENV, MARKET_TRADE_WECHAT_APP_ID: WX_APP };
  assert.equal(previewConfig(config), null);
  assert.equal(previewConfig({ ...config, TCB_ENV: ENV, SCF_NAMESPACE: 'unrelated-env' }), null);
  const live = 'cloud1-d9glh048lb56b8a00';
  assert.equal(previewConfig({ ...config, MARKET_TRADE_PREVIEW_ENV: live, TCB_ENV: live }), null);
  assert.deepEqual(previewConfig({ ...config, TCB_ENV: ENV }), {
    environmentId: ENV, wechatAppId: WX_APP, allowTestProfiles: false, mediaRoot: ''
  });
  assert.equal(previewConfig({ ...config, TCB_ENV: ENV, MARKET_CATALOG_PREVIEW_BUCKET: 'fixture-bucket' }).mediaRoot,
    `${ENV}.fixture-bucket`);
  assert.equal((await require('../index').main({ action: 'identity.status' })).error.code, 'TRADE_DISABLED');
});

test('SDK authentication only reads the injected WeChat ID or the matching App account lookup', async () => {
  const auth = (user, userInfo) => ({
    getUserInfo: () => user,
    getEndUserInfo: async uid => {
      assert.equal(uid, APP);
      return { userInfo };
    }
  });
  assert.deepEqual(await principalFrom(auth({ openId: SELLER, appId: WX_APP }), WX_APP), { provider: 'wx', id: SELLER });
  assert.equal(await principalFrom(auth({ openId: SELLER, appId: 'wx1111111111111111' }), WX_APP), null);
  assert.equal(await principalFrom(auth({ uid: APP, isAnonymous: true }), WX_APP), null);
  assert.equal(await principalFrom(auth({ uid: APP, customUserId: 'fixture' }), WX_APP), null);
  assert.equal(await principalFrom(auth({ uid: APP }, { uid: 'other-account', email: 'test@example.invalid' }), WX_APP), null);
  assert.equal(await principalFrom(auth({ uid: APP }, { uid: APP }), WX_APP), null);
  assert.equal(await principalFrom(auth({ uid: APP }, { uid: APP, status: 'BLOCKED', email: 'seller@example.invalid' }), WX_APP), null);
  assert.deepEqual(await principalFrom(auth({ uid: APP }, { uid: APP, email: 'seller@example.invalid' }), WX_APP), { provider: 'app', id: APP });
});

test('binding requires both clients, hides identities and secrets, and rejects replay', async () => {
  const f = fixture();
  const wx = f.handler('wx', SELLER);
  const app = f.handler('app', APP);
  const rogue = f.handler('wx', OTHER);
  const { invite } = await data(wx, 'identity.start', { mode: 'link', openId: OTHER });
  const claim = await data(app, 'identity.claim', { invite, uid: 'pretend-app' });
  const stored = JSON.stringify(f.rows(collections.invites));
  assert.ok(!stored.includes(invite.split('.')[1]) && !stored.includes(claim.confirmation));
  await code(rogue, 'identity.confirm', claim, 'INVITE_INVALID');
  await code(app, 'identity.confirm', claim, 'WRONG_CLIENT');
  await code(app, 'identity.claim', { invite }, 'INVITE_INVALID');
  await code(app, 'items.markSold', { itemId: ITEM, ownerOpenId: SELLER }, 'LINK_REQUIRED');
  const linked = await data(wx, 'identity.confirm', claim);
  assert.deepEqual(await data(app, 'identity.status'), linked);
  assert.deepEqual(await data(wx, 'identity.status'), linked);
  assert.match(linked.userId, /^user_[0-9a-f]{40}$/);
  assert.equal(f.rows(collections.links).length, 2);
  assert.equal(f.rows(collections.invites).length, 0);
  await code(wx, 'identity.confirm', claim, 'INVITE_INVALID');
});

test('an expired or replaced invitation cannot bind an account', async () => {
  const f = fixture();
  const wx = f.handler('wx', SELLER);
  const app = f.handler('app', APP);
  const first = await data(wx, 'identity.start', { mode: 'link' });
  const second = await data(wx, 'identity.start', { mode: 'link' });
  await code(app, 'identity.claim', first, 'INVITE_INVALID');
  const claim = await data(app, 'identity.claim', second);
  f.advance(5 * 60 * 1000);
  await code(wx, 'identity.confirm', claim, 'INVITE_INVALID');
  assert.equal(f.rows(collections.links).length, 0);
});

test('conflicting confirmations pair one account and failed writes roll back both sides', async () => {
  const appKeyConflict = fixture();
  const app = appKeyConflict.handler('app', APP);
  const w1 = appKeyConflict.handler('wx', SELLER);
  const w2 = appKeyConflict.handler('wx', OTHER);
  const pending = await Promise.all([w1, w2].map(async wx => {
    const { invite } = await data(wx, 'identity.start', { mode: 'link' });
    const claim = await data(app, 'identity.claim', { invite });
    return { wx, claim };
  }));
  const results = await Promise.all(pending.map(({ wx, claim }) => call(wx, 'identity.confirm', claim)));
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(appKeyConflict.rows(collections.links).length, 2);
  const rollback = fixture({ failAdd: row => row._id.startsWith('app_') });
  const wx = rollback.handler('wx', SELLER);
  const invitation = await data(wx, 'identity.start', { mode: 'link' });
  const claim = await data(rollback.handler('app', APP), 'identity.claim', invitation);
  await code(wx, 'identity.confirm', claim, 'TRADE_UNAVAILABLE');
  assert.equal(rollback.rows(collections.links).length, 0);
  assert.equal(rollback.rows(collections.invites).length, 1);
});

test('two-sided unlink immediately revokes App access and preserves the old ownership and chat', async () => {
  const f = fixture();
  const wx = f.handler('wx', SELLER);
  const app = f.handler('app', APP);
  const { userId } = await pair(wx, app);
  const { invite } = await data(wx, 'identity.start', { mode: 'unlink' });
  await code(f.handler('app', 'wrong-app'), 'identity.claim', { invite }, 'LINK_STATE');
  await data(wx, 'identity.confirm', await data(app, 'identity.claim', { invite }));
  assert.deepEqual(await data(app, 'identity.status'), { linked: false, userId: null });
  assert.deepEqual(await data(wx, 'identity.status'), { linked: false, userId });
  await code(app, 'chat.get', { conversationId: CHAT }, 'LINK_REQUIRED');
  assert.equal((await data(wx, 'chat.get', { conversationId: CHAT })).messages[0].id, 'legacy-msg-1');
  assert.equal(f.rows(collections.items).find(item => item._id === ITEM).ownerOpenId, SELLER);
  assert.equal((await pair(wx, app)).userId, userId);
});

test('only the seller can mark a market item sold and the catalog reads that same row', async () => {
  const f = fixture();
  const seller = f.handler('wx', SELLER);
  const buyer = f.handler('wx', BUYER);
  const app = f.handler('app', APP);
  const catalog = createCatalogHandler({ store: f.catalogStore, signFiles: () => assert.fail('no media') });
  await pair(seller, app);
  assert.equal((await data(catalog, 'items.get', { itemId: ITEM })).status, 'ACTIVE');
  await code(buyer, 'items.markSold', { itemId: ITEM, ownerOpenId: SELLER }, 'ITEM_FORBIDDEN');
  await code(app, 'items.markSold', { itemId: 'fixture-service' }, 'ITEM_FORBIDDEN');
  await code(app, 'items.markSold', { itemId: 'fixture-deleted' }, 'ITEM_STATE');
  const { revision } = await data(app, 'items.getOwned', { itemId: ITEM });
  const sold = await data(app, 'items.markSold', { itemId: ITEM, revision });
  const original = f.rows(collections.items).find(item => item._id === ITEM);
  f.advance(1000);
  assert.deepEqual(await data(seller, 'items.markSold', { itemId: ITEM, revision }), sold);
  assert.deepEqual(f.rows(collections.items).find(item => item._id === ITEM), original);
  assert.ok((await data(catalog, 'items.browse')).items.every(item => item.id !== ITEM));
  assert.deepEqual(await data(catalog, 'items.get', { itemId: ITEM }), { id: ITEM, status: 'SOLD', currency: 'NZD', images: [], thumbnail: null });
});

test('favorites are shared, idempotent and preserve legacy profile fields', async () => {
  const f = fixture();
  const wx = f.handler('wx', BUYER);
  const app = f.handler('app', APP);
  await pair(wx, app);
  await data(app, 'favorites.set', { itemId: ITEM, favorited: true });
  await data(app, 'favorites.set', { itemId: ITEM, favorited: true });
  assert.equal((await data(wx, 'favorites.get', { itemId: ITEM })).favorited, true);
  const saved = f.rows(collections.profiles).find(profile => profile._id === BUYER);
  assert.deepEqual(saved.favoriteItemIds, [ITEM]);
  assert.equal(saved.privatePhone, 'synthetic-private-value');
  const listed = (await data(app, 'favorites.list')).items;
  assert.equal(listed[0].id, ITEM);
  assert.deepEqual((await data(f.handler('wx', OTHER), 'favorites.list')).items, []);
  assert.ok(!JSON.stringify(listed).includes('synthetic-private-value'));
  await data(wx, 'favorites.set', { itemId: ITEM, favorited: false });
  assert.equal((await data(app, 'favorites.get', { itemId: ITEM })).favorited, false);
  await code(app, 'favorites.set', { itemId: 'fixture-service', favorited: true }, 'ITEM_UNAVAILABLE');
});

test('existing chat is private and a retried send does not duplicate messages or unread count', async () => {
  const f = fixture();
  const wx = f.handler('wx', SELLER);
  const app = f.handler('app', APP);
  await pair(wx, app);
  const fake = f.handler(null);
  const stranger = f.handler('wx', OTHER);
  await code(fake, 'chat.get', { conversationId: CHAT, userInfo: { openId: SELLER } }, 'AUTH_REQUIRED');
  await code(stranger, 'chat.get', { conversationId: CHAT }, 'CHAT_FORBIDDEN');
  await code(stranger, 'chat.send', { conversationId: CHAT, requestId: 'new-id', text: 'Hi' }, 'CHAT_FORBIDDEN');
  assert.deepEqual(await data(stranger, 'chat.list'), { conversations: [] });
  assert.equal((await data(app, 'chat.list')).conversations[0].id, CHAT);
  const text = 'Yes, it is available';
  const send = () => data(app, 'chat.send', { conversationId: CHAT, requestId: 'same-id', text });
  const messages = await Promise.all([send(), send()]);
  assert.deepEqual(messages[0], messages[1]);
  await code(app, 'chat.send', { conversationId: CHAT, requestId: 'same-id', text: 'Different' }, 'MESSAGE_CONFLICT');
  const conversation = await data(f.handler('wx', BUYER), 'chat.get', { conversationId: CHAT });
  assert.equal(conversation.messages[0].id, 'legacy-msg-1');
  assert.equal(conversation.messages[1].text, text);
  assert.equal(conversation.messages.length, 2);
  assert.equal(conversation.unread, 1);
  assert.ok(!JSON.stringify(conversation).includes(SELLER));
  await f.store.transaction(tx => tx.update(collections.profiles, BUYER, { blockedUserIds: [SELLER] }));
  await code(app, 'chat.send', { conversationId: CHAT, requestId: 'blocked-id', text }, 'CHAT_BLOCKED');
});

test('banned and unapproved test profiles cannot modify shared data', async () => {
  const f = fixture();
  await code(f.handler('wx', SELLER, { allowTestProfiles: false }), 'identity.start', { mode: 'link' }, 'PROFILE_REQUIRED');
  const app = f.handler('app', APP);
  await pair(f.handler('wx', SELLER), app);
  await f.store.transaction(tx => tx.update(collections.profiles, SELLER, { status: 'banned' }));
  await code(app, 'items.markSold', { itemId: ITEM }, 'PROFILE_REQUIRED');
  await code(app, 'chat.list', {}, 'PROFILE_REQUIRED');
});

test('opening an existing buyer conversation preserves its ID, and concurrent new opens share one ID', async () => {
  const f = fixture();
  const buyer = f.handler('wx', BUYER);
  const app = f.handler('app', APP);
  await pair(buyer, app);
  assert.equal((await data(app, 'chat.ensure', { itemId: ITEM })).id, CHAT);
  const options = { itemId: 'fixture-second-item' };
  const both = await Promise.all([data(app, 'chat.ensure', options), data(buyer, 'chat.ensure', options)]);
  assert.equal(both[0].id, both[1].id);
  assert.match(both[0].id, /^conversation_[a-f0-9]{40}$/);
  assert.equal(f.rows(collections.conversations).length, 2);
  const seller = f.handler('wx', SELLER);
  await code(seller, 'chat.ensure', { itemId: ITEM }, 'CHAT_SELF');
  assert.equal((await data(seller, 'chat.get', { conversationId: CHAT })).unread, 1);
  await data(seller, 'chat.markRead', { conversationId: CHAT });
  assert.equal((await data(seller, 'chat.get', { conversationId: CHAT })).unread, 0);
});

test('notifications are visible and markable by the recipient only', async () => {
  const f = fixture();
  const seller = f.handler('wx', SELLER);
  const other = f.handler('wx', OTHER);
  const app = f.handler('app', APP);
  await pair(seller, app);
  assert.deepEqual(await data(other, 'notifications.list'), { notifications: [] });
  await code(other, 'notifications.markRead', { notificationId: 'fixture-notice' }, 'NOTIFICATION_FORBIDDEN');
  const { notifications: [notice] } = await data(app, 'notifications.list');
  assert.equal(notice.read, false);
  assert.equal(notice.id, 'fixture-notice');
  assert.ok(!JSON.stringify(notice).includes('synthetic-private-value'));
  assert.ok(!JSON.stringify(notice).includes(BUYER));
  await data(app, 'notifications.markRead', { notificationId: notice.id });
  assert.equal((await data(seller, 'notifications.list')).notifications[0].read, true);
});
