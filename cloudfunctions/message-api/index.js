const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const CONVERSATIONS = 'market_conversations';
const NOTIFICATIONS = 'market_notifications';
const MARKET_ITEMS = 'market_items';
const USER_PROFILES = 'user_profiles';
// 内测绕过手机号授权；上线强制绑定前改为 false 并重新部署。
const INTERNAL_TEST_MODE = true;
const INTERNAL_TEST_AVATAR = '/assets/branding/mini-program-avatar.png';

function text(value, maxLength) {
  return String(value === undefined || value === null ? '' : value).trim().slice(0, maxLength);
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function validAvatar(value) {
  const avatar = text(value, 500);
  return /^cloud:\/\//i.test(avatar) || (/^https:\/\//i.test(avatar) && !/^https:\/\/tmp\//i.test(avatar));
}

function validIdentity(profile) {
  if (!profile || !text(profile.nickName, 30)) return false;
  const phoneIdentityReady = profile.phoneBound === true
    && !!number(profile.identityConfirmedAtMs)
    && validAvatar(profile.avatarUrl);
  const internalTestIdentityReady = INTERNAL_TEST_MODE
    && profile.internalTestAccess === true
    && (validAvatar(profile.avatarUrl) || profile.avatarUrl === INTERNAL_TEST_AVATAR);
  // 旧内测账号先兼容使用；客户端会在下次进入时补录协议确认。
  const policyReady = (!!text(profile.termsAcceptedVersion, 40) && !!number(profile.policiesAcceptedAtMs))
    || (INTERNAL_TEST_MODE && profile.internalTestAccess === true);
  return (phoneIdentityReady || internalTestIdentityReady) && policyReady;
}

async function resolveFileURLs(values) {
  const source = (Array.isArray(values) ? values : [values]).map(value => text(value, 500));
  const fileIds = Array.from(new Set(source.filter(value => /^cloud:\/\//i.test(value))));
  if (!fileIds.length) return source;
  try {
    const chunks = [];
    for (let index = 0; index < fileIds.length; index += 50) chunks.push(fileIds.slice(index, index + 50));
    const results = await Promise.all(chunks.map(fileList => cloud.getTempFileURL({ fileList })));
    const urls = new Map(results.flatMap(result => result.fileList || []).map(file => [
      file.fileID,
      file.status === 0 && file.tempFileURL ? file.tempFileURL : file.fileID
    ]));
    return source.map(value => urls.get(value) || value);
  } catch (error) {
    return source;
  }
}

async function resolveConversationMedia(conversation) {
  const output = { ...conversation };
  const resolved = await resolveFileURLs([output.itemThumb, output.sellerAvatar, output.buyerAvatar]);
  output.itemThumb = resolved[0] || '';
  output.sellerAvatar = resolved[1] || '';
  output.buyerAvatar = resolved[2] || '';
  return output;
}

async function resolveNotificationMedia(notification) {
  const output = { ...notification };
  const snapshotImage = output.itemSnapshot && Array.isArray(output.itemSnapshot.images)
    ? output.itemSnapshot.images[0]
    : '';
  const resolved = await resolveFileURLs([output.fromAvatar, output.itemThumb, snapshotImage]);
  output.fromAvatar = resolved[0] || '';
  output.itemThumb = resolved[1] || '';
  if (output.itemSnapshot && snapshotImage) {
    output.itemSnapshot = { ...output.itemSnapshot, images: [resolved[2] || snapshotImage] };
  }
  return output;
}

async function resolveMessagePageMedia(conversations, notifications) {
  const conversationList = conversations || [];
  const notificationList = notifications || [];
  const media = [];
  const conversationPositions = conversationList.map(conversation => {
    const start = media.length;
    media.push(conversation.itemThumb, conversation.sellerAvatar, conversation.buyerAvatar);
    return start;
  });
  const notificationPositions = notificationList.map(notification => {
    const snapshotImage = notification.itemSnapshot && Array.isArray(notification.itemSnapshot.images)
      ? notification.itemSnapshot.images[0]
      : '';
    const start = media.length;
    media.push(notification.fromAvatar, notification.itemThumb, snapshotImage);
    return { start, snapshotImage };
  });
  const resolved = await resolveFileURLs(media);
  return {
    conversations: conversationList.map((conversation, index) => {
      const start = conversationPositions[index];
      return {
        ...conversation,
        itemThumb: resolved[start] || '',
        sellerAvatar: resolved[start + 1] || '',
        buyerAvatar: resolved[start + 2] || ''
      };
    }),
    notifications: notificationList.map((notification, index) => {
      const position = notificationPositions[index];
      const output = {
        ...notification,
        fromAvatar: resolved[position.start] || '',
        itemThumb: resolved[position.start + 1] || ''
      };
      if (output.itemSnapshot && position.snapshotImage) {
        output.itemSnapshot = {
          ...output.itemSnapshot,
          images: [resolved[position.start + 2] || position.snapshotImage]
        };
      }
      return output;
    })
  };
}

function token(prefix, value) {
  return `${prefix}_${crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 40)}`;
}

async function getUserProfile(openid, fallbackName) {
  try {
    const result = await db.collection(USER_PROFILES).doc(openid).get();
    const profile = result && result.data;
    if (!validIdentity(profile)) {
      throw new Error('请先完成微信身份确认并同意用户协议和隐私政策');
    }
    if (profile.status === 'banned') throw new Error('账号已被限制使用');
    return {
      nickName: text(profile.nickName, 30) || fallbackName,
      avatarUrl: text(profile.avatarUrl, 500),
      blockedUserIds: (Array.isArray(profile.blockedUserIds) ? profile.blockedUserIds : [])
        .map(value => text(value, 100))
        .filter(Boolean)
    };
  } catch (error) {
    const message = String(error && (error.errMsg || error.message) || '');
    if (message.includes('does not exist') || message.includes('DOCUMENT_NOT_FOUND') || message.includes('-502001')) {
      throw new Error('请先完成微信身份确认并同意用户协议和隐私政策');
    }
    throw error;
  }
}

function getConversationId(itemId, buyerOpenId, sellerOpenId) {
  return token('conversation', `${itemId}:${buyerOpenId}:${sellerOpenId}`);
}

function publicConversationId(conversation) {
  return conversation.publicId || token('conversation', conversation._id);
}

function publicNotificationId(notification) {
  return notification.publicId || token('notification', notification._id);
}

async function findNotificationForUser(id, openid) {
  const notificationId = text(id, 200);
  let notification = null;
  try {
    const result = await db.collection(NOTIFICATIONS).doc(notificationId).get();
    notification = result && result.data;
  } catch (error) {
    const message = String(error && (error.errMsg || error.message) || '');
    if (!message.includes('does not exist') && !message.includes('DOCUMENT_NOT_FOUND') && !message.includes('-502001')) throw error;
  }
  if (!notification) {
    const result = await db.collection(NOTIFICATIONS).where({
      recipientOpenId: openid,
      publicId: notificationId
    }).limit(1).get();
    notification = result.data && result.data[0];
  }
  if (!notification) {
    const legacy = await db.collection(NOTIFICATIONS).where({ recipientOpenId: openid }).limit(100).get();
    notification = (legacy.data || []).find(item => publicNotificationId(item) === notificationId) || null;
    if (notification && !notification.publicId) {
      await db.collection(NOTIFICATIONS).doc(notification._id).update({ data: { publicId: notificationId } });
    }
  }
  if (!notification || notification.recipientOpenId !== openid) throw new Error('无权访问该提醒');
  return notification;
}

async function getMarketItem(itemId) {
  const id = text(itemId, 100);
  if (!id) throw new Error('缺少商品信息');
  const result = await db.collection(MARKET_ITEMS).doc(id).get();
  const item = result && result.data;
  if (!item || item.status !== 'active' || !['market', 'service'].includes(item.publishType)) {
    throw new Error('发布不存在或已下架');
  }
  if (!item.ownerOpenId) throw new Error('商品缺少卖家身份');
  return item;
}

async function getConversationForUser(id, openid) {
  const conversationId = text(id, 200);
  let conversation = null;
  try {
    const result = await db.collection(CONVERSATIONS).doc(conversationId).get();
    conversation = result && result.data;
  } catch (error) {
    const message = String(error && (error.errMsg || error.message) || '');
    if (!message.includes('does not exist') && !message.includes('DOCUMENT_NOT_FOUND') && !message.includes('-502001')) throw error;
  }
  if (!conversation) {
    const migrated = await db.collection(CONVERSATIONS).where({ publicId: conversationId }).limit(1).get();
    conversation = migrated.data && migrated.data[0];
  }
  if (!conversation) {
    const legacy = await db.collection(CONVERSATIONS).where(_.or([
      { buyerOpenId: openid },
      { sellerOpenId: openid }
    ])).limit(100).get();
    conversation = (legacy.data || []).find(item => publicConversationId(item) === conversationId) || null;
    if (conversation && !conversation.publicId) {
      await db.collection(CONVERSATIONS).doc(conversation._id).update({ data: { publicId: conversationId } });
    }
  }
  if (!conversation || ![conversation.buyerOpenId, conversation.sellerOpenId].includes(openid)) {
    throw new Error('无权访问该会话');
  }
  return conversation;
}

function roleFor(conversation, openid) {
  if (conversation.sellerOpenId === openid) return 'seller';
  if (conversation.buyerOpenId === openid) return 'buyer';
  throw new Error('无权访问该会话');
}

function publicMessage(message) {
  return {
    id: text(message.id, 100),
    senderRole: message.senderRole === 'seller' ? 'seller' : 'buyer',
    sender: message.senderRole === 'seller' || message.sender === 'seller' ? 'seller' : 'buyer',
    text: text(message.text, 300),
    kind: text(message.kind, 30) || 'text',
    createdAt: number(message.createdAt)
  };
}

function publicConversation(conversation, openid, includeMessages = true) {
  return {
    id: publicConversationId(conversation),
    itemId: conversation.itemId,
    itemType: conversation.itemType || 'product',
    itemTitle: conversation.itemTitle,
    itemPrice: number(conversation.itemPrice),
    itemThumb: conversation.itemThumb || '',
    itemIcon: conversation.itemIcon || '📦',
    itemSource: 'cloud',
    sellerName: conversation.sellerName || '卖家',
    sellerAvatar: conversation.sellerAvatar || '',
    buyerName: conversation.buyerName || '买家',
    buyerAvatar: conversation.buyerAvatar || '',
    currentUserRole: roleFor(conversation, openid),
    lastMessage: conversation.lastMessage || '',
    updatedAt: number(conversation.updatedAtMs),
    unreadForSeller: number(conversation.unreadForSeller),
    unreadForBuyer: number(conversation.unreadForBuyer),
    messages: includeMessages && Array.isArray(conversation.messages)
      ? conversation.messages.slice(-200).map(publicMessage)
      : []
  };
}

function publicNotification(notification, conversationId) {
  return {
    id: publicNotificationId(notification),
    type: notification.type,
    fromNick: notification.actorNick || '用户',
    fromAvatar: notification.actorAvatar || '',
    itemId: notification.itemId,
    itemType: notification.itemType || 'product',
    itemSource: 'cloud',
    itemSnapshot: notification.itemSnapshot || null,
    itemTitle: notification.itemTitle || '发布信息',
    itemThumb: notification.itemThumb || '',
    text: notification.text || '',
    conversationId: conversationId || '',
    createdAt: number(notification.createdAtMs),
    read: !!notification.read
  };
}

function publicConversationReference(value, mappedIds) {
  const id = text(value, 200);
  if (!id) return '';
  if (id.startsWith('conversation_')) return id;
  return mappedIds.get(id) || token('conversation', id);
}

function itemSnapshot(item) {
  const itemThumb = text(item.thumbnail, 500)
    || (Array.isArray(item.images) && item.images.length ? text(item.images[0], 500) : '');
  return {
    id: item._id,
    _id: item._id,
    title: text(item.title, 80),
    description: text(item.description, 300),
    category: text(item.category, 30),
    subCategory: text(item.subCategory, 30),
    price: number(item.price),
    images: itemThumb ? [itemThumb] : [],
    videoPath: text(item.videoPath, 500),
    publisherNick: text(item.publisherNick, 30),
    publisherAvatar: text(item.publisherAvatar, 500),
    publishType: item.publishType === 'service' ? 'service' : 'market',
    itemType: item.publishType === 'service' ? 'service' : 'product',
    source: 'cloud',
    itemKey: `cloud:${item.publishType === 'service' ? 'service' : 'product'}:${item._id}`,
    createdAtMs: number(item.createdAtMs)
  };
}

async function ensureConversation(input, openid) {
  const item = await getMarketItem(input.itemId);
  const sellerOpenId = item.ownerOpenId;
  if (sellerOpenId === openid) throw new Error('不能与自己的商品发起买家会话');
  const buyer = await getUserProfile(openid, '一位买家');
  const seller = await getUserProfile(sellerOpenId, '卖家');
  if (buyer.blockedUserIds.includes(sellerOpenId) || seller.blockedUserIds.includes(openid)) {
    throw new Error('你与该用户之间已停止联系');
  }
  const id = getConversationId(item._id, openid, sellerOpenId);
  const reference = db.collection(CONVERSATIONS).doc(id);
  try {
    const existing = await reference.get();
    if (existing && existing.data) {
      const updated = {
        ...existing.data,
        buyerName: buyer.nickName,
        buyerAvatar: buyer.avatarUrl,
        itemTitle: text(item.title, 80),
        itemPrice: number(item.price),
        itemThumb: text(item.thumbnail, 500) || (Array.isArray(item.images) && item.images.length ? text(item.images[0], 500) : ''),
        sellerName: seller.nickName,
        sellerAvatar: seller.avatarUrl,
        publicId: publicConversationId(existing.data)
      };
      const { _id, ...updateData } = updated;
      await reference.update({ data: updateData });
      return resolveConversationMedia(publicConversation(updated, openid));
    }
  } catch (error) {
    const message = String(error && (error.errMsg || error.message) || '');
    if (!message.includes('does not exist') && !message.includes('DOCUMENT_NOT_FOUND') && !message.includes('-502001')) throw error;
  }

  const legacy = await db.collection(CONVERSATIONS).where({
    itemId: item._id,
    buyerOpenId: openid,
    sellerOpenId
  }).limit(1).get();
  const legacyConversation = legacy.data && legacy.data[0];
  if (legacyConversation) {
    const publicId = publicConversationId(legacyConversation);
    await db.collection(CONVERSATIONS).doc(legacyConversation._id).update({
      data: {
        publicId,
        buyerName: buyer.nickName,
        buyerAvatar: buyer.avatarUrl,
        itemTitle: text(item.title, 80),
        itemPrice: number(item.price),
        itemThumb: text(item.thumbnail, 500) || (Array.isArray(item.images) && item.images.length ? text(item.images[0], 500) : ''),
        sellerName: seller.nickName,
        sellerAvatar: seller.avatarUrl
      }
    });
    return resolveConversationMedia(publicConversation({
      ...legacyConversation,
      publicId,
      buyerName: buyer.nickName,
      buyerAvatar: buyer.avatarUrl,
      sellerName: seller.nickName,
      sellerAvatar: seller.avatarUrl
    }, openid));
  }

  const now = Date.now();
  const welcomeText = `你好，关于「${text(item.title, 80) || '这件商品'}」可以直接在这里沟通。`;
  const conversation = {
    _id: id,
    publicId: id,
    itemId: item._id,
    itemType: item.publishType === 'service' ? 'service' : 'product',
    itemTitle: text(item.title, 80),
    itemPrice: number(item.price),
    itemThumb: text(item.thumbnail, 500) || (Array.isArray(item.images) && item.images.length ? text(item.images[0], 500) : ''),
    itemIcon: '📦',
    buyerOpenId: openid,
    sellerOpenId,
    buyerName: buyer.nickName,
    buyerAvatar: buyer.avatarUrl,
    sellerName: seller.nickName,
    sellerAvatar: seller.avatarUrl,
    lastMessage: welcomeText,
    createdAtMs: now,
    updatedAtMs: now,
    unreadForSeller: 0,
    unreadForBuyer: 0,
    messages: [{
      id: `msg_${now}_welcome`,
      senderOpenId: sellerOpenId,
      senderRole: 'seller',
      sender: 'seller',
      text: welcomeText,
      kind: 'welcome',
      createdAt: now
    }]
  };
  const { _id, ...conversationData } = conversation;
  await reference.set({ data: conversationData });
  return resolveConversationMedia(publicConversation(conversation, openid));
}

async function upsertNotification(type, item, buyer, conversationId, openid) {
  const sellerOpenId = item.ownerOpenId;
  if (sellerOpenId === openid) return null;
  const noticeId = token('notification', `${type}:${item._id}:${openid}`);
  const now = Date.now();
  const actionText = type === 'favorite' ? '收藏了你的发布' : '想购买你的发布';
  const notification = {
    _id: noticeId,
    publicId: noticeId,
    type,
    recipientOpenId: sellerOpenId,
    actorOpenId: openid,
    actorNick: buyer.nickName,
    actorAvatar: buyer.avatarUrl,
    itemId: item._id,
    itemType: item.publishType === 'service' ? 'service' : 'product',
    itemTitle: text(item.title, 80),
    itemThumb: text(item.thumbnail, 500) || (Array.isArray(item.images) && item.images.length ? text(item.images[0], 500) : ''),
    itemSnapshot: itemSnapshot(item),
    conversationId: conversationId || '',
    text: `${buyer.nickName}${actionText}`,
    createdAtMs: now,
    read: false
  };
  const { _id, ...notificationData } = notification;
  await db.collection(NOTIFICATIONS).doc(noticeId).set({ data: notificationData });
  return notification;
}

async function addMessage(input, openid, profileChecked) {
  const senderProfile = await getUserProfile(openid, '用户');
  const conversation = await getConversationForUser(input.conversationId, openid);
  const otherOpenId = conversation.sellerOpenId === openid ? conversation.buyerOpenId : conversation.sellerOpenId;
  const otherProfile = await getUserProfile(otherOpenId, '用户');
  if (senderProfile.blockedUserIds.includes(otherOpenId) || otherProfile.blockedUserIds.includes(openid)) {
    throw new Error('你与该用户之间已停止联系');
  }
  const role = roleFor(conversation, openid);
  const messageText = text(input.text, 300);
  if (!messageText) throw new Error('消息不能为空');
  const now = Date.now();
  const message = {
    id: `msg_${now}_${Math.floor(Math.random() * 100000)}`,
    senderOpenId: openid,
    senderRole: role,
    sender: role,
    text: messageText,
    kind: text(input.kind, 30) || 'text',
    createdAt: now
  };
  const update = {
    messages: _.push([message]),
    lastMessage: messageText,
    updatedAtMs: now
  };
  if (role === 'seller') update.unreadForBuyer = _.inc(1);
  else update.unreadForSeller = _.inc(1);
  await db.collection(CONVERSATIONS).doc(conversation._id).update({ data: update });
  return publicMessage(message);
}

async function markRead(input, openid) {
  const conversation = await getConversationForUser(input.conversationId, openid);
  const role = roleFor(conversation, openid);
  await db.collection(CONVERSATIONS).doc(conversation._id).update({
    data: role === 'seller' ? { unreadForSeller: 0 } : { unreadForBuyer: 0 }
  });
  if (role === 'seller') {
    await db.collection(NOTIFICATIONS).where({
      recipientOpenId: openid,
      conversationId: _.in([conversation._id, publicConversationId(conversation)]),
      read: false
    }).update({ data: { read: true } });
  }
  return true;
}

async function pollConversation(input, openid) {
  const conversation = await getConversationForUser(input.conversationId, openid);
  const role = roleFor(conversation, openid);
  const updatedAt = number(conversation.updatedAtMs);
  const sinceUpdatedAt = Math.max(0, number(input.sinceUpdatedAt));
  const unread = role === 'seller'
    ? number(conversation.unreadForSeller)
    : number(conversation.unreadForBuyer);
  if (unread > 0) {
    await db.collection(CONVERSATIONS).doc(conversation._id).update({
      data: role === 'seller' ? { unreadForSeller: 0 } : { unreadForBuyer: 0 }
    });
  }
  return {
    currentUserRole: role,
    updatedAt,
    messages: updatedAt > sinceUpdatedAt && Array.isArray(conversation.messages)
      ? conversation.messages.slice(-50).map(publicMessage)
      : []
  };
}

exports.main = async (event) => {
  const input = event || {};
  const action = input.action || 'list';
  const openid = cloud.getWXContext().OPENID;
  if (!openid) throw new Error('无法识别当前用户');

  if (action === 'ensureConversation') {
    return { ok: true, conversation: await ensureConversation(input, openid) };
  }

  if (action === 'getConversation') {
    const conversation = await getConversationForUser(input.conversationId, openid);
    return { ok: true, conversation: await resolveConversationMedia(publicConversation(conversation, openid)) };
  }

  if (action === 'pollConversation') {
    return { ok: true, ...(await pollConversation(input, openid)) };
  }

  if (action === 'addMessage') {
    return { ok: true, message: await addMessage(input, openid) };
  }

  if (action === 'createPurchaseIntent') {
    const buyer = await getUserProfile(openid, '一位买家');
    let conversation = await ensureConversation(input, openid);
    const alreadySent = (conversation.messages || []).some(message => message.kind === 'purchase-intent');
    if (!alreadySent) {
      await addMessage({
        conversationId: conversation.id,
        text: `你好，我想购买「${conversation.itemTitle || '这件商品'}」，请问还在吗？`,
        kind: 'purchase-intent'
      }, openid, true);
    }
    const item = await getMarketItem(input.itemId);
    await upsertNotification('purchase', item, buyer, conversation.id, openid);
    const refreshed = await getConversationForUser(conversation.id, openid);
    return { ok: true, conversation: await resolveConversationMedia(publicConversation(refreshed, openid)) };
  }

  if (action === 'notifyFavorite') {
    const item = await getMarketItem(input.itemId);
    const buyer = await getUserProfile(openid, '一位买家');
    const notification = await upsertNotification('favorite', item, buyer, '', openid);
    return {
      ok: true,
      notification: notification ? await resolveNotificationMedia(publicNotification(notification, '')) : null
    };
  }

  if (action === 'list') {
    const conversationSkip = Math.max(0, number(input.conversationSkip));
    const notificationSkip = Math.max(0, number(input.notificationSkip));
    const limit = Math.min(50, Math.max(1, number(input.limit) || 20));
    const conversationsResult = await db.collection(CONVERSATIONS).where(_.or([
      { buyerOpenId: openid },
      { sellerOpenId: openid }
    ])).skip(conversationSkip).limit(limit).get();
    const notificationsResult = await db.collection(NOTIFICATIONS)
      .where({ recipientOpenId: openid })
      .skip(notificationSkip)
      .limit(limit)
      .get();
    const rawConversations = (conversationsResult.data || [])
      .map(item => publicConversation(item, openid, false))
      .sort((left, right) => right.updatedAt - left.updatedAt);
    const conversationIds = new Map((conversationsResult.data || []).map(item => [item._id, publicConversationId(item)]));
    const rawNotifications = (notificationsResult.data || [])
      .map(item => publicNotification(
        item,
        publicConversationReference(item.conversationId, conversationIds)
      ))
      .sort((left, right) => right.createdAt - left.createdAt);
    const resolvedPage = await resolveMessagePageMedia(rawConversations, rawNotifications);
    return {
      ok: true,
      conversations: resolvedPage.conversations,
      notifications: resolvedPage.notifications,
      conversationSkip: conversationSkip + (conversationsResult.data || []).length,
      notificationSkip: notificationSkip + (notificationsResult.data || []).length,
      hasMore: (conversationsResult.data || []).length === limit || (notificationsResult.data || []).length === limit
    };
  }

  if (action === 'markConversationRead') {
    await markRead(input, openid);
    return { ok: true };
  }

  if (action === 'markNotificationRead') {
    const notification = await findNotificationForUser(input.notificationId, openid);
    await db.collection(NOTIFICATIONS).doc(notification._id).update({ data: { read: true } });
    return { ok: true };
  }

  if (action === 'markAllRead') {
    await db.collection(CONVERSATIONS).where({ buyerOpenId: openid }).update({ data: { unreadForBuyer: 0 } });
    await db.collection(CONVERSATIONS).where({ sellerOpenId: openid }).update({ data: { unreadForSeller: 0 } });
    await db.collection(NOTIFICATIONS).where({ recipientOpenId: openid, read: false }).update({ data: { read: true } });
    return { ok: true };
  }

  throw new Error('不支持的操作');
};
