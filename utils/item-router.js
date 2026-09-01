const DETAIL_PREVIEW_KEY = 'detailItemPreview';

function getItemType(item) {
  return item && (item.publishType === 'service' || item.itemType === 'service')
    ? 'service'
    : 'product';
}

function getItemSource(item, fallbackSource) {
  return (item && item.source) || fallbackSource || 'unknown';
}

function getItemKey(item, fallbackSource) {
  if (!item) return '';
  if (item.itemKey) return String(item.itemKey);
  return `${getItemSource(item, fallbackSource)}:${getItemType(item)}:${item.id}`;
}

function normalizeItem(item, fallbackSource) {
  if (!item) return null;
  const source = getItemSource(item, fallbackSource);
  const itemType = getItemType(item);
  return {
    ...item,
    source,
    itemType,
    itemKey: item.itemKey || `${source}:${itemType}:${item.id}`
  };
}

function isSameItem(left, right) {
  if (!left || !right) return false;
  if (left.itemKey && right.itemKey) return String(left.itemKey) === String(right.itemKey);

  const sameId = String(left.id) === String(right.id);
  const sameType = getItemType(left) === getItemType(right);
  if (!sameId || !sameType) return false;

  if (left.source && right.source) return left.source === right.source;
  return !left.title || !right.title || left.title === right.title;
}

function cacheItem(item, fallbackSource) {
  const normalized = normalizeItem(item, fallbackSource);
  if (normalized) wx.setStorageSync(DETAIL_PREVIEW_KEY, normalized);
  return normalized;
}

function navigateToDetail(item, fallbackSource) {
  const normalized = cacheItem(item, fallbackSource);
  if (!normalized) {
    wx.showToast({ title: '内容不存在', icon: 'none' });
    return;
  }
  wx.navigateTo({
    url: `/pages/market/detail/index?id=${encodeURIComponent(normalized.id)}&itemType=${normalized.itemType}&source=${encodeURIComponent(normalized.source)}`
  });
}

function matches(item, id, itemType) {
  if (!item || String(item.id) !== String(id)) return false;
  return !itemType || getItemType(item) === itemType;
}

function findIn(items, id, itemType, source) {
  if (!Array.isArray(items)) return null;
  const found = items.find(item => matches(item, id, itemType));
  return found ? normalizeItem(found, source) : null;
}

function getPreview(id, itemType, source) {
  const preview = wx.getStorageSync(DETAIL_PREVIEW_KEY);
  if (!matches(preview, id, itemType)) return null;
  if (source && preview.source && preview.source !== source) return null;
  return normalizeItem(preview, source);
}

function resolveItem(id, itemType, source) {
  const preview = getPreview(id, itemType, source);
  if (preview) return preview;

  const app = getApp();
  const globalData = (app && app.globalData) || {};
  const sources = {
    cloud: [globalData._allItems, globalData._serviceItems, globalData._infoItems, globalData._recommendItems, globalData._searchItems],
    market: [globalData._allItems],
    home: [globalData._infoItems],
    recommend: [globalData._recommendItems],
    service: [globalData._serviceItems],
    search: [globalData._searchItems],
    rent: [globalData._serviceItems]
  };

  if (source && sources[source]) {
    for (const list of sources[source]) {
      const exact = findIn(list, id, itemType, source);
      if (exact) return exact;
    }
    // A source was supplied, so never fall through to an unrelated list with the same id.
    return null;
  }

  // Compatibility for old links that did not include a source.
  const fallbackLists = [
    [globalData._allItems, 'market'],
    [globalData._serviceItems, 'service'],
    [globalData._infoItems, 'home'],
    [globalData._recommendItems, 'recommend'],
    [globalData._searchItems, 'search'],
    [globalData._serviceItems, 'rent']
  ];
  for (const [list, fallbackSource] of fallbackLists) {
    const found = findIn(list, id, itemType, fallbackSource);
    if (found) return found;
  }
  return null;
}

module.exports = {
  getItemType,
  getItemKey,
  normalizeItem,
  isSameItem,
  cacheItem,
  navigateToDetail,
  resolveItem
};
