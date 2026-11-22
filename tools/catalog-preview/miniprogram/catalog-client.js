const PRODUCTION_ENV = 'cloud1-d9glh048lb56b8a00';
const FUNCTION_NAME = 'market-catalog-api';
const EVIDENCE_SCHEMA = 'market-catalog-evidence/v1';
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
      if (typeof itemId !== 'string' || !ITEM_ID.test(itemId)) throw new Error('填写有效的商品 ID');
      return evidenceFrom(environmentId, itemId, await invoke({ action: 'items.get', itemId }));
    }
  };
}

module.exports = { createWechatCatalog, testEnvironment, EVIDENCE_SCHEMA };
