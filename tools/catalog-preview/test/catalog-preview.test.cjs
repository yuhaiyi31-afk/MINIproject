const assert = require('node:assert/strict');
const test = require('node:test');
const { createWechatCatalog, deviceEvidence, DEVICE_SCHEMA } = require('../miniprogram/catalog-client');
const { compareEvidence, compareSaleCycle } = require('../check-evidence.cjs');

const ENV = 'catalog-test-stage';
const ITEM = { id: 'catalog-fixture', title: '测试段落', status: 'ACTIVE', currency: 'NZD', price: 10.25 };

function records() {
  return ['wechat', 'android', 'ios'].map(platform => ({
    schema: 'market-catalog-evidence/v1', platform, environmentId: ENV, itemId: ITEM.id,
    status: ITEM.status, currency: ITEM.currency, priceCents: 1025
  }));
}

test('the WeChat preview rejects the live environment before calling the SDK', () => {
  const unexpected = () => assert.fail('SDK must stay untouched');
  assert.throws(() => createWechatCatalog({ init: unexpected, callFunction: unexpected }, 'cloud1-d9glh048lb56b8a00'), /独立/);
  assert.throws(() => createWechatCatalog({ init: unexpected, callFunction: unexpected }, ''), /独立/);
});

test('WeChat scopes both browse and detail calls to the same function and environment', async () => {
  const actions = [];
  const client = createWechatCatalog({
    init: options => assert.deepEqual(options, { env: ENV, traceUser: false }),
    callFunction: async request => {
      assert.equal(request.name, 'market-catalog-api');
      assert.deepEqual(request.config, { env: ENV });
      actions.push(request.data.action);
      if (request.data.action === 'items.browse') return { result: { ok: true, data: { items: [ITEM] } } };
      assert.equal(request.data.itemId, ITEM.id);
      return { result: { ok: true, data: { ...ITEM, ownerOpenId: 'private-fixture', images: ['not-for-evidence'] } } };
    }
  }, ENV);
  assert.deepEqual(await client.list(), [{ id: ITEM.id, title: ITEM.title, priceCents: 1025 }]);
  assert.deepEqual(await client.get(ITEM.id), records()[0]);
  assert.deepEqual(actions, ['items.browse', 'items.get']);
});

test('wrong listing ID, wrong currency, and backend failure cannot produce evidence', async () => {
  for (const response of [
    { ok: true, data: { ...ITEM, id: 'different-id' } },
    { ok: true, data: { ...ITEM, currency: 'USD' } },
    { ok: false, error: { message: '目录没有部署' } }
  ]) {
    const client = createWechatCatalog({ init() {}, callFunction: async () => ({ result: response }) }, ENV);
    await assert.rejects(client.get(ITEM.id), /编号或币种|没有部署/);
  }
});

test('the comparer accepts the same staging item on three distinct platforms, including a sold marker', () => {
  assert.deepEqual(compareEvidence(records()), {
    platforms: ['wechat', 'android', 'ios'], environmentId: ENV, itemId: ITEM.id, status: 'ACTIVE', currency: 'NZD', priceCents: 1025
  });
  const sold = records().map(row => ({ ...row, status: 'SOLD', priceCents: null }));
  assert.equal(compareEvidence(sold).status, 'SOLD');
});

test('environment, ID, price and sale-state discrepancies are reported', () => {
  for (const [key, value] of Object.entries({ environmentId: 'another-stage', itemId: 'other', priceCents: 1026 })) {
    const rows = records();
    rows[1][key] = value;
    assert.throws(() => compareEvidence(rows), new RegExp(key));
  }
  const rows = records();
  rows[2] = { ...rows[2], status: 'SOLD', priceCents: null };
  assert.throws(() => compareEvidence(rows), /status/);
});

test('non-native, duplicated, live or extra-field evidence is refused', () => {
  const baseline = records();
  assert.throws(() => compareEvidence([baseline[0], baseline[0], baseline[2]]), /重复/);
  assert.throws(() => compareEvidence([baseline[0], { ...baseline[1], platform: 'web' }, baseline[2]]), /格式无效/);
  assert.throws(() => compareEvidence([{ ...baseline[0], environmentId: 'cloud1-d9glh048lb56b8a00' }, ...baseline.slice(1)]), /独立/);
  assert.throws(() => compareEvidence([{ ...baseline[0], profile: 'unexpected' }, ...baseline.slice(1)]), /格式无效/);
});

test('a full receipt requires every distinct photo from this response to finish loading in the advertised order', () => {
  const urls = ['https://media.example.test/front', 'https://media.example.test/back'];
  const images = urls.map((url, index) => ({ fileId: ITEM.id + ':' + index, url }));
  const item = { ...ITEM, images, evidence: { contentSha256: 'a'.repeat(64), photoCount: 2 } };
  const record = deviceEvidence(ENV, ITEM.id, item, urls);
  assert.deepEqual(record, { ...records()[0], schema: DEVICE_SCHEMA, ...item.evidence });
  assert.throws(() => deviceEvidence(ENV, ITEM.id, item, [urls[0], 'https://media.example.test/stale']), /图片/);
  for (const invalid of [images.slice(0, 1), [...images].reverse(), [images[0], { ...images[1], url: urls[0] }]]) {
    assert.throws(() => deviceEvidence(ENV, ITEM.id, { ...item, images: invalid }, urls), /图片/);
  }
});

test('a full sale comparison requires six current receipts for the same item and catches changed content', () => {
  const active = records().map(row => ({ ...row, schema: DEVICE_SCHEMA, contentSha256: 'b'.repeat(64), photoCount: 2 }));
  const sold = active.map(row => ({ ...row, status: 'SOLD', priceCents: null, contentSha256: null, photoCount: 0 }));
  assert.equal(compareSaleCycle(active, sold).sold.itemId, ITEM.id);
  assert.throws(() => compareSaleCycle(records(), sold), /新版/);
  assert.throws(() => compareSaleCycle(active, sold.map(row => ({ ...row, itemId: 'different' }))), /同一/);
  assert.throws(() => compareSaleCycle(active.map(row => ({ ...row, photoCount: 1 })), sold), /照片/);
  assert.throws(() => compareEvidence([active[0], { ...active[1], contentSha256: 'c'.repeat(64) }, active[2]]), /contentSha256/);
  assert.throws(() => compareEvidence([active[0], records()[1], active[2]]), /格式/);
});
