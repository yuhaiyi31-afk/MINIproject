const { createHash } = require('node:crypto');

const LIVE_ENVIRONMENT = 'cloud1-d9glh048lb56b8a00';
const PAGE_LIMIT = 30;
const BATCH_SIZE = 40;
const MAX_BATCHES = 4;
const IMAGE_TTL_SECONDS = 300;
const DAY_MS = 86400000;
const CURSOR_TTL_MS = 30 * 60 * 1000;
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const REGIONS = new Set([
  'Auckland CBD', 'Central Auckland', 'North Shore', 'East Auckland',
  'West Auckland', 'South Auckland', '其他新西兰地区'
]);
const CATEGORIES = new Set([
  '交通工具', '电子产品', '生活家居', '学习用品', '运动户外',
  '服饰美妆', '宠物用品', '乐器', '游戏娱乐', '其他'
]);
const SERVICE_CATEGORIES = new Set(['接机', '搬家', '找工', '组局', '求助', '租房', '拼车', '代购']);
const CONDITIONS = new Set(['全新', '几乎全新', '轻微使用', '正常使用', '明显使用']);
const DELIVERIES = new Set(['当面交易', '买家自取', '邮寄', '双方协商']);
const TEXT_MARKERS = /@|https?:\/\/|www\.|(?:联系|微信|手机号|电话|邮箱|地址|门牌|contact|wechat|whatsapp|telegram|e-?mail|address)\s*[:：]|\d(?:[\s()+.-]*\d){7,}|(?:路|街|巷)\s*\d+\s*号|\b(?:apt|apartment|flat|room|unit)\s*#?\s*\d+\b|\b\d+(?:[/-]\d+)?\s+(?:[a-z.'’-]+\s+){1,5}(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|court|ct|place|pl|way|crescent|cres|boulevard)\b/i;

const FIELDS = Object.freeze({
  _id: true, title: true, description: true, category: true, condition: true,
  region: true, deliveryMethod: true, price: true, publishType: true, status: true,
  images: true, thumbnail: true, createdAtMs: true, updatedAtMs: true, ownerOpenId: true
});

class CatalogError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function previewConfig(env) {
  const environmentId = env.MARKET_CATALOG_PREVIEW_ENV || '';
  const runtime = env.TCB_ENV || env.SCF_NAMESPACE;
  if (!/^[a-z0-9-]{1,64}$/.test(environmentId) || environmentId === LIVE_ENVIRONMENT || runtime !== environmentId) return null;
  const bucket = env.MARKET_CATALOG_PREVIEW_BUCKET || '';
  if (bucket && !/^[a-z0-9-]{1,128}$/.test(bucket)) return null;
  return { environmentId, mediaRoot: bucket ? `${environmentId}.${bucket}` : '' };
}

function string(value, length) {
  return typeof value === 'string' ? value.trim().slice(0, length) : '';
}

function publicText(value, length) {
  const clean = typeof value === 'string' ? value.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim() : '';
  return TEXT_MARKERS.test(clean) ? '' : clean.slice(0, length);
}

function allowed(options, value, fallback = '') {
  return options.has(value) ? value : fallback;
}

function validNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function priceBound(value) {
  if (value === '' || value == null) return null;
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value))) {
    throw new CatalogError('INVALID_FILTER', '请输入有效价格');
  }
  const price = Number(value);
  if (!validNumber(price)) throw new CatalogError('INVALID_FILTER', '请输入有效价格');
  return price;
}

function filtersFor(input, publishType) {
  const category = string(input.category, 40);
  const region = string(input.region, 80);
  const categories = publishType === 'service' ? SERVICE_CATEGORIES : CATEGORIES;
  if ((category && !categories.has(category)) || (region && !REGIONS.has(region))) {
    throw new CatalogError('INVALID_FILTER', '请选择已有分类或区域');
  }
  const minPrice = priceBound(input.minPrice);
  const maxPrice = priceBound(input.maxPrice);
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
    throw new CatalogError('INVALID_FILTER', '最低价不能高于最高价');
  }
  const days = Number(input.days || 0);
  if (!Number.isSafeInteger(days) || days < 0 || days > 365) throw new CatalogError('INVALID_FILTER', '商品时间范围无效');
  const sort = ['PRICE_ASC', 'PRICE_DESC'].includes(input.sort) ? input.sort : 'LATEST';
  const keyword = string(input.keyword, 60);
  if (keyword && !publicText(keyword, 60)) throw new CatalogError('INVALID_FILTER', '请使用商品关键词搜索');
  const filters = { category, region, minPrice, maxPrice, days, sort, keyword: keyword.normalize('NFKC').toLowerCase() };
  return publishType === 'service' ? { ...filters, publishType } : filters;
}

function orderFor(sort) {
  const stable = [['createdAtMs', 'desc'], ['_id', 'asc']];
  if (sort === 'PRICE_ASC') return [['price', 'asc'], ...stable];
  if (sort === 'PRICE_DESC') return [['price', 'desc'], ...stable];
  return stable;
}

function filterSignature(filters) {
  return createHash('sha256').update(JSON.stringify(filters)).digest('hex').slice(0, 24);
}

function readCursor(value, filters, now) {
  if (!value) return { snapshot: now, after: null };
  try {
    if (typeof value !== 'string' || value.length > 400 || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error();
    const { signature, snapshot, after } = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (signature !== filterSignature(filters) || !Number.isSafeInteger(snapshot) || snapshot > now || now - snapshot > CURSOR_TTL_MS) throw new Error();
    if (!after || typeof after._id !== 'string' || !ID.test(after._id) || !Number.isSafeInteger(after.createdAtMs)
      || after.createdAtMs <= 0 || after.createdAtMs > snapshot || !validNumber(after.price)) throw new Error();
    return { snapshot, after: { _id: after._id, createdAtMs: after.createdAtMs, price: after.price } };
  } catch {
    throw new CatalogError('INVALID_CURSOR', '商品列表已更新，请刷新后重试');
  }
}

function continuation(filters, snapshot, row) {
  const after = { _id: row._id, createdAtMs: row.createdAtMs, price: row.price };
  return Buffer.from(JSON.stringify({ signature: filterSignature(filters), snapshot, after })).toString('base64url');
}

function createStore(db) {
  const command = db.command;
  const collection = () => db.collection('market_items');
  return {
    async unavailableAuthors(rows) {
      const ids = [...new Set(rows.map(row => row?.ownerOpenId).filter(value => typeof value === 'string' && value.length > 0))];
      const unavailable = new Set();
      for (let start = 0; start < ids.length; start += 20) {
        const result = await db.collection('user_profiles')
          .where({ _id: command.in(ids.slice(start, start + 20)), status: 'banned' }).field({ _id: true }).limit(20).get();
        if (!Array.isArray(result.data)) throw new CatalogError('CATALOG_UNAVAILABLE', '暂时无法核对发布者状态');
        result.data.forEach(row => unavailable.add(row._id));
      }
      return unavailable;
    },
    async list(filters, snapshot, after) {
      const bounds = [{ publishType: filters.publishType || 'market', status: 'active' }];
      bounds.push({ createdAtMs: command.gte(filters.days ? snapshot - filters.days * DAY_MS : 1).and(command.lte(snapshot)) });
      bounds.push({ price: command.gte(filters.minPrice ?? 0) });
      if (filters.maxPrice != null) bounds.push({ price: command.lte(filters.maxPrice) });
      if (filters.category) bounds.push({ category: filters.category });
      if (filters.region) bounds.push({ region: filters.region });

      const order = orderFor(filters.sort);
      if (after) {
        const branches = order.map(([field, direction], index) => Object.assign(
          Object.fromEntries(order.slice(0, index).map(([previous]) => [previous, after[previous]])),
          { [field]: direction === 'asc' ? command.gt(after[field]) : command.lt(after[field]) }
        ));
        bounds.push(command.or(...branches));
      }
      const query = order.reduce((cursor, [key, direction]) => cursor.orderBy(key, direction), collection().where(command.and(...bounds)));
      const result = await query.field(FIELDS).limit(BATCH_SIZE).get();
      return result.data;
    },
    async get(id, publishType = 'market') {
      const result = await collection().where({ _id: id, publishType }).field(FIELDS).limit(1).get();
      return result.data[0];
    }
  };
}

function mediaRef(value, mediaRoot) {
  if (!mediaRoot || typeof value !== 'string') return '';
  const prefix = `cloud://${mediaRoot}/`;
  const path = value.startsWith(prefix) ? value.slice(prefix.length) : '';
  return /^market\/(images|thumbnails)\/[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp)$/.test(path) ? value : '';
}

function listingFor(row, full, mediaRoot, publishType) {
  if (!row || row.publishType !== publishType || typeof row._id !== 'string' || !ID.test(row._id)) return null;
  const isService = publishType === 'service';
  const kind = isService ? { publishType } : {};
  if (row.status === 'sold' && full) return { dto: { id: row._id, ...kind, status: 'SOLD', currency: 'NZD', images: [], thumbnail: null }, images: [], thumbnail: '' };
  if (row.status !== 'active' || !validNumber(row.price) || !Number.isSafeInteger(row.createdAtMs) || row.createdAtMs <= 0) return null;
  const images = [...new Set((Array.isArray(row.images) ? row.images : []).slice(0, 9).map(ref => mediaRef(ref, mediaRoot)).filter(Boolean))];
  const thumbnail = mediaRef(row.thumbnail, mediaRoot) || images[0] || '';
  return {
    dto: {
      id: row._id,
      ...kind,
      title: publicText(row.title, 80) || (isService ? '服务' : '商品'),
      description: publicText(row.description, 1000),
      price: row.price,
      currency: 'NZD',
      category: allowed(isService ? SERVICE_CATEGORIES : CATEGORIES, row.category, '其他'),
      condition: allowed(CONDITIONS, row.condition),
      region: allowed(REGIONS, row.region),
      deliveryMethod: allowed(DELIVERIES, row.deliveryMethod),
      status: 'ACTIVE',
      createdAtMs: row.createdAtMs,
      updatedAtMs: validNumber(row.updatedAtMs) ? row.updatedAtMs : row.createdAtMs
    },
    images: full ? images : (thumbnail ? [thumbnail] : []),
    thumbnail
  };
}

async function addMedia(listings, signFiles, now) {
  const ids = [...new Set(listings.flatMap(item => [...item.images, item.thumbnail]).filter(Boolean))];
  const urls = new Map();
  try {
    for (let start = 0; start < ids.length; start += 50) {
      const fileList = ids.slice(start, start + 50).map(fileID => ({ fileID, maxAge: IMAGE_TTL_SECONDS }));
      const available = new Set(fileList.map(entry => entry.fileID));
      const result = await signFiles(fileList);
      for (const file of result.fileList ?? []) {
        if (available.has(file.fileID) && (file.status == null || file.status === 0) && /^https:\/\//i.test(file.tempFileURL ?? '')) {
          urls.set(file.fileID, file.tempFileURL);
        }
      }
    }
  } catch {
    // The catalogue remains readable if the private image service is unavailable.
  }
  return listings.map(({ dto, images, thumbnail }) => {
    const media = (ref, position) => urls.has(ref) ? {
      fileId: `${dto.id}:${position}`, url: urls.get(ref), expiresAtMs: now + IMAGE_TTL_SECONDS * 1000
    } : null;
    return { ...dto, images: images.map((ref, index) => media(ref, index)).filter(Boolean), thumbnail: media(thumbnail, 'cover') };
  });
}

function matches(listing, keyword) {
  if (!keyword) return true;
  const searchable = [listing.title, listing.description, listing.category, listing.region].join(' ').toLowerCase();
  return keyword.split(/\s+/).every(term => searchable.includes(term));
}

function requestBody(event) {
  if (typeof event?.body === 'string') {
    try { return JSON.parse(event.body); } catch { throw new CatalogError('INVALID_REQUEST', '商品查询格式无效'); }
  }
  return event?.body ?? event;
}

function createCatalogHandler({ store, mediaRoot = '', signFiles, clock = Date.now }) {
  return async function handle(event) {
    try {
      const input = requestBody(event);
      const now = clock();
      const publishType = ['services.get', 'services.browse'].includes(input?.action) ? 'service' : 'market';
      if (input?.action === 'items.get' || input?.action === 'services.get') {
        if (typeof input.itemId !== 'string' || !ID.test(input.itemId)) throw new CatalogError('ITEM_NOT_FOUND', '商品不存在');
        const row = await store.get(input.itemId, publishType);
        const unavailable = row?.status === 'active' ? await store.unavailableAuthors?.([row]) : null;
        const item = unavailable?.has(row.ownerOpenId) ? null : listingFor(row, true, mediaRoot, publishType);
        if (!item) throw new CatalogError('ITEM_NOT_FOUND', '商品不存在或已下架');
        const [data] = await addMedia([item], signFiles, now);
        if (input.includeEvidence === true && input.action === 'items.get' && data.status === 'ACTIVE') {
          // Signatures expire independently on each device. Compare the public description
          // and the ordered, allowlisted photo references before URL signing instead.
          data.evidence = {
            contentSha256: createHash('sha256').update(JSON.stringify([data.id, data.title, data.description, item.images])).digest('hex'),
            photoCount: item.images.length
          };
        }
        return { ok: true, data };
      }
      if (input?.action !== 'items.browse' && input?.action !== 'services.browse') throw new CatalogError('ACTION_NOT_ALLOWED', '目录只支持浏览和查询详情');
      const filters = filtersFor(input, publishType);
      const limit = Math.min(PAGE_LIMIT, Math.max(1, Math.floor(Number(input.limit) || 20)));
      const { snapshot, after } = readCursor(input.cursor, filters, now);
      const items = [];
      let position = after;
      let hasMore = true;
      for (let index = 0; index < MAX_BATCHES && items.length < limit; index++) {
        const rows = await store.list(filters, snapshot, position);
        const unavailable = await store.unavailableAuthors?.(rows);
        let consumed = 0;
        for (const row of rows) {
          position = row;
          consumed++;
          if (unavailable?.has(row.ownerOpenId)) continue;
          const listing = listingFor(row, false, mediaRoot, publishType);
          if (!listing) throw new CatalogError('CATALOG_INVALID_RECORD', '商品列表暂不可用');
          if (matches(listing.dto, filters.keyword)) {
            const description = publishType === 'service' ? listing.dto.description.slice(0, 160) : '';
            items.push({ ...listing, dto: { ...listing.dto, description } });
          }
          if (items.length === limit) break;
        }
        hasMore = consumed < rows.length || rows.length === BATCH_SIZE;
        if (!hasMore) break;
      }
      const page = { hasMore, nextCursor: hasMore ? continuation(filters, snapshot, position) : '', limit };
      return { ok: true, data: { items: await addMedia(items, signFiles, now), page } };
    } catch (error) {
      const safe = error instanceof CatalogError ? error : new CatalogError('CATALOG_UNAVAILABLE', '商品信息暂不可用，请稍后重试');
      return { ok: false, error: { code: safe.code, message: safe.message } };
    }
  };
}

module.exports = { createCatalogHandler, createStore, previewConfig };
