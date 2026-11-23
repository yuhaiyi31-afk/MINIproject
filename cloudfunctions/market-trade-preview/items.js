'use strict';

const { createHash } = require('node:crypto');
const { collections, TradeError, check, hash, id, itemKey, array, label } = require('./shared');
const { ASSET_ID, assetFileId } = require('./media');
const { assertAllowed } = require('./content-policy');

const OPTIONS = {
  categories: ['交通工具', '电子产品', '生活家居', '学习用品', '运动户外', '服饰美妆', '宠物用品', '乐器', '游戏娱乐', '其他'],
  conditions: ['全新', '几乎全新', '轻微使用', '正常使用', '明显使用'],
  regions: ['Auckland CBD', 'Central Auckland', 'North Shore', 'East Auckland', 'West Auckland', 'South Auckland', '其他新西兰地区'],
  deliveryMethods: ['当面交易', '买家自取', '邮寄', '双方协商']
};
const CONTACT = /@|https?:\/\/|www\.|(?:联系|微信|手机号|电话|邮箱|地址|门牌|contact|wechat|whatsapp|telegram|e-?mail|address)\s*[:：]|\d(?:[\s()+.-]*\d){7,}|(?:路|街|巷)\s*\d+\s*号|\b(?:apt|apartment|flat|room|unit)\s*#?\s*\d+\b|\b\d+(?:[/-]\d+)?\s+(?:[a-z.'’-]+\s+){1,5}(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|court|ct|place|pl|way|crescent|cres|boulevard)\b/i;
const NEXT = {
  active: ['sold', 'unlisted', 'deleted'],
  unlisted: ['active', 'sold', 'deleted'],
  sold: ['active', 'deleted']
};
const STATE_TIMESTAMP = { sold: 'soldAtMs', unlisted: 'unlistedAtMs', active: 'relistedAtMs', deleted: 'deletedAtMs' };

function cleanText(value) {
  return typeof value === 'string' ? value.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim() : '';
}

function publicField(value, max, fieldName) {
  const clean = cleanText(value);
  check(clean.length > 0 && clean.length <= max, 'ITEM_FIELDS', `请填写${fieldName}，最多 ${max} 字`);
  check(!CONTACT.test(clean), 'ITEM_CONTACT', '标题和描述中请移除联系方式、链接或详细地址');
  return clean;
}

function fieldsFrom(input) {
  const title = publicField(input.title, 80, '标题');
  const description = publicField(input.description, 1000, '描述');
  const priceText = typeof input.price === 'string' || typeof input.price === 'number' ? String(input.price).trim() : '';
  const price = Number(priceText);
  check(/^[0-9]{1,9}(?:\.[0-9]{1,2})?$/.test(priceText) && price <= 100_000_000,
    'ITEM_PRICE', '请输入有效的 NZD 价格，最多两位小数');
  check(OPTIONS.categories.includes(input.category), 'ITEM_FIELDS', '请选择商品分类');
  check(OPTIONS.conditions.includes(input.condition), 'ITEM_FIELDS', '请选择商品新旧程度');
  check(OPTIONS.regions.includes(input.region), 'ITEM_FIELDS', '请选择大致区域');
  check(OPTIONS.deliveryMethods.includes(input.deliveryMethod), 'ITEM_FIELDS', '请选择交付方式');
  const fields = { title, description, price, category: input.category, condition: input.condition, region: input.region, deliveryMethod: input.deliveryMethod };
  try {
    assertAllowed(fields);
  } catch (error) {
    throw new TradeError('ITEM_POLICY', error.message);
  }
  return fields;
}

function revisionOf(item) {
  return hash(item._id, item.title, item.description, item.price, item.category, item.subCategory,
    item.condition, item.region, item.deliveryMethod, item.images, item.thumbnail, item.videoPath,
    item.status, item.statusChangedAtMs, item.updatedAtMs);
}

function nextWriteTime(item, now) {
  const previous = Number(item.updatedAtMs);
  return Number.isSafeInteger(previous) && previous > 0 ? Math.max(now(), previous + 1) : now();
}

function ownerItem(item) {
  return {
    id: item._id, revision: revisionOf(item), status: String(item.status || '').toUpperCase(),
    title: label(item.title, 80), description: label(item.description, 1000), price: Number(item.price) || 0,
    currency: 'NZD', category: label(item.category, 40), condition: label(item.condition, 30),
    region: label(item.region, 80), deliveryMethod: label(item.deliveryMethod, 30),
    imageCount: array(item.images).length
  };
}

function favoriteItem(item) {
  const title = cleanText(item.title);
  return {
    id: item._id, title: !title || CONTACT.test(title) ? '商品' : title.slice(0, 80),
    price: Number(item.price) || 0, currency: 'NZD', status: 'ACTIVE',
    region: OPTIONS.regions.includes(item.region) ? item.region : '',
    createdAtMs: Number(item.createdAtMs) || 0
  };
}

function photoIds(input) {
  check(Array.isArray(input) && input.length > 0 && input.length <= 9,
    'ITEM_IMAGES', '请选择 1 至 9 张商品照片');
  check(input.every(value => typeof value === 'string' && ASSET_ID.test(value)) && new Set(input).size === input.length,
    'ITEM_IMAGES', '商品图片无效或重复');
  return input;
}

function publishedItemId(openId, requestId) {
  return `item_${createHash('sha256').update(`${openId}:${requestId}`).digest('hex').slice(0, 40)}`;
}

function createItemActions({ account, now, mediaRoot }) {
  async function owned(tx, principal, itemId) {
    const { openId } = await account(tx, principal);
    const item = await tx.get(collections.items, itemId);
    check(item?.publishType === 'market' && item.ownerOpenId === openId, 'ITEM_FORBIDDEN', '无权访问或修改该商品');
    return item;
  }

  async function attachPhotos(tx, ids, itemId, openId) {
    check(mediaRoot, 'MEDIA_DISABLED', '测试图片存储尚未配置');
    // Resolve every receipt before binding any of them to the item.
    const assets = [];
    for (const assetId of ids) {
      const asset = await tx.get(collections.media, assetId);
      check(asset?.ownerOpenId === openId && asset.state === 'ready' && asset.fileId === assetFileId(mediaRoot, assetId)
        && (asset.itemId === itemId || (!asset.itemId && asset.expiresAtMs > now())),
      'ITEM_IMAGE_FORBIDDEN', '图片已失效、已用于别的商品或不属于当前账号');
      assets.push(asset);
    }
    for (let index = 0; index < ids.length; index++) {
      if (!assets[index].itemId) await tx.update(collections.media, ids[index], { itemId });
    }
    const images = assets.map(asset => asset.fileId);
    return { images, thumbnail: images[0], thumbnailSource: images[0] };
  }

  async function transition(tx, item, target, revision) {
    if (item.status === target) return ownerItem(item);
    check(Object.hasOwn(NEXT, item.status) && NEXT[item.status].includes(target),
      'ITEM_STATE', '当前商品状态不允许此操作');
    check(revision === revisionOf(item), 'ITEM_REVISION', '商品已在其他设备上更新，请重新打开');
    if (target === 'active') {
      fieldsFrom(item);
      check(array(item.images).length > 0, 'ITEM_IMAGES', '重新上架前请添加商品照片');
    }
    const time = nextWriteTime(item, now);
    const changes = {
      status: target, [STATE_TIMESTAMP[target]]: time, updatedAt: new Date(time),
      updatedAtMs: time, statusChangedAtMs: time, statusChangedBy: 'owner'
    };
    if (target === 'deleted') {
      Object.assign(changes, {
        deletedBy: 'owner', deleteReason: 'owner_deleted',
        retainedMedia: {
          images: array(item.images), thumbnail: item.thumbnail || '', thumbnailSource: item.thumbnailSource || '', videoPath: item.videoPath || ''
        },
        images: [], thumbnail: '', thumbnailSource: '', videoPath: ''
      });
    }
    await tx.update(collections.items, item._id, changes);
    return ownerItem({ ...item, ...changes });
  }

  return {
    'items.getOwned': async (tx, principal, input) => ownerItem(await owned(tx, principal, itemKey(input.itemId))),

    'items.publishStatus': async (tx, principal, input) => {
      const { openId } = await account(tx, principal);
      const requestId = id(input.requestId);
      const item = await tx.get(collections.items, publishedItemId(openId, requestId));
      const ownedPublish = item?.ownerOpenId === openId && item?.clientRequestId === requestId && item?.publishType === 'market';
      return { item: ownedPublish ? ownerItem(item) : null };
    },

    'items.publish': async (tx, principal, input) => {
      const { openId, profile } = await account(tx, principal);
      const requestId = id(input.requestId);
      const fields = fieldsFrom(input);
      const ids = photoIds(input.photoAssetIds);
      check(input.promiseReal === true, 'ITEM_CONFIRMATION', '请确认商品信息真实、来源合法');
      const submissionHash = hash(fields, ids);
      // Match the legacy WeChat publish ID for this owner and request.
      const itemId = publishedItemId(openId, requestId);
      const existing = await tx.get(collections.items, itemId);
      if (existing) {
        check(existing.ownerOpenId === openId && existing.submissionHash === submissionHash,
          'ITEM_REQUEST_CONFLICT', '该发布请求已经处理，请在我的商品中查看');
        return ownerItem(existing);
      }
      const media = await attachPhotos(tx, ids, itemId, openId);
      const time = now();
      const item = {
        ...fields, ...media, ownerOpenId: openId, clientRequestId: requestId, submissionHash,
        itemType: 'product', publishType: 'market', currency: 'NZD', status: 'active', promiseReal: true,
        publisherNick: label(profile.nickName, 40), publisherAvatar: label(profile.avatarUrl, 500),
        sellerType: profile.sellerType === 'BUSINESS' ? 'BUSINESS' : 'PRIVATE',
        createdAtMs: time, updatedAtMs: time, statusChangedAtMs: time, statusChangedBy: 'owner',
        createdAt: new Date(time), updatedAt: new Date(time)
      };
      await tx.add(collections.items, itemId, item);
      return ownerItem({ _id: itemId, ...item });
    },

    'items.edit': async (tx, principal, input) => {
      const item = await owned(tx, principal, itemKey(input.itemId));
      const requestId = id(input.requestId);
      const fields = fieldsFrom(input);
      const ids = input.photoAssetIds === undefined ? null : photoIds(input.photoAssetIds);
      check(typeof input.revision === 'string' && /^[a-f0-9]{64}$/.test(input.revision), 'ITEM_REVISION', '请重新打开商品');
      const editHash = hash(fields, ids, input.revision);
      if (item.lastEditRequestId === requestId) {
        check(item.lastEditHash === editHash, 'ITEM_REQUEST_CONFLICT', '编辑请求已处理，请重新打开商品');
        return ownerItem(item);
      }
      check(Object.hasOwn(NEXT, item.status), 'ITEM_STATE', '当前商品状态不能编辑');
      check(input.revision === revisionOf(item), 'ITEM_REVISION', '商品已在其他设备上更新，请重新打开');
      check(ids || array(item.images).length > 0, 'ITEM_IMAGES', '请为这件商品选择照片');
      const media = ids ? await attachPhotos(tx, ids, item._id, item.ownerOpenId) : {};
      const time = nextWriteTime(item, now);
      const changes = { ...fields, ...media, lastEditRequestId: requestId, lastEditHash: editHash, updatedAt: new Date(time), updatedAtMs: time };
      await tx.update(collections.items, item._id, changes);
      return ownerItem({ ...item, ...changes });
    },

    'items.transition': async (tx, principal, input) => {
      const target = input.status;
      check(['ACTIVE', 'SOLD', 'UNLISTED', 'DELETED'].includes(target), 'ITEM_STATE', '商品状态无效');
      const item = await owned(tx, principal, itemKey(input.itemId));
      return transition(tx, item, target.toLowerCase(), input.revision);
    },

    'items.markSold': async (tx, principal, input) => {
      const item = await owned(tx, principal, itemKey(input.itemId));
      const sold = await transition(tx, item, 'sold', input.revision);
      return { id: sold.id, status: sold.status };
    }
  };
}

module.exports = { createItemActions, ownerItem, favoriteItem, OPTIONS };
