const FUNCTION_NAME = 'market-api';
const priceFormat = require('./price-format');
const CACHE_PREFIX = 'marketCloudCacheV1:';
const DEFAULT_CACHE_MAX_AGE = 30 * 60 * 1000;
const DETAIL_CACHE_MAX_AGE = 2 * 60 * 1000;
const FAVORITE_CACHE_MAX_AGE = 5 * 60 * 1000;
const FULL_IMAGE_MAX_SIDE = 1600;
const THUMBNAIL_MAX_SIDE = 640;
const memoryCache = Object.create(null);
const inflightCalls = Object.create(null);
const pendingSaves = Object.create(null);

function cacheKey(type, parts) {
  return `${CACHE_PREFIX}${type}:${(parts || []).map(value => encodeURIComponent(String(value || ''))).join(':')}`;
}

function readCache(key, maxAge) {
  let cached = memoryCache[key];
  if (!cached) {
    try { cached = wx.getStorageSync(key); } catch (error) { cached = null; }
    if (cached && cached.savedAt) memoryCache[key] = cached;
  }
  if (!cached || !cached.savedAt || Date.now() - cached.savedAt > (maxAge || DEFAULT_CACHE_MAX_AGE)) return null;
  return Object.prototype.hasOwnProperty.call(cached, 'value') ? cached.value : null;
}

function writeCache(key, value) {
  const cached = { savedAt: Date.now(), value };
  memoryCache[key] = cached;
  try { wx.setStorageSync(key, cached); } catch (error) { /* 内存缓存仍然可用 */ }
}

function clearListCaches() {
  Object.keys(memoryCache).forEach(key => {
    if (key.includes(`${CACHE_PREFIX}list:`) || key.includes(`${CACHE_PREFIX}browse:`) || key.includes(`${CACHE_PREFIX}services:`)) delete memoryCache[key];
  });
  try {
    const keys = (wx.getStorageInfoSync().keys || []).filter(key => (
      key.includes(`${CACHE_PREFIX}list:`) || key.includes(`${CACHE_PREFIX}browse:`) || key.includes(`${CACHE_PREFIX}services:`)
    ));
    keys.forEach(key => wx.removeStorageSync(key));
  } catch (error) { /* 忽略缓存清理失败 */ }
}

function clearCache(key) {
  delete memoryCache[key];
  try { wx.removeStorageSync(key); } catch (error) { /* 忽略缓存清理失败 */ }
}

function clearItemCache(id) {
  if (!id) return;
  clearCache(cacheKey('detail', [id]));
}

async function coalesce(key, loader) {
  if (!inflightCalls[key]) inflightCalls[key] = Promise.resolve().then(loader);
  try {
    return await inflightCalls[key];
  } finally {
    delete inflightCalls[key];
  }
}

function ensureCloud() {
  if (!wx.cloud || !wx.cloud.callFunction || !wx.cloud.uploadFile) {
    throw new Error('当前小程序尚未开通云开发');
  }
}

async function call(action, data) {
  ensureCloud();
  const response = await wx.cloud.callFunction({
    name: FUNCTION_NAME,
    data: { action, ...(data || {}) }
  });
  const result = response && response.result;
  if (!result || result.ok !== true) throw new Error((result && result.message) || '云服务返回异常');
  return result;
}

function formatTime(timestamp) {
  const value = Number(timestamp) || Date.now();
  const diff = Math.max(0, Date.now() - value);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)}分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)}小时前`;
  if (diff < day * 7) return `${Math.floor(diff / day)}天前`;
  const date = new Date(value);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function normalizeItem(item) {
  if (!item) return null;
  const id = item._id || item.id;
  const itemType = item.publishType === 'service' ? 'service' : 'product';
  const serviceStyles = {
    '接机': { icon: '✈️', bgColor: '#E8F4FD' },
    '搬家': { icon: '🚚', bgColor: '#FFF3E8' },
    '找工': { icon: '💼', bgColor: '#E8F8E8' },
    '组局': { icon: '🎉', bgColor: '#FDF3E8' },
    '求助': { icon: '🙋', bgColor: '#FDE8E8' },
    '租房': { icon: '🏠', bgColor: '#E8E8FD' },
    '拼车': { icon: '🚗', bgColor: '#E0F7FA' },
    '代购': { icon: '🛍️', bgColor: '#FCECEF' }
  };
  const serviceStyle = serviceStyles[item.category] || { icon: '📌', bgColor: '#F3F5F7' };
  return {
    ...item,
    priceText: priceFormat.formatPriceAmount(item.price),
    id,
    _id: id,
    source: 'cloud',
    itemType,
    itemKey: `cloud:${itemType}:${id}`,
    nickname: item.publisherNick || '用户',
    avatar: item.publisherAvatar || '',
    desc: item.description || '',
    tag: item.category || '',
    isPromise: !!item.promiseReal,
    icon: item.icon || serviceStyle.icon,
    bgColor: item.bgColor || serviceStyle.bgColor,
    time: formatTime(item.createdAtMs || item.updatedAtMs)
  };
}

function getExtension(path, fallback) {
  const cleanPath = String(path || '').split('?')[0];
  const match = cleanPath.match(/\.[a-zA-Z0-9]{2,5}$/);
  return match ? match[0].toLowerCase() : fallback;
}

function isTemporaryPath(path) {
  return /^https?:\/\/tmp\//i.test(String(path || '')) || /^wxfile:\/\//i.test(String(path || ''));
}

function isUploaded(path) {
  const value = String(path || '');
  return !isTemporaryPath(value) && (/^cloud:\/\//i.test(value) || /^https?:\/\//i.test(value));
}

function safeUploadKey(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 80) || `media_${Date.now()}`;
}

async function uploadOne(path, folder, fallbackExtension, fileKey) {
  if (!path || isUploaded(path)) return path || '';
  ensureCloud();
  const fileName = fileKey
    ? safeUploadKey(fileKey)
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const cloudPath = `${folder}/${fileName}${getExtension(path, fallbackExtension)}`;
  const result = await wx.cloud.uploadFile({ cloudPath, filePath: path });
  if (!result || !result.fileID) throw new Error('媒体文件上传失败');
  return result.fileID;
}

async function deleteUploadedFiles(fileIds) {
  if (!wx.cloud || !wx.cloud.deleteFile) return;
  const values = Array.from(new Set((fileIds || []).filter(value => /^cloud:\/\//i.test(String(value || '')))));
  for (let index = 0; index < values.length; index += 50) {
    try { await wx.cloud.deleteFile({ fileList: values.slice(index, index + 50) }); } catch (error) { /* 云端仍会继续清理已保存商品的旧媒体 */ }
  }
}

async function uploadTracked(path, folder, fallbackExtension, uploadedFiles, fileKey) {
  const alreadyUploaded = isUploaded(path);
  const fileId = await uploadOne(path, folder, fallbackExtension, fileKey);
  if (!alreadyUploaded && /^cloud:\/\//i.test(String(fileId || ''))) uploadedFiles.push(fileId);
  return fileId;
}

async function compressImage(path, maxSide, quality) {
  if (!path || isUploaded(path) || !wx.compressImage) return path;
  const options = { src: path, quality: quality || 72 };
  if (wx.getImageInfo && maxSide) {
    try {
      const info = await wx.getImageInfo({ src: path });
      const width = Number(info && info.width) || 0;
      const height = Number(info && info.height) || 0;
      const longestSide = Math.max(width, height);
      if (longestSide > maxSide) {
        const scale = maxSide / longestSide;
        options.compressedWidth = Math.max(1, Math.round(width * scale));
        options.compressedHeight = Math.max(1, Math.round(height * scale));
      }
    } catch (error) { /* 无法读取尺寸时仍进行质量压缩 */ }
  }
  try {
    const result = await wx.compressImage(options);
    return result && result.tempFilePath ? result.tempFilePath : path;
  } catch (error) {
    if (!options.compressedWidth && !options.compressedHeight) return path;
    try {
      const fallback = await wx.compressImage({ src: path, quality: quality || 72 });
      return fallback && fallback.tempFilePath ? fallback.tempFilePath : path;
    } catch (fallbackError) {
      return path;
    }
  }
}

async function uploadImages(images, uploadedFiles, uploadKey) {
  const source = (images || []).slice(0, 9);
  const result = [];
  for (let index = 0; index < source.length; index += 3) {
    const tasks = source.slice(index, index + 3).map(async (path, batchIndex) => (
      uploadTracked(
        await compressImage(path, FULL_IMAGE_MAX_SIDE, 72),
        'market/images',
        '.jpg',
        uploadedFiles,
        `${uploadKey}-image-${index + batchIndex}`
      )
    ));
    const settled = await Promise.all(tasks.map(task => task.then(
      value => ({ value }),
      error => ({ error })
    )));
    const failed = settled.find(entry => entry.error);
    if (failed) throw failed.error;
    result.push(...settled.map(entry => entry.value));
  }
  return result;
}

async function uploadThumbnail(path, uploadedFiles, uploadKey) {
  if (!path) return '';
  let sourcePath = path;
  if (isUploaded(path)) {
    try {
      if (/^cloud:\/\//i.test(path) && wx.cloud.downloadFile) {
        const downloaded = await wx.cloud.downloadFile({ fileID: path });
        sourcePath = downloaded.tempFilePath || path;
      } else if (/^https?:\/\//i.test(path) && wx.downloadFile) {
        const downloaded = await wx.downloadFile({ url: path });
        sourcePath = downloaded.tempFilePath || path;
      }
    } catch (error) {
      return path;
    }
  }
  if (isUploaded(sourcePath)) return path;
  const thumbnail = await compressImage(sourcePath, THUMBNAIL_MAX_SIDE, 68);
  return uploadTracked(thumbnail, 'market/thumbnails', '.jpg', uploadedFiles, `${uploadKey}-thumbnail`);
}

async function saveItem(item, editId) {
  const sourceImages = (item.images || []).slice(0, 9);
  const clientRequestId = String(
    item.clientRequestId || (item.id ? `legacy_${item.id}` : `publish_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`)
  ).slice(0, 100);
  const uploadKey = safeUploadKey(clientRequestId);
  const pendingKey = `${editId ? `update_${editId}` : 'publish'}:${clientRequestId}`;
  if (pendingSaves[pendingKey]) {
    const pendingResult = await call(editId ? 'update' : 'publish', editId
      ? { id: editId, item: pendingSaves[pendingKey] }
      : { item: pendingSaves[pendingKey] });
    delete pendingSaves[pendingKey];
    clearListCaches();
    clearItemCache(editId || pendingResult.id);
    try { wx.removeStorageSync('mineStatsCacheV1'); } catch (error) { /* 忽略缓存清理失败 */ }
    return pendingResult.id;
  }
  const uploadedFiles = [];
  let uploadsComplete = false;
  try {
    const images = await uploadImages(sourceImages, uploadedFiles, uploadKey);
    const canReuseThumbnail = item.thumbnail
      && isUploaded(item.thumbnail)
      && String(sourceImages[0] || '') === String(item.thumbnailSource || '');
    const thumbnail = canReuseThumbnail
      ? item.thumbnail
      : await uploadThumbnail(sourceImages[0], uploadedFiles, uploadKey) || images[0] || '';
    const videoPath = item.videoPath
      ? await uploadTracked(item.videoPath, 'market/videos', '.mp4', uploadedFiles, `${uploadKey}-video`)
      : '';
    uploadsComplete = true;
    const payload = {
      ...item,
      images,
      thumbnail,
      thumbnailSource: images[0] || '',
      videoPath,
      clientRequestId
    };
    delete payload.publisherNick;
    delete payload.publisherAvatar;
    pendingSaves[pendingKey] = payload;
    const result = await call(editId ? 'update' : 'publish', editId ? { id: editId, item: payload } : { item: payload });
    delete pendingSaves[pendingKey];
    clearListCaches();
    clearItemCache(editId || result.id);
    try { wx.removeStorageSync('mineStatsCacheV1'); } catch (error) { /* 忽略缓存清理失败 */ }
    return result.id;
  } catch (error) {
    // 只清理尚未提交给云函数的上传；提交后的网络错误可能实际已保存，不能贸然删除。
    if (!uploadsComplete) await deleteUploadedFiles(uploadedFiles);
    throw error;
  }
}

async function dedupeMine() {
  const result = await call('dedupeMine');
  return Number(result.removed) || 0;
}

async function listItems(skip, limit) {
  const offset = skip || 0;
  const pageSize = limit || 20;
  const key = cacheKey('list', [offset, pageSize]);
  return coalesce(key, async () => {
    const result = await call('list', { skip: offset, limit: pageSize });
    const page = {
      items: (result.items || []).map(normalizeItem).filter(Boolean),
      hasMore: !!result.hasMore,
      nextSkip: Number(result.nextSkip) || 0
    };
    writeCache(key, page);
    return page;
  });
}

function browseCacheKey(filters, skip, limit) {
  const input = filters || {};
  return cacheKey('browse', [
    input.keyword || '', input.category || '', input.region || '',
    input.minPrice === undefined ? '' : input.minPrice,
    input.maxPrice === undefined ? '' : input.maxPrice,
    input.days || 0, input.sort || 'latest', skip || 0, limit || 20
  ]);
}

async function browseItems(filters, skip, limit) {
  const input = filters || {};
  const offset = Number(skip) || 0;
  const pageSize = Number(limit) || 20;
  const key = browseCacheKey(input, offset, pageSize);
  return coalesce(key, async () => {
    const result = await call('browse', { ...input, skip: offset, limit: pageSize });
    const page = {
      items: (result.items || []).map(normalizeItem).filter(Boolean),
      hasMore: !!result.hasMore,
      nextSkip: Number(result.nextSkip) || 0
    };
    writeCache(key, page);
    return page;
  });
}

function getCachedBrowse(filters, skip, limit, maxAge) {
  return readCache(browseCacheKey(filters, skip || 0, limit || 20), maxAge);
}

function getCachedItems(skip, limit, maxAge) {
  return readCache(cacheKey('list', [skip || 0, limit || 20]), maxAge);
}

async function listServices(category, skip, limit) {
  const categoryValue = category || '';
  const offset = skip || 0;
  const pageSize = limit || 20;
  const key = cacheKey('services', [categoryValue, offset, pageSize]);
  return coalesce(key, async () => {
    const result = await call('listServices', { category: categoryValue, skip: offset, limit: pageSize });
    const page = {
      items: (result.items || []).map(normalizeItem).filter(Boolean),
      hasMore: !!result.hasMore,
      nextSkip: Number(result.nextSkip) || 0
    };
    writeCache(key, page);
    return page;
  });
}

function getCachedServices(category, skip, limit, maxAge) {
  return readCache(cacheKey('services', [category || '', skip || 0, limit || 20]), maxAge);
}

async function searchItems(terms, skip, limit) {
  const result = await call('search', {
    terms: Array.isArray(terms) ? terms : [terms],
    skip: skip || 0,
    limit: limit || 20
  });
  return {
    items: (result.items || []).map(normalizeItem).filter(Boolean),
    hasMore: !!result.hasMore,
    nextSkip: Number(result.nextSkip) || 0
  };
}

async function listMine() {
  const result = await call('mine');
  return (result.items || []).map(normalizeItem).filter(Boolean);
}

async function listFavorites() {
  const result = await call('favorites');
  return (result.items || []).map(normalizeItem).filter(Boolean);
}

async function isFavorited(id) {
  const key = cacheKey('favorite', [id]);
  const cached = readCache(key, FAVORITE_CACHE_MAX_AGE);
  if (cached !== null) return !!cached;
  const result = await call('isFavorite', { id });
  const favorited = !!result.favorited;
  writeCache(key, favorited);
  return favorited;
}

async function toggleFavorite(id, favorited) {
  const result = await call('toggleFavorite', { id, favorited: !!favorited });
  writeCache(cacheKey('favorite', [id]), !!result.favorited);
  try { wx.removeStorageSync('mineStatsCacheV1'); } catch (error) { /* 忽略缓存清理失败 */ }
  return !!result.favorited;
}

async function repairMineTemporaryMedia() {
  const result = await call('mineMedia');
  const items = (result.items || []).map(normalizeItem).filter(Boolean);
  const temporaryItems = items.filter(item => (
    (item.images || []).some(isTemporaryPath) || isTemporaryPath(item.videoPath)
  ));
  let repaired = 0;
  let failed = 0;
  for (const item of temporaryItems) {
    try {
      await saveItem(item, item.id);
      repaired += 1;
    } catch (error) {
      failed += 1;
    }
  }
  return { repaired, failed };
}

async function getItem(id, options) {
  const input = options && typeof options === 'object' ? options : {};
  const forceRefresh = input.forceRefresh === true;
  const key = cacheKey('detail', [id]);
  if (!forceRefresh) {
    const cached = readCache(key, DETAIL_CACHE_MAX_AGE);
    if (cached) return cached;
  }
  const result = await call('get', { id });
  const item = normalizeItem(result.item);
  if (item) writeCache(key, item);
  return item;
}

async function getOwnedItem(id) {
  const result = await call('getOwned', { id });
  const item = normalizeItem(result.item);
  if (item) writeCache(cacheKey('detail', [id]), item);
  return item;
}

async function unlistItem(id) {
  const result = await call('unlist', { id });
  clearItemCache(id);
  clearListCaches();
  return result;
}

async function setItemStatus(id, status) {
  const result = await call('setStatus', { id, status });
  clearItemCache(id);
  clearListCaches();
  try { wx.removeStorageSync('mineStatsCacheV1'); } catch (error) { /* 忽略缓存清理失败 */ }
  return result.status;
}

async function removeItem(id) {
  const result = await call('remove', { id });
  clearItemCache(id);
  clearListCaches();
  try { wx.removeStorageSync('mineStatsCacheV1'); } catch (error) { /* 忽略缓存清理失败 */ }
  return result;
}

function getErrorMessage(error) {
  const message = error && (error.errMsg || error.message) ? (error.errMsg || error.message) : '';
  if (message.includes('FunctionName') || message.includes('function')) return '云函数 market-api 尚未部署';
  if (message.includes('collection') || message.includes('-502005')) return '云数据库尚未创建 market_items 集合';
  return message || '云服务暂时不可用';
}

module.exports = {
  normalizeItem,
  saveItem,
  listItems,
  getCachedItems,
  browseItems,
  getCachedBrowse,
  listServices,
  getCachedServices,
  searchItems,
  listMine,
  listFavorites,
  isFavorited,
  toggleFavorite,
  repairMineTemporaryMedia,
  dedupeMine,
  getItem,
  getOwnedItem,
  unlistItem,
  setItemStatus,
  removeItem,
  getErrorMessage
};
