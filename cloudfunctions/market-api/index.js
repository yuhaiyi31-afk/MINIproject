const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const contentPolicy = require('./content-policy');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLLECTION = 'market_items';
const USER_PROFILES = 'user_profiles';
const CONVERSATIONS = 'market_conversations';
const NOTIFICATIONS = 'market_notifications';
// 内测绕过手机号授权；上线强制绑定前改为 false 并重新部署。
const INTERNAL_TEST_MODE = true;
const INTERNAL_TEST_AVATAR = '/assets/branding/mini-program-avatar.png';

function text(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function token(prefix, value) {
  return `${prefix}_${crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 40)}`;
}

function validAvatar(value) {
  const avatar = text(value, 500);
  return /^cloud:\/\//i.test(avatar) || (/^https:\/\//i.test(avatar) && !/^https:\/\/tmp\//i.test(avatar));
}

function validIdentity(profile) {
  if (!profile || !text(profile.nickName, 40)) return false;
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

function mediaFileIds(item) {
  const data = item || {};
  return Array.from(new Set([
    ...(Array.isArray(data.images) ? data.images : []),
    data.thumbnail,
    data.videoPath
  ].map(value => text(value, 500)).filter(value => /^cloud:\/\//i.test(value))));
}

async function deleteMediaFiles(fileIds) {
  const values = Array.from(new Set((fileIds || []).filter(value => /^cloud:\/\//i.test(String(value || '')))));
  let deleted = 0;
  const failedFiles = [];
  for (let index = 0; index < values.length; index += 50) {
    const fileList = values.slice(index, index + 50);
    try {
      const result = await cloud.deleteFile({ fileList });
      const outcomes = result.fileList || [];
      const outcomeById = new Map(outcomes.map(entry => [entry.fileID, entry]));
      fileList.forEach(fileId => {
        const outcome = outcomeById.get(fileId);
        if (outcome && Number(outcome.status) === 0) deleted += 1;
        else failedFiles.push(fileId);
      });
    } catch (error) {
      failedFiles.push(...fileList);
    }
  }
  return { deleted, failed: failedFiles.length, failedFiles };
}

async function updateItemMediaReferences(itemId, item) {
  const thumbnail = text(item.thumbnail, 500)
    || (Array.isArray(item.images) && item.images.length ? text(item.images[0], 500) : '');
  const title = text(item.title, 80);
  const price = Math.max(0, number(item.price));
  const results = await Promise.allSettled([
    db.collection(CONVERSATIONS).where({ itemId }).update({
      data: { itemTitle: title, itemPrice: price, itemThumb: thumbnail }
    }),
    db.collection(NOTIFICATIONS).where({ itemId }).update({
      data: {
        itemTitle: title,
        itemThumb: thumbnail,
        'itemSnapshot.title': title,
        'itemSnapshot.price': price,
        'itemSnapshot.images': thumbnail ? [thumbnail] : [],
        'itemSnapshot.videoPath': ''
      }
    })
  ]);
  return results.every(result => result.status === 'fulfilled');
}

async function clearItemMediaReferences(itemId) {
  const results = await Promise.allSettled([
    db.collection(CONVERSATIONS).where({ itemId }).update({ data: { itemThumb: '' } }),
    db.collection(NOTIFICATIONS).where({ itemId }).update({
      data: {
        itemThumb: '',
        'itemSnapshot.images': [],
        'itemSnapshot.videoPath': ''
      }
    })
  ]);
  return results.every(result => result.status === 'fulfilled');
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

async function resolvePublicItemMedia(item) {
  if (!item) return null;
  const images = Array.isArray(item.images) ? item.images : [];
  const resolved = await resolveFileURLs([...images, item.videoPath, item.publisherAvatar]);
  return {
    ...item,
    images: resolved.slice(0, images.length),
    videoPath: resolved[images.length] || '',
    publisherAvatar: resolved[images.length + 1] || ''
  };
}

async function resolvePublicItems(items) {
  const source = items || [];
  if (!source.length) return [];
  const media = [];
  const positions = source.map(item => {
    const images = Array.isArray(item.images) ? item.images : [];
    const start = media.length;
    media.push(...images, item.videoPath, item.publisherAvatar);
    return { start, imageCount: images.length };
  });
  const resolved = await resolveFileURLs(media);
  return source.map((item, index) => {
    const position = positions[index];
    return {
      ...item,
      images: resolved.slice(position.start, position.start + position.imageCount),
      videoPath: resolved[position.start + position.imageCount] || '',
      publisherAvatar: resolved[position.start + position.imageCount + 1] || ''
    };
  });
}

function cleanPayload(payload, profile) {
  const data = payload || {};
  const publishType = data.publishType === 'service' ? 'service' : 'market';
  return {
    title: text(data.title, 80),
    description: text(data.description, 1000),
    category: text(data.category, 30),
    subCategory: text(data.subCategory, 30),
    price: Math.max(0, number(data.price)),
    condition: publishType === 'market' ? text(data.condition, 30) : '',
    region: publishType === 'market' ? text(data.region, 50) : '',
    deliveryMethod: publishType === 'market' ? text(data.deliveryMethod, 30) : '',
    contact: text(data.contact, 100),
    images: Array.isArray(data.images) ? data.images.slice(0, 9).map(item => text(item, 500)) : [],
    thumbnail: text(data.thumbnail, 500),
    thumbnailSource: text(data.thumbnailSource, 500),
    videoPath: text(data.videoPath, 500),
    publisherNick: text(profile && profile.nickName, 40),
    publisherAvatar: text(profile && profile.avatarUrl, 500),
    publishType,
    itemType: publishType === 'service' ? 'service' : 'product',
    promiseReal: !!data.promiseReal,
    sellerType: profile && profile.sellerType === 'BUSINESS' ? 'BUSINESS' : 'PRIVATE',
    updatedAtMs: Date.now()
  };
}

async function getUserProfile(openid) {
  try {
    const result = await db.collection(USER_PROFILES).doc(openid).get();
    const profile = result && result.data;
    if (!validIdentity(profile)) {
      throw new Error('请先完成微信身份确认并同意用户协议和隐私政策');
    }
    if (profile.status === 'banned') throw new Error('账号已被限制使用');
    return profile;
  } catch (error) {
    const message = String(error && (error.errMsg || error.message) || '');
    if (message.includes('does not exist') || message.includes('DOCUMENT_NOT_FOUND') || message.includes('-502001')) {
      throw new Error('请先完成微信身份确认并同意用户协议和隐私政策');
    }
    throw error;
  }
}

function favoriteIds(profile) {
  return Array.from(new Set(
    (Array.isArray(profile && profile.favoriteItemIds) ? profile.favoriteItemIds : [])
      .map(id => text(id, 100))
      .filter(Boolean)
  )).slice(0, 100);
}

async function excludeBannedPublishers(items) {
  const owners = Array.from(new Set(items.map(item => item && item.ownerOpenId).filter(Boolean)));
  const banned = new Set();
  for (let start = 0; start < owners.length; start += 20) {
    const result = await db.collection(USER_PROFILES)
      .where({ _id: db.command.in(owners.slice(start, start + 20)), status: 'banned' })
      .field({ _id: true }).limit(20).get();
    (result.data || []).forEach(profile => banned.add(profile._id));
  }
  return items.filter(item => !banned.has(item.ownerOpenId));
}

async function listFavorites(openid) {
  const profile = await getUserProfile(openid);
  const ids = favoriteIds(profile);
  const blockedUserIds = new Set((Array.isArray(profile.blockedUserIds) ? profile.blockedUserIds : []).map(value => text(value, 100)));
  const chunks = [];
  for (let index = 0; index < ids.length; index += 10) chunks.push(ids.slice(index, index + 10));
  const results = await Promise.all(chunks.map(values => (
    db.collection(COLLECTION).where({ _id: db.command.in(values), status: 'active' }).limit(10).get()
  )));
  const itemsById = new Map(results.flatMap(result => result.data || []).map(item => [item._id, item]));
  const activeIds = ids.filter(id => itemsById.has(id));
  if (activeIds.length !== ids.length) {
    await db.collection(USER_PROFILES).doc(openid).update({
      data: { favoriteItemIds: activeIds, updatedAtMs: Date.now() }
    });
  }
  const visible = await excludeBannedPublishers(ids.map(id => itemsById.get(id)).filter(item => item && !blockedUserIds.has(item.ownerOpenId)));
  return resolvePublicItems(visible.map(item => publicListItem(item, openid)));
}

function validate(data) {
  if (!data.title) throw new Error('请填写商品标题');
  if (!data.description) throw new Error('请填写商品描述');
  if (!data.category) throw new Error('请选择商品分类');
  if (data.publishType === 'service' && !data.contact) throw new Error('请填写联系方式');
  if (!data.images.length) throw new Error('请至少上传一张真实图片');
  if (data.publishType === 'market' && !data.condition) throw new Error('请选择商品新旧程度');
  if (data.publishType === 'market' && !data.region) throw new Error('请选择大概区域');
  if (data.publishType === 'market' && !data.deliveryMethod) throw new Error('请选择交付方式');
}

function publicItem(item) {
  if (!item) return null;
  return {
    _id: item._id,
    title: text(item.title, 80),
    description: text(item.description, 1000),
    category: text(item.category, 30),
    subCategory: text(item.subCategory, 30),
    price: Math.max(0, number(item.price)),
    condition: text(item.condition, 30),
    region: text(item.region, 50),
    deliveryMethod: text(item.deliveryMethod, 30),
    images: Array.isArray(item.images) ? item.images.slice(0, 9).map(value => text(value, 500)) : [],
    thumbnail: text(item.thumbnail, 500),
    videoPath: text(item.videoPath, 500),
    publisherNick: text(item.publisherNick, 40),
    publisherAvatar: text(item.publisherAvatar, 500),
    publishType: item.publishType === 'service' ? 'service' : 'market',
    itemType: item.publishType === 'service' ? 'service' : 'product',
    promiseReal: !!item.promiseReal,
    sellerType: item.sellerType === 'BUSINESS' ? 'BUSINESS' : 'PRIVATE',
    status: item.status,
    createdAtMs: number(item.createdAtMs),
    updatedAtMs: number(item.updatedAtMs)
  };
}

function publicListItem(item, openid) {
  const output = publicItem(item);
  const listImage = output && (output.thumbnail || output.images[0]);
  return output ? {
    ...output,
    images: listImage ? [listImage] : [],
    videoPath: '',
    isOwner: !!openid && item.ownerOpenId === openid
  } : null;
}

function ownerItem(item) {
  const output = publicItem(item);
  return output ? {
    ...output,
    contact: text(item.contact, 100),
    thumbnailSource: text(item.thumbnailSource, 500),
    aiMetadata: item.aiMetadata || {
      schemaVersion: 1,
      status: 'reserved',
      recognizedLabels: [],
      generatedTitle: '',
      suggestedCategory: '',
      generatedDescription: '',
      estimatedPriceMin: 0,
      estimatedPriceMax: 0,
      currency: 'NZD'
    }
  } : null;
}

function listQueryFields(query) {
  return query.field({
    contact: false,
    videoPath: false,
    clientRequestId: false,
    createdAt: false,
    updatedAt: false
  });
}

async function scanItems(collection, input, predicate, openid) {
  let offset = Math.max(0, number(input.skip));
  const limit = Math.min(50, Math.max(1, number(input.limit) || 20));
  const items = [];
  let hasMore = true;
  let loops = 0;
  while (items.length < limit && hasMore && loops < 100) {
    const batch = await listQueryFields(
      collection.orderBy('createdAtMs', 'desc').skip(offset).limit(50)
    ).get();
    const rows = batch.data || [];
    if (!rows.length) {
      hasMore = false;
      break;
    }
    const visible = new Set((await excludeBannedPublishers(rows.filter(predicate))).map(item => item._id));
    let consumed = 0;
    for (const row of rows) {
      consumed += 1;
      if (visible.has(row._id)) items.push(publicListItem(row, openid));
      if (items.length >= limit) break;
    }
    offset += consumed;
    hasMore = consumed < rows.length || rows.length === 50;
    loops += 1;
  }
  return { items: await resolvePublicItems(items), hasMore, nextSkip: offset };
}

async function queryItems(collection, input, conditions, openid) {
  const offset = Math.max(0, number(input.skip));
  const limit = Math.min(50, Math.max(1, number(input.limit) || 20));
  try {
    const query = collection
      .where(conditions)
      .orderBy('createdAtMs', 'desc')
      .skip(offset)
      .limit(limit + 1);
    const result = await listQueryFields(query).get();
    const rows = result.data || [];
    const pageRows = rows.slice(0, limit);
    const visibleRows = await excludeBannedPublishers(pageRows);
    if (visibleRows.length !== pageRows.length) return null;
    return {
      items: await resolvePublicItems(visibleRows.map(item => publicListItem(item, openid)).filter(Boolean)),
      hasMore: rows.length > limit,
      nextSkip: offset + visibleRows.length
    };
  } catch (error) {
    // 旧环境尚未建立组合索引时继续使用兼容查询，确保线上列表不中断。
    return null;
  }
}

function browseSort(value) {
  return ['latest', 'nearby', 'priceAsc', 'priceDesc'].includes(value) ? value : 'latest';
}

function browseMatches(item, input, blockedUserIds) {
  if (!item || item.status !== 'active' || item.publishType !== 'market') return false;
  if (blockedUserIds.has(item.ownerOpenId)) return false;
  const keyword = text(input.keyword, 60).toLowerCase();
  if (keyword) {
    const terms = keyword.split(/\s+/).filter(Boolean);
    const searchable = [item.title, item.description, item.category, item.subCategory, item.region]
      .map(value => String(value || '').toLowerCase())
      .join(' ');
    if (!terms.every(term => searchable.includes(term))) return false;
  }
  const category = text(input.category, 30);
  const region = text(input.region, 50);
  if (category && item.category !== category) return false;
  if (region && item.region !== region) return false;
  const minPrice = input.minPrice === '' || input.minPrice === undefined ? 0 : Math.max(0, number(input.minPrice));
  const maxPrice = input.maxPrice === '' || input.maxPrice === undefined ? Infinity : Math.max(0, number(input.maxPrice));
  const price = Math.max(0, number(item.price));
  if (price < minPrice || price > maxPrice) return false;
  const days = Math.max(0, number(input.days));
  if (days && Date.now() - number(item.createdAtMs) > days * 24 * 60 * 60 * 1000) return false;
  return true;
}

async function getBlockedUserIds(openid) {
  try {
    const result = await db.collection(USER_PROFILES).doc(openid).get();
    return new Set((Array.isArray(result.data && result.data.blockedUserIds) ? result.data.blockedUserIds : [])
      .map(value => text(value, 100))
      .filter(Boolean));
  } catch (error) {
    return new Set();
  }
}

async function browseItems(collection, input, openid) {
  const skip = Math.max(0, number(input.skip));
  const limit = Math.min(50, Math.max(1, number(input.limit) || 20));
  const sort = browseSort(input.sort);
  const blockedUserIds = await getBlockedUserIds(openid);
  const matched = [];
  let documentOffset = 0;
  let reachedEnd = false;
  const scanLimit = 1000;
  while (documentOffset < scanLimit) {
    const batch = await listQueryFields(
      collection.orderBy('createdAtMs', 'desc').skip(documentOffset).limit(100)
    ).get();
    const rows = batch.data || [];
    if (!rows.length) {
      reachedEnd = true;
      break;
    }
    const visible = await excludeBannedPublishers(rows.filter(item => browseMatches(item, input, blockedUserIds)));
    matched.push(...visible);
    documentOffset += rows.length;
    if (rows.length < 100) reachedEnd = true;
    if (sort === 'latest' && matched.length > skip + limit) break;
    if (reachedEnd) break;
  }
  if (documentOffset >= scanLimit) reachedEnd = true;
  const region = text(input.region, 50);
  if (sort === 'priceAsc') {
    matched.sort((left, right) => number(left.price) - number(right.price) || number(right.createdAtMs) - number(left.createdAtMs));
  } else if (sort === 'priceDesc') {
    matched.sort((left, right) => number(right.price) - number(left.price) || number(right.createdAtMs) - number(left.createdAtMs));
  } else if (sort === 'nearby' && region) {
    matched.sort((left, right) => Number(right.region === region) - Number(left.region === region)
      || number(right.createdAtMs) - number(left.createdAtMs));
  }
  const page = matched.slice(skip, skip + limit);
  return {
    items: await resolvePublicItems(page.map(item => publicListItem(item, openid)).filter(Boolean)),
    hasMore: matched.length > skip + page.length || !reachedEnd,
    nextSkip: skip + page.length
  };
}

async function getOwnedDocument(id, openid) {
  const result = await db.collection(COLLECTION).doc(id).get();
  const item = result.data;
  if (!item || item.ownerOpenId !== openid) throw new Error('无权修改该发布');
  return item;
}

function duplicateSignature(item) {
  return JSON.stringify([
    text(item.publishType, 20),
    text(item.title, 80),
    text(item.description, 1000),
    text(item.category, 30),
    text(item.subCategory, 30),
    number(item.price),
    text(item.contact, 100)
  ]);
}

async function dedupeMine(openid, collection) {
  const result = await collection.where({ ownerOpenId: openid }).limit(100).get();
  const items = (result.data || []).slice().sort((left, right) => number(left.createdAtMs) - number(right.createdAtMs));
  const latestBySignature = new Map();
  const duplicateIds = [];
  for (const item of items) {
    const signature = duplicateSignature(item);
    const previous = latestBySignature.get(signature);
    const previousTime = number(previous && previous.createdAtMs);
    const currentTime = number(item.createdAtMs);
    if (previous && previousTime > 0 && currentTime > 0 && currentTime - previousTime <= 2 * 60 * 1000) {
      duplicateIds.push(item._id);
      continue;
    }
    latestBySignature.set(signature, item);
  }
  const now = Date.now();
  await Promise.all(duplicateIds.map(async id => {
    const item = items.find(entry => entry._id === id);
    await clearItemMediaReferences(id);
    await deleteMediaFiles(mediaFileIds(item));
    await collection.doc(id).update({
      data: {
        status: 'deleted',
        deleteReason: 'duplicate_publish',
        deletedAtMs: now,
        deletedBy: 'system',
        images: [],
        thumbnail: '',
        thumbnailSource: '',
        videoPath: '',
        updatedAtMs: now,
        updatedAt: db.serverDate()
      }
    });
  }));
  return duplicateIds.length;
}

exports.main = async (event) => {
  const input = event || {};
  const action = input.action || 'list';
  const openid = cloud.getWXContext().OPENID;
  const collection = db.collection(COLLECTION);

  if (action === 'browse') {
    return { ok: true, ...(await browseItems(collection, input, openid)) };
  }

  if (action === 'list') {
    const blockedUserIds = await getBlockedUserIds(openid);
    const result = blockedUserIds.size ? null : await queryItems(collection, input, { status: 'active', publishType: 'market' }, openid);
    return {
      ok: true,
      ...(result || await scanItems(collection, input, item => item.status === 'active' && item.publishType === 'market' && !blockedUserIds.has(item.ownerOpenId), openid))
    };
  }

  if (action === 'listServices') {
    const category = text(input.category, 30);
    const conditions = { status: 'active', publishType: 'service' };
    if (category) conditions.category = category;
    const blockedUserIds = await getBlockedUserIds(openid);
    const result = blockedUserIds.size ? null : await queryItems(collection, input, conditions, openid);
    return {
      ok: true,
      ...(result || await scanItems(collection, input, item => (
        item.status === 'active' && item.publishType === 'service' && (!category || item.category === category) && !blockedUserIds.has(item.ownerOpenId)
      ), openid))
    };
  }

  if (action === 'search') {
    const blockedUserIds = await getBlockedUserIds(openid);
    const terms = (Array.isArray(input.terms) ? input.terms : [input.keyword])
      .map(item => text(item, 30).toLowerCase())
      .filter(Boolean)
      .slice(0, 20);
    const result = await scanItems(collection, input, item => {
      if (item.status !== 'active' || item.publishType !== 'market' || blockedUserIds.has(item.ownerOpenId)) return false;
      if (!terms.length) return true;
      const searchable = [item.title, item.description, item.category, item.subCategory, item.publisherNick]
        .map(value => String(value || '').toLowerCase())
        .join(' ');
      return terms.some(term => searchable.includes(term));
    }, openid);
    return { ok: true, ...result };
  }

  if (action === 'publish') {
    const profile = await getUserProfile(openid);
    const data = cleanPayload(input.item, profile);
    validate(data);
    contentPolicy.assertAllowed(data);
    const clientRequestId = text(input.item && input.item.clientRequestId, 100);
    const createdAtMs = Date.now();
    const payload = {
      ...data,
      status: 'active',
      ownerOpenId: openid,
      clientRequestId,
      aiMetadata: {
        schemaVersion: 1,
        status: 'reserved',
        recognizedLabels: [],
        generatedTitle: '',
        suggestedCategory: '',
        generatedDescription: '',
        estimatedPriceMin: 0,
        estimatedPriceMax: 0,
        currency: 'NZD'
      },
      createdAtMs,
      statusChangedAtMs: createdAtMs,
      statusChangedBy: 'owner',
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    };
    if (clientRequestId) {
      const id = token('item', `${openid}:${clientRequestId}`);
      try {
        const existing = await collection.doc(id).get();
        if (existing && existing.data && existing.data.ownerOpenId === openid) return { ok: true, id };
      } catch (error) {
        const message = String(error && (error.errMsg || error.message) || '');
        if (!message.includes('does not exist') && !message.includes('DOCUMENT_NOT_FOUND') && !message.includes('-502001')) throw error;
      }
      await collection.doc(id).set({ data: payload });
      return { ok: true, id };
    }
    const result = await collection.add({ data: payload });
    return { ok: true, id: result._id };
  }

  if (action === 'dedupeMine') {
    return { ok: true, removed: await dedupeMine(openid, collection) };
  }

  if (action === 'update') {
    const id = text(input.id, 100);
    const existingItem = await getOwnedDocument(id, openid);
    if (existingItem.status === 'deleting') throw new Error('该内容正在清理，请先重试完成删除');
    if (existingItem.status === 'deleted') throw new Error('已删除的内容不能再次编辑');
    const profile = await getUserProfile(openid);
    const data = cleanPayload(input.item, profile);
    validate(data);
    contentPolicy.assertAllowed(data);
    await collection.doc(id).update({
      data: {
        ...data,
        aiMetadata: existingItem.aiMetadata || {
          schemaVersion: 1,
          status: 'reserved',
          recognizedLabels: [],
          generatedTitle: '',
          suggestedCategory: '',
          generatedDescription: '',
          estimatedPriceMin: 0,
          estimatedPriceMax: 0,
          currency: 'NZD'
        },
        updatedAt: db.serverDate()
      }
    });
    const referencesUpdated = await updateItemMediaReferences(id, data);
    const retainedFiles = new Set(mediaFileIds(data));
    const removedFiles = mediaFileIds(existingItem).filter(fileId => !retainedFiles.has(fileId));
    const cleanup = referencesUpdated
      ? await deleteMediaFiles(removedFiles)
      : { deleted: 0, failed: 0, deferred: removedFiles.length };
    return { ok: true, id, cleanup };
  }

  if (action === 'mine') {
    const result = await collection.where({ ownerOpenId: openid }).limit(100).get();
    const items = result.data
      .sort((left, right) => number(right.createdAtMs) - number(left.createdAtMs))
      .map(item => ({ ...publicListItem(item, openid), contact: text(item.contact, 100) }));
    return { ok: true, items };
  }

  if (action === 'mineMedia') {
    const result = await collection.where({ ownerOpenId: openid }).limit(100).get();
    const items = result.data.map(ownerItem);
    return { ok: true, items };
  }

  if (action === 'favorites') {
    return { ok: true, items: await listFavorites(openid) };
  }

  if (action === 'isFavorite') {
    const profile = await getUserProfile(openid);
    return { ok: true, favorited: favoriteIds(profile).includes(text(input.id, 100)) };
  }

  if (action === 'toggleFavorite') {
    const profile = await getUserProfile(openid);
    const id = text(input.id, 100);
    if (!id) throw new Error('内容不存在');
    const ids = favoriteIds(profile).filter(itemId => itemId !== id);
    if (input.favorited) {
      const result = await collection.doc(id).get();
      if (!result.data || result.data.status !== 'active' || !(await excludeBannedPublishers([result.data])).length) {
        throw new Error('内容不存在或已下架');
      }
      ids.unshift(id);
    }
    await db.collection(USER_PROFILES).doc(openid).update({
      data: { favoriteItemIds: ids.slice(0, 100), updatedAtMs: Date.now() }
    });
    return { ok: true, favorited: !!input.favorited };
  }

  if (action === 'get') {
    try {
      const result = await collection.doc(text(input.id, 100)).get();
      const item = result.data || null;
      if (!item || (item.status !== 'active' && item.ownerOpenId !== openid)) return { ok: true, item: null };
      const isOwner = item.ownerOpenId === openid;
      if (!isOwner && ((await getBlockedUserIds(openid)).has(item.ownerOpenId) || !(await excludeBannedPublishers([item])).length)) {
        return { ok: true, item: null };
      }
      return {
        ok: true,
        item: {
          ...(await resolvePublicItemMedia(isOwner ? ownerItem(item) : publicItem(item))),
          isOwner
        }
      };
    } catch (error) {
      const message = String(error && (error.errMsg || error.message) || '');
      if (message.includes('does not exist') || message.includes('DOCUMENT_NOT_FOUND') || message.includes('-502001')) {
        return { ok: true, item: null };
      }
      throw error;
    }
  }

  if (action === 'getOwned') {
    const item = await getOwnedDocument(text(input.id, 100), openid);
    return { ok: true, item: { ...ownerItem(item), isOwner: true } };
  }

  if (action === 'unlist') {
    const id = text(input.id, 100);
    const item = await getOwnedDocument(id, openid);
    if (item.status === 'deleting') throw new Error('该内容正在清理，请重试完成删除');
    const now = Date.now();
    await collection.doc(id).update({
      data: {
        status: 'unlisted',
        unlistedAtMs: now,
        statusChangedAtMs: now,
        statusChangedBy: 'owner',
        updatedAt: db.serverDate(),
        updatedAtMs: now
      }
    });
    return { ok: true };
  }

  if (action === 'setStatus') {
    const id = text(input.id, 100);
    const nextStatus = text(input.status, 20);
    if (!['active', 'unlisted', 'sold'].includes(nextStatus)) throw new Error('商品状态无效');
    const item = await getOwnedDocument(id, openid);
    if (['deleting', 'deleted', 'suspended'].includes(item.status)) throw new Error('当前商品状态不能由卖家修改');
    if (nextStatus === 'active') contentPolicy.assertAllowed(item);
    const now = Date.now();
    const statusData = {
      status: nextStatus,
      statusChangedAtMs: now,
      statusChangedBy: 'owner',
      updatedAtMs: now,
      updatedAt: db.serverDate()
    };
    if (nextStatus === 'sold') statusData.soldAtMs = now;
    if (nextStatus === 'unlisted') statusData.unlistedAtMs = now;
    if (nextStatus === 'active') statusData.relistedAtMs = now;
    await collection.doc(id).update({ data: statusData });
    return { ok: true, status: nextStatus };
  }

  if (action === 'remove') {
    const id = text(input.id, 100);
    const item = await getOwnedDocument(id, openid);
    if (item.status !== 'deleting') {
      await collection.doc(id).update({
        data: { status: 'deleting', deletionStartedAtMs: Date.now(), updatedAt: db.serverDate(), updatedAtMs: Date.now() }
      });
    }
    const referencesCleared = await clearItemMediaReferences(id);
    if (!referencesCleared) {
      return { ok: false, message: '内容已隐藏，但关联记录清理失败，请再次点击删除' };
    }
    const itemFiles = Array.isArray(item.pendingDeleteFiles)
      ? item.pendingDeleteFiles.filter(value => /^cloud:\/\//i.test(String(value || '')))
      : mediaFileIds(item);
    const cleanup = await deleteMediaFiles(itemFiles);
    if (cleanup.failed > 0) {
      await collection.doc(id).update({
        data: {
          status: 'deleting',
          pendingDeleteFiles: cleanup.failedFiles,
          images: [],
          thumbnail: '',
          thumbnailSource: '',
          videoPath: '',
          updatedAt: db.serverDate(),
          updatedAtMs: Date.now()
        }
      });
      return { ok: false, message: `内容已隐藏，仍有${cleanup.failed}个云文件待清理，请再次点击删除` };
    }
    const deletedAtMs = Date.now();
    await collection.doc(id).update({
      data: {
        status: 'deleted',
        deleteReason: 'owner_deleted',
        deletedAtMs,
        deletedBy: 'owner',
        deletionCompletedAtMs: deletedAtMs,
        pendingDeleteFiles: [],
        images: [],
        thumbnail: '',
        thumbnailSource: '',
        videoPath: '',
        updatedAt: db.serverDate(),
        updatedAtMs: deletedAtMs
      }
    });
    return { ok: true, cleanup, softDeleted: true };
  }

  throw new Error('不支持的操作');
};
