const PRODUCTION_ENV = 'cloud1-d9glh048lb56b8a00';
const FUNCTION_NAME = 'market-catalog-api';
const EVIDENCE_SCHEMA = 'market-catalog-evidence/v1';
const DEVICE_SCHEMA = 'market-catalog-evidence/v2';
const ITEM_ID = /^[a-zA-Z0-9_-]{1,100}$/;
const MAX_PRICE = 90071992547409;

function testEnvironment(value) {
  const environmentId = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-z0-9-]{1,64}$/.test(environmentId) || environmentId === PRODUCTION_ENV) {
    throw new Error('填写独立的 CloudBase 测试环境 ID');
  }
  return environmentId;
}

function evidenceFrom(environmentId, expectedId, item) {
  const env = testEnvironment(environmentId);
  if (typeof expectedId !== 'string' || !ITEM_ID.test(expectedId) || item?.id !== expectedId || item.currency !== 'NZD') {
    throw new Error('商品编号或币种与预期不符');
  }
  let priceCents = null;
  if (item.status === 'ACTIVE') {
    if (typeof item.price !== 'number' || !(item.price >= 0 && item.price <= MAX_PRICE)) {
      throw new Error('商品价格无效');
    }
    priceCents = Math.round(item.price * 100);
  } else if (item.status !== 'SOLD') {
    throw new Error('商品状态不在联调范围内');
  }
  return { schema: EVIDENCE_SCHEMA, platform: 'wechat', environmentId: env, itemId: expectedId, status: item.status, currency: 'NZD', priceCents };
}

function createWechatCatalog(cloud, value) {
  const environmentId = testEnvironment(value);
  if (!cloud || typeof cloud.init !== 'function' || typeof cloud.callFunction !== 'function') {
    throw new Error('当前微信小程序没有可用的云开发能力');
  }
  cloud.init({ env: environmentId, traceUser: false });

  async function invoke(data) {
    const { result } = await cloud.callFunction({ name: FUNCTION_NAME, config: { env: environmentId }, data });
    if (result?.ok !== true || result.data == null) {
      throw new Error(result?.error?.message || '商品目录暂不可用');
    }
    return result.data;
  }

  async function readItem(itemId, includeEvidence = false) {
    if (typeof itemId !== 'string' || !ITEM_ID.test(itemId)) throw new Error('填写有效的商品 ID');
    const data = { action: 'items.get', itemId };
    if (includeEvidence) data.includeEvidence = true;
    const item = await invoke(data);
    return { item, record: evidenceFrom(environmentId, itemId, item) };
  }
  return {
    async list() {
      const response = await invoke({ action: 'items.browse', sort: 'LATEST', limit: 20 });
      if (!Array.isArray(response.items)) throw new Error('商品列表回包格式异常');
      return response.items.map(item => {
        const record = evidenceFrom(environmentId, item.id, item);
        if (record.status !== 'ACTIVE') throw new Error('在售列表包含状态异常的商品');
        return { id: record.itemId, title: item.title, priceCents: record.priceCents };
      });
    },
    async get(itemId) {
      return (await readItem(itemId)).record;
    },
    async detail(itemId, includeEvidence = false) {
      return (await readItem(itemId, includeEvidence)).item;
    },
    async services(category, cursor = '') {
      const response = await invoke({ action: 'services.browse', category, cursor, limit: 20 });
      if (!Array.isArray(response.items) || !response.page) throw new Error('服务列表回包格式异常');
      return response;
    },
    async service(itemId) {
      if (typeof itemId !== 'string' || !ITEM_ID.test(itemId)) throw new Error('填写有效的服务 ID');
      return invoke({ action: 'services.get', itemId });
    }
  };
}

function deviceEvidence(environmentId, expectedId, item, loadedUrls) {
  const record = evidenceFrom(environmentId, expectedId, item);
  if (!Array.isArray(item.images) || (record.status === 'SOLD' && item.images.length !== 0)) throw new Error('商品图片状态异常');
  if (record.status === 'SOLD') return { ...record, schema: DEVICE_SCHEMA, contentSha256: null, photoCount: 0 };
  const digest = item.evidence?.contentSha256;
  const count = item.evidence?.photoCount;
  if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest) || !Number.isInteger(count) || count < 0 || count > 9) {
    throw new Error('测试目录尚未返回完整的商品验收信息');
  }
  const urls = item.images.map(photo => photo?.url);
  if (urls.length !== count || new Set(urls).size !== count || item.images.some((photo, index) =>
    photo?.fileId !== expectedId + ':' + index || typeof photo.url !== 'string' || !photo.url || !loadedUrls.includes(photo.url))) {
    throw new Error('请确认全部商品图片已加载后重试');
  }
  return { ...record, schema: DEVICE_SCHEMA, contentSha256: digest, photoCount: count };
}

module.exports = { createWechatCatalog, testEnvironment, deviceEvidence, EVIDENCE_SCHEMA, DEVICE_SCHEMA };
