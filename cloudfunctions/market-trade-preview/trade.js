'use strict';

const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const { collections, ID, TradeError, check, hash, id, itemKey, publishType, array, label } = require('./shared');
const { createItemActions, ownerItem, favoriteItem, OPTIONS } = require('./items');
const { createMediaUpload, MAX_ENCODED_BYTES } = require('./media');
const { createGovernance } = require('./governance');
const INVITE_MS = 5 * 60 * 1000;
const SECRET = /^[a-f0-9]{48}$/;

function secret() {
  return randomBytes(24).toString('hex');
}

function matchesSecret(value, digest) {
  return typeof value === 'string' && SECRET.test(value) && typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest)
    && timingSafeEqual(Buffer.from(hash(value), 'hex'), Buffer.from(digest, 'hex'));
}

function inputFrom(event) {
  if (typeof event?.body === 'string') {
    check(event.body.length <= MAX_ENCODED_BYTES + 8192, 'INVALID_REQUEST', '请求过长');
    let input;
    try { input = JSON.parse(event.body); } catch { throw new TradeError('INVALID_REQUEST', '请求格式无效'); }
    check(event.body.length <= 8192 || input?.action === 'media.upload', 'INVALID_REQUEST', '请求过长');
    return input;
  }
  return event?.body || event;
}

function createTradeHandler({ store, authenticate, environmentId, wechatAppId, allowTestProfiles = false, now = Date.now, mediaRoot = '', uploadFile, signFiles }) {
  const key = (provider, identity) => `${provider}_${hash(environmentId, wechatAppId, provider, identity).slice(0, 40)}`;

  async function requireProfile(tx, openId) {
    const profile = await tx.get(collections.profiles, openId);
    const consent = !!profile?.termsAcceptedVersion && !!profile?.policiesAcceptedAtMs;
    const avatar = label(profile?.avatarUrl, 500);
    const verifiedPhone = profile?.phoneBound === true && Number(profile?.identityConfirmedAtMs) > 0
      && (/^cloud:\/\//i.test(avatar) || (/^https:\/\//i.test(avatar) && !/^https:\/\/tmp\//i.test(avatar)));
    const approvedTestProfile = allowTestProfiles && profile?.internalTestAccess === true;
    check(profile?.status === 'active' && label(profile.nickName, 40) && consent && (verifiedPhone || approvedTestProfile),
      'PROFILE_REQUIRED', '请完成测试微信账号的身份及协议确认');
    return profile;
  }

  function requireProvider(principal, provider) {
    check(principal.provider === provider, 'WRONG_CLIENT', provider === 'wx' ? '请在微信小程序中确认' : '请使用 App 邮箱账号');
  }

  async function verifiedLink(tx, principal) {
    const document = await tx.get(collections.links, key(principal.provider, principal.id));
    if (!document) return null;
    const { openId, appUid } = document;
    const isWechat = principal.provider === 'wx';
    check(typeof openId === 'string' && ID.test(openId) && typeof appUid === 'string' && ID.test(appUid)
      && (isWechat ? openId : appUid) === principal.id, 'LINK_INCONSISTENT', '账号关联需要核查');
    const other = await tx.get(collections.links, isWechat ? key('app', appUid) : key('wx', openId));
    check(other?.openId === openId && other.appUid === appUid, 'LINK_INCONSISTENT', '账号关联需要核查');
    return { openId, appUid };
  }

  function identityResult(openId, linked) {
    const userId = openId ? key('user', openId) : null;
    return { linked, userId };
  }

  async function account(tx, principal) {
    const link = await verifiedLink(tx, principal);
    const openId = principal.provider === 'wx' ? principal.id : link?.openId;
    check(openId, 'LINK_REQUIRED', '请先在微信和 App 两边确认账号绑定');
    const profile = await requireProfile(tx, openId);
    return { openId, profile };
  }

  const governance = createGovernance({ store, account, scopedQuery, mediaRoot, signFiles, now });
  const actions = {
    ...createItemActions({ account, now, mediaRoot }),
    ...governance.actions,

    'identity.status': async (tx, principal) => {
      const link = await verifiedLink(tx, principal);
      const openId = principal.provider === 'wx' ? principal.id : link?.openId;
      if (openId) await requireProfile(tx, openId);
      return identityResult(openId, !!link);
    },

    'identity.start': async (tx, principal, input) => {
      requireProvider(principal, 'wx');
      await requireProfile(tx, principal.id);
      const mode = input.mode;
      check(mode === 'link' || mode === 'unlink', 'INVALID_MODE', '请选择绑定或解绑');
      const link = await verifiedLink(tx, principal);
      check(mode === 'link' ? !link : !!link, 'LINK_STATE', mode === 'link' ? '该微信账号已有绑定' : '该微信账号尚未绑定');
      const inviteId = key('invite', principal.id);
      const token = secret();
      const expiresAtMs = now() + INVITE_MS;
      await tx.set(collections.invites, inviteId, { openId: principal.id, mode, tokenHash: hash(token), expiresAtMs });
      return { invite: `${inviteId}.${token}`, expiresAtMs, mode };
    },

    'identity.claim': async (tx, principal, input) => {
      requireProvider(principal, 'app');
      const parts = typeof input.invite === 'string' && input.invite.length <= 96 ? input.invite.split('.') : [];
      check(parts.length === 2 && /^invite_[a-f0-9]{40}$/.test(parts[0]), 'INVITE_INVALID', '配对码无效或已过期');
      const [inviteId, token] = parts;
      const invite = await tx.get(collections.invites, inviteId);
      check(invite?.expiresAtMs > now() && !invite.appUid && key('invite', invite.openId) === inviteId
        && matchesSecret(token, invite.tokenHash), 'INVITE_INVALID', '配对码无效或已过期');
      await requireProfile(tx, invite.openId);
      const link = await verifiedLink(tx, principal);
      check(invite.mode === 'link' ? !link : invite.mode === 'unlink' && link?.openId === invite.openId,
        'LINK_STATE', 'App 账号与此次操作不匹配');
      const confirmation = secret();
      await tx.update(collections.invites, inviteId, { appUid: principal.id, confirmationHash: hash(confirmation) });
      return { confirmation, mode: invite.mode, expiresAtMs: invite.expiresAtMs };
    },

    'identity.confirm': async (tx, principal, input) => {
      requireProvider(principal, 'wx');
      await requireProfile(tx, principal.id);
      const inviteId = key('invite', principal.id);
      const invite = await tx.get(collections.invites, inviteId);
      check(invite?.openId === principal.id && invite.expiresAtMs > now() && invite.appUid
        && invite.mode === input.mode && matchesSecret(input.confirmation, invite.confirmationHash),
      'INVITE_INVALID', '确认码无效或已过期');
      const appPrincipal = { provider: 'app', id: invite.appUid };
      const wxLink = await verifiedLink(tx, principal);
      const appLink = await verifiedLink(tx, appPrincipal);
      const wxKey = key('wx', principal.id);
      const appKey = key('app', invite.appUid);
      if (invite.mode === 'link') {
        check(!wxLink && !appLink, 'LINK_STATE', '账号已有绑定');
        const link = { openId: principal.id, appUid: invite.appUid, linkedAtMs: now() };
        await tx.add(collections.links, wxKey, link);
        await tx.add(collections.links, appKey, link);
      } else {
        check(invite.mode === 'unlink' && wxLink?.appUid === invite.appUid && appLink?.openId === principal.id,
          'LINK_STATE', '账号绑定已发生变化');
        await tx.remove(collections.links, wxKey);
        await tx.remove(collections.links, appKey);
      }
      await tx.remove(collections.invites, inviteId);
      return identityResult(principal.id, invite.mode === 'link');
    },

    'favorites.get': async (tx, principal, input) => {
      const itemId = itemKey(input.itemId);
      const { profile } = await account(tx, principal);
      return { itemId, favorited: array(profile.favoriteItemIds).includes(itemId) };
    },

    'favorites.set': async (tx, principal, input) => {
      const itemId = itemKey(input.itemId);
      check(typeof input.favorited === 'boolean', 'INVALID_FAVORITE', '收藏状态无效');
      const { openId, profile } = await account(tx, principal);
      const favorites = array(profile.favoriteItemIds);
      if (favorites.includes(itemId) === input.favorited) return { itemId, favorited: input.favorited };
      if (input.favorited) {
        const item = await tx.get(collections.items, itemId);
        check(item?.status === 'active' && item.publishType === 'market' && item.ownerOpenId
          && !array(profile.blockedUserIds).includes(item.ownerOpenId), 'ITEM_UNAVAILABLE', '该商品无法收藏');
        const owner = await tx.get(collections.profiles, item.ownerOpenId);
        check(owner?.status !== 'banned', 'ITEM_UNAVAILABLE', '该商品无法收藏');
        check(favorites.length < 100, 'FAVORITES_FULL', '收藏已满，请先移除不需要的收藏');
      }
      const favoriteItemIds = input.favorited ? [itemId, ...favorites] : favorites.filter(value => value !== itemId);
      await tx.update(collections.profiles, openId, { favoriteItemIds, updatedAtMs: now() });
      return { itemId, favorited: input.favorited };
    },

    'chat.get': async (tx, principal, input) => {
      const { openId } = await account(tx, principal);
      const { conversation, role } = await participant(tx, id(input.conversationId), openId);
      return { ...chatSummary(conversation, role), ...messagePage(conversation, openId, input) };
    },

    'chat.markRead': async (tx, principal, input) => {
      const { openId } = await account(tx, principal);
      const conversationId = id(input.conversationId);
      const { conversation, role } = await participant(tx, conversationId, openId);
      const field = role === 'buyer' ? 'unreadForBuyer' : 'unreadForSeller';
      const unread = Number(conversation[field]) || 0;
      if (input.throughMessageId !== undefined && array(conversation.messages).at(-1)?.id !== input.throughMessageId) {
        return { id: conversationId, unread };
      }
      if (unread > 0) await tx.update(collections.conversations, conversationId, { [field]: 0 });
      return { id: conversationId, unread: 0 };
    },

    'chat.send': async (tx, principal, input) => {
      const conversationId = id(input.conversationId);
      const requestId = id(input.requestId);
      const content = typeof input.text === 'string' ? input.text.trim() : '';
      check(content && content.length <= 300, 'MESSAGE_LENGTH', '消息需为 1 至 300 字');
      const { openId, profile } = await account(tx, principal);
      const { conversation, role } = await participant(tx, conversationId, openId);
      const otherId = role === 'buyer' ? conversation.sellerOpenId : conversation.buyerOpenId;
      const other = await requireProfile(tx, otherId);
      check(!array(profile.blockedUserIds).includes(otherId) && !array(other.blockedUserIds).includes(openId),
        'CHAT_BLOCKED', '你与该用户之间已停止联系');
      const messageId = `msg_${hash(conversationId, openId, requestId).slice(0, 40)}`;
      const messages = array(conversation.messages);
      const previous = messages.find(message => message.id === messageId);
      if (previous) {
        check(previous.senderOpenId === openId && previous.text === content, 'MESSAGE_CONFLICT', '同一发送编号已有不同消息');
        return messageView({ ...previous, requestId }, openId);
      }
      check(messages.length < 500, 'CHAT_LIMIT', '此测试会话已达到发送上限');
      const message = { id: messageId, requestId, senderOpenId: openId, senderRole: role, sender: role, text: content, kind: 'text', createdAt: now() };
      await tx.appendMessage(conversationId, message, role === 'buyer' ? 'unreadForSeller' : 'unreadForBuyer');
      return messageView(message, openId);
    },

    'notifications.markRead': async (tx, principal, input) => {
      const { openId } = await account(tx, principal);
      const notificationId = id(input.notificationId);
      const notification = await tx.get(collections.notifications, notificationId);
      check(notification?.recipientOpenId === openId, 'NOTIFICATION_FORBIDDEN', '无权访问该通知');
      if (notification.read !== true) await tx.update(collections.notifications, notificationId, { read: true });
      return { id: notificationId, read: true };
    }
  };

  async function scopedQuery(principal, query) {
    const { openId, profile } = await store.transaction(tx => account(tx, principal));
    const result = await query(openId, profile);
    const current = await store.transaction(tx => account(tx, principal));
    check(current.openId === openId, 'LINK_STATE', '账号绑定已发生变化');
    return { openId, result };
  }

  async function listChats(principal, input) {
    const limit = input.limit ?? 25;
    check(Number.isInteger(limit) && limit >= 1 && limit <= 30, 'CHAT_PAGE', '会话分页参数无效');
    const before = chatCursor(input.cursor);
    const { openId, result } = await scopedQuery(principal, id => store.conversationsFor(id, limit + 1, before));
    const conversations = result.slice(0, limit)
      .map(row => ({ row, role: roleFor(row, openId) }))
      .filter(entry => entry.role)
      .map(({ row, role }) => chatSummary(row, role));
    if (input.limit === undefined && input.cursor === undefined) return { conversations };
    const last = conversations.at(-1);
    const hasMore = result.length > limit && !!last;
    return { conversations, page: { hasMore, nextCursor: hasMore ? `${last.updatedAt}:${last.id}` : '' } };
  }

  async function listNotifications(principal) {
    const { openId, result: rows } = await scopedQuery(principal, id => store.notificationsFor(id));
    const notifications = rows.filter(row => row.recipientOpenId === openId).map(row => ({
      id: row._id,
      itemId: row.itemId,
      title: label(row.itemTitle, 80),
      type: label(row.type, 30),
      text: label(row.text, 300),
      read: row.read === true,
      createdAt: Number(row.createdAtMs) || 0
    }));
    return { notifications };
  }

  async function ensureChat(principal, input) {
    const itemId = itemKey(input.itemId);
    const type = publishType(input.publishType);
    const saleContext = async tx => {
      const buyer = await account(tx, principal);
      const item = await tx.get(collections.items, itemId);
      check(item?.publishType === type && item.status === 'active' && ID.test(item.ownerOpenId || ''),
        'ITEM_UNAVAILABLE', '该商品当前无法发起会话');
      const sellerId = item.ownerOpenId;
      check(sellerId !== buyer.openId, 'CHAT_SELF', '无法就自己的商品发起会话');
      const seller = await requireProfile(tx, sellerId);
      check(!array(buyer.profile.blockedUserIds).includes(sellerId) && !array(seller.blockedUserIds).includes(buyer.openId),
        'CHAT_BLOCKED', '你与该用户之间已停止联系');
      return { item, buyer, sellerId, seller };
    };
    const initial = await store.transaction(saleContext);
    const legacyId = await store.findConversationId(itemId, initial.buyer.openId, initial.sellerId);
    return store.transaction(async tx => {
      const { item, buyer, sellerId, seller } = await saleContext(tx);
      check(buyer.openId === initial.buyer.openId && sellerId === initial.sellerId, 'CHAT_CONTEXT_CHANGED', '商品或账号状态已变化，请重试');
      const buyerId = buyer.openId;
      // Keep the same ID as the existing WeChat message API for newly created conversations.
      const conversationId = `conversation_${createHash('sha256').update(`${itemId}:${buyerId}:${sellerId}`).digest('hex').slice(0, 40)}`;
      const recorded = await tx.get(collections.conversations, conversationId)
        || (legacyId && await tx.get(collections.conversations, legacyId));
      if (recorded) {
        check(recorded.itemId === itemId && recorded.buyerOpenId === buyerId && recorded.sellerOpenId === sellerId,
          'CHAT_CONTEXT_CHANGED', '会话记录需要核查');
        return chatSummary(recorded, 'buyer');
      }
      const time = now();
      const conversation = {
        _id: conversationId, publicId: conversationId, itemId, itemType: type === 'service' ? 'service' : 'product',
        itemTitle: label(item.title, 80), itemPrice: Number(item.price) || 0,
        buyerOpenId: buyerId, sellerOpenId: sellerId,
        buyerName: label(buyer.profile.nickName, 30), sellerName: label(seller.nickName, 30),
        createdAtMs: time, updatedAtMs: time, unreadForBuyer: 0, unreadForSeller: 0, messages: []
      };
      await tx.add(collections.conversations, conversationId, conversation);
      return chatSummary(conversation, 'buyer');
    });
  }

  async function listOwnedItems(principal, input) {
    const offset = input.offset ?? 0;
    const status = input.status || '';
    const type = publishType(input.publishType);
    const statuses = ['', 'ACTIVE', 'SOLD', 'UNLISTED', 'DELETED', 'SUSPENDED', 'DELETING'];
    check(Number.isSafeInteger(offset) && offset >= 0 && offset <= 100000 && statuses.includes(status),
      'ITEM_LIST', '我的商品筛选或页码无效');
    const { openId, result } = await scopedQuery(principal, id => store.itemsFor(id, status.toLowerCase(), offset, type));
    return {
      items: result.slice(0, 20).filter(item => item.ownerOpenId === openId && item.publishType === type).map(ownerItem),
      page: { hasMore: result.length > 20, nextOffset: offset + 20 }
    };
  }

  async function listFavoriteItems(principal, input) {
    const offset = input.offset ?? 0;
    check(Number.isSafeInteger(offset) && offset >= 0 && offset <= 100, 'ITEM_LIST', '收藏页码无效');
    const { result } = await scopedQuery(principal, async (_openId, profile) => {
      const favorites = [...new Set(array(profile.favoriteItemIds).slice(0, 100))]
        .filter(value => typeof value === 'string' && value.length <= 100 && ID.test(value));
      const ids = favorites.slice(offset, offset + 20);
      const blocked = new Set(array(profile.blockedUserIds));
      const rows = ids.length ? await store.activeItemsById(ids) : [];
      const ownerIds = [...new Set(rows.map(item => item.ownerOpenId).filter(Boolean))];
      const owners = ownerIds.length ? await store.profilesById(ownerIds) : [];
      for (const owner of owners) {
        if (owner.status === 'banned') blocked.add(owner._id);
      }
      const byId = new Map(rows.filter(item => !blocked.has(item.ownerOpenId)).map(item => [item._id, item]));
      return {
        items: ids.filter(itemId => byId.has(itemId)).map(itemId => favoriteItem(byId.get(itemId))),
        page: { hasMore: offset + 20 < favorites.length, nextOffset: offset + 20 }
      };
    });
    return result;
  }

  const queryActions = {
    ...governance.queries,
    'chat.list': listChats,
    'chat.ensure': ensureChat,
    'notifications.list': listNotifications,
    'items.options': () => OPTIONS,
    'items.mine': listOwnedItems,
    'favorites.list': listFavoriteItems,
    'media.upload': createMediaUpload({ store, account, mediaRoot, uploadFile, now })
  };

  return async event => {
    try {
      const input = inputFrom(event);
      check(input && typeof input.action === 'string' && (Object.hasOwn(queryActions, input.action) || Object.hasOwn(actions, input.action)),
        'INVALID_ACTION', '该联调操作不可用');
      const principal = await authenticate();
      check((principal?.provider === 'wx' || principal?.provider === 'app') && typeof principal.id === 'string' && ID.test(principal.id),
        'AUTH_REQUIRED', '请使用已登录的微信或 App 测试账号');
      const data = Object.hasOwn(queryActions, input.action) ? await queryActions[input.action](principal, input)
        : await store.transaction(tx => actions[input.action](tx, principal, input));
      return { ok: true, data };
    } catch (error) {
      if (error instanceof TradeError) return { ok: false, error: { code: error.code, message: error.message } };
      return { ok: false, error: { code: 'TRADE_UNAVAILABLE', message: '联调服务暂不可用，请检查测试环境配置后重试' } };
    }
  };
}

function roleFor(conversation, openId) {
  if (conversation?.sellerOpenId === openId) return 'seller';
  if (conversation?.buyerOpenId === openId) return 'buyer';
  return null;
}

async function participant(tx, conversationId, openId) {
  const conversation = await tx.get(collections.conversations, conversationId);
  const role = roleFor(conversation, openId);
  check(role, 'CHAT_FORBIDDEN', '无权访问该会话');
  return { conversation, role };
}

function chatSummary(conversation, role) {
  return {
    id: conversation._id,
    itemId: conversation.itemId,
    ...(conversation.itemType === 'service' ? { publishType: 'service' } : {}),
    title: label(conversation.itemTitle, 80),
    itemPrice: Number(conversation.itemPrice) || 0,
    otherName: label(role === 'buyer' ? conversation.sellerName : conversation.buyerName, 40),
    lastMessage: label(conversation.lastMessage, 300),
    currentUserRole: role,
    updatedAt: Number(conversation.updatedAtMs) || 0,
    unread: Number(role === 'buyer' ? conversation.unreadForBuyer : conversation.unreadForSeller) || 0
  };
}

function chatCursor(value) {
  if (value === undefined || value === '') return null;
  const match = typeof value === 'string' && /^(\d{1,16}):([A-Za-z0-9_-]{1,128})$/.exec(value);
  check(match && Number.isSafeInteger(Number(match[1])), 'CHAT_PAGE', '会话分页参数无效');
  return { time: Number(match[1]), id: match[2] };
}

function messagePage(conversation, openId, input) {
  const rows = array(conversation.messages);
  const limit = input.limit ?? 200;
  const direction = input.direction ?? 'LATEST';
  check(Number.isInteger(limit) && limit >= 1 && limit <= 200 && ['LATEST', 'OLDER', 'NEWER'].includes(direction),
    'CHAT_PAGE', '消息分页参数无效');
  let start = Math.max(0, rows.length - limit);
  let end = rows.length;
  if (direction !== 'LATEST') {
    const cursor = id(input.cursor);
    const index = rows.findIndex(row => row.id === cursor);
    check(index >= 0, 'CHAT_PAGE', '消息位置已变化，请刷新会话');
    if (direction === 'OLDER') {
      end = index;
      start = Math.max(0, end - limit);
    } else {
      start = index + 1;
      end = Math.min(rows.length, start + limit);
    }
  }
  const messages = rows.slice(start, end).map(row => messageView(row, openId));
  return { messages, page: {
    oldestCursor: messages[0]?.id || '',
    newestCursor: messages.at(-1)?.id || '',
    hasMore: direction === 'NEWER' ? end < rows.length : start > 0
  } };
}

function messageView(message, openId) {
  const mine = message.senderOpenId === openId;
  return {
    id: label(message.id, 100),
    senderRole: message.senderRole === 'seller' || message.sender === 'seller' ? 'seller' : 'buyer',
    mine,
    clientMessageId: mine ? label(message.requestId, 128) : '',
    kind: ['system', 'welcome'].includes(String(message.kind || '').toLowerCase()) ? 'SYSTEM' : 'TEXT',
    text: label(message.text, 300),
    createdAt: Number(message.createdAt) || 0
  };
}

module.exports = { collections, createTradeHandler };
