const assert = require('node:assert/strict');
const test = require('node:test');
const { createCatalogHandler, createStore, previewConfig } = require('../catalog');
const { CATEGORIES, CONDITIONS, REGIONS, DELIVERY_METHODS } = require('../../../utils/market-options');

const NOW = 1795320000000;
const ROOT = 'catalog-testing.fixture-bucket';
const PRODUCT_IMAGE = `cloud://${ROOT}/market/images/listing-1.jpg`;
const THUMBNAIL = `cloud://${ROOT}/market/thumbnails/listing-1.jpg`;
const PRIVATE_IMAGE = `cloud://${ROOT}/profiles/private.jpg`;
const WRONG_ENV_IMAGE = 'cloud://other.fixture-bucket/market/images/other.jpg';

function product(id, overrides = {}) {
  return {
    _id: id, publishType: 'market', status: 'active', title: '二手显示器',
    description: '27 英寸，含支架', price: 500, category: '电子产品',
    region: 'Auckland CBD', condition: '正常使用', deliveryMethod: '买家自取',
    createdAtMs: NOW - 1000, updatedAtMs: NOW - 1000, images: [PRODUCT_IMAGE],
    ...overrides
  };
}

// The catalogue is tested through its real CloudBase query adapter. The local
// database fixture implements the limited document query operations it uses.
function fixtureDatabase(documents) {
  const compare = predicate => ({ predicate, and: other => compare(value => predicate(value) && other.predicate(value)) });
  const command = {
    gte: expected => compare(value => value >= expected),
    gt: expected => compare(value => value > expected),
    lte: expected => compare(value => value <= expected),
    lt: expected => compare(value => value < expected),
    and: (...children) => row => children.every(expression => matches(row, expression)),
    or: (...children) => row => children.some(expression => matches(row, expression))
  };
  const matches = (row, expression) => typeof expression === 'function' ? expression(row) : (
    Object.entries(expression).every(([field, expected]) => expected?.predicate ? expected.predicate(row[field]) : row[field] === expected)
  );
  return {
    command,
    collection(name) {
      assert.equal(name, 'market_items');
      return {
        where(expression) {
          const orders = [];
          let fields = {};
          let count = 0;
          return {
            orderBy(field, direction) { orders.push([field, direction]); return this; },
            field(projection) { fields = projection; return this; },
            limit(limit) { count = limit; return this; },
            async get() {
              const sorted = documents.filter(row => matches(row, expression)).sort((a, b) => {
                for (const [field, direction] of orders) {
                  if (a[field] === b[field]) continue;
                  const comparison = a[field] < b[field] ? -1 : 1;
                  return direction === 'asc' ? comparison : -comparison;
                }
                return 0;
              });
              return { data: sorted.slice(0, count).map(row => Object.fromEntries(Object.entries(row).filter(([key]) => fields[key] === true))) };
            }
          };
        }
      };
    }
  };
}

function fixture(documents) {
  const signed = [];
  const handler = createCatalogHandler({
    store: createStore(fixtureDatabase(documents)),
    mediaRoot: ROOT,
    clock: () => NOW,
    signFiles: async (batch) => {
      signed.push(...batch);
      return { fileList: batch.map(({ fileID }) => ({ fileID, status: 0, tempFileURL: 'https://media.example.test/temporary' })) };
    }
  });
  return { handler, signed };
}

test('a misconfigured or live runtime cannot open the preview', () => {
  assert.equal(previewConfig({}), null);
  assert.equal(previewConfig({ MARKET_CATALOG_PREVIEW_ENV: 'catalog-testing', TCB_ENV: 'different' }), null);
  const live = 'cloud1-d9glh048lb56b8a00';
  assert.equal(previewConfig({ MARKET_CATALOG_PREVIEW_ENV: live, TCB_ENV: live }), null);
  assert.deepEqual(previewConfig({ MARKET_CATALOG_PREVIEW_ENV: 'catalog-testing', SCF_NAMESPACE: 'catalog-testing', MARKET_CATALOG_PREVIEW_BUCKET: 'fixture-bucket' }), {
    environmentId: 'catalog-testing', mediaRoot: ROOT
  });
});

test('browse and detail share the canonical product id, currency and price', async () => {
  const { handler } = fixture([product('listing-1'), product('service', { publishType: 'service' }), product('deleted', { status: 'deleted' })]);
  const browse = await handler({ action: 'items.browse' });
  const detail = await handler({ body: JSON.stringify({ action: 'items.get', itemId: 'listing-1' }) });
  assert.equal(browse.ok, true);
  assert.deepEqual(browse.data.items.map(item => item.id), ['listing-1']);
  assert.equal(detail.ok, true);
  assert.equal(detail.data.id, browse.data.items[0].id);
  assert.equal(detail.data.price, browse.data.items[0].price);
  assert.equal(detail.data.currency, 'NZD');
  assert.equal(detail.data.description, '27 英寸,含支架');
  for (const itemId of ['deleted', 'service']) {
    assert.equal((await handler({ action: 'items.get', itemId })).error.code, 'ITEM_NOT_FOUND');
  }
});

test('a sale removes the record from the feed and returns only a status marker by its original id', async () => {
  const item = product('listing-1');
  const { handler, signed } = fixture([item]);
  const first = await handler({ action: 'items.browse' });
  assert.equal(first.data.items.length, 1);
  item.status = 'sold';
  const sales = await handler({ action: 'items.browse' });
  assert.deepEqual(sales.data.items, []);
  signed.length = 0;
  const details = await handler({ action: 'items.get', itemId: 'listing-1' });
  assert.deepEqual(details.data, { id: 'listing-1', status: 'SOLD', currency: 'NZD', images: [], thumbnail: null });
  assert.deepEqual(signed, []);
});

test('projection excludes account data and only signs this environment’s product images', async () => {
  const { handler, signed } = fixture([product('listing-1', {
    title: '联系 buyer＠example.test', description: 'Pickup at 23 Queen Street',
    region: '23 Queen Street', contact: 'contact-private', ownerOpenId: 'private-owner',
    publisherAvatar: PRIVATE_IMAGE, thumbnail: THUMBNAIL,
    images: [PRODUCT_IMAGE, PRIVATE_IMAGE, WRONG_ENV_IMAGE, 'https://untrusted.example.test/img', `cloud://${ROOT}/market/images/../private.jpg`]
  })]);
  const result = await handler({ action: 'items.get', itemId: 'listing-1' });
  assert.equal(result.ok, true);
  assert.equal(result.data.title, '商品');
  assert.equal(result.data.description, '');
  assert.equal(result.data.region, '');
  assert.deepEqual(signed, [PRODUCT_IMAGE, THUMBNAIL].map(fileID => ({ fileID, maxAge: 300 })));
  assert.equal(result.data.images.length, 1);
  assert.equal(result.data.images[0].fileId, 'listing-1:0');
  assert.doesNotMatch(JSON.stringify(result), /contact-private|private-owner|Queen Street|fixture-bucket|publisherAvatar|ownerOpenId/);
});

test('pagination uses stable ids at equal timestamps and survives a sale between pages', async () => {
  const documents = [product('a'), product('b'), product('c'), product('last', { price: 700 })];
  const { handler } = fixture(documents);
  const first = await handler({ action: 'items.browse', sort: 'PRICE_ASC', limit: 1 });
  assert.deepEqual(first.data.items.map(item => item.id), ['a']);
  documents[0].status = 'sold';
  const second = await handler({ action: 'items.browse', sort: 'PRICE_ASC', limit: 2, cursor: first.data.page.nextCursor });
  assert.deepEqual(second.data.items.map(item => item.id), ['b', 'c']);
  const third = await handler({ action: 'items.browse', sort: 'PRICE_ASC', limit: 2, cursor: second.data.page.nextCursor });
  assert.deepEqual(third.data.items.map(item => item.id), ['last']);
  assert.equal(third.data.page.hasMore, false);
  const stale = await handler({ action: 'items.browse', sort: 'PRICE_DESC', cursor: first.data.page.nextCursor });
  assert.equal(stale.error.code, 'INVALID_CURSOR');
});

test('browse combines keyword, category, area, price and time against the public projection', async () => {
  const { handler } = fixture([
    product('match'), product('different-title', { title: '路由器' }), product('different-region', { region: 'North Shore' }),
    product('expensive', { price: 900 }), product('old', { createdAtMs: NOW - 2 * 86400000 })
  ]);
  const inputs = { action: 'items.browse', keyword: '显示器', region: 'Auckland CBD', category: '电子产品', minPrice: '100', maxPrice: '500', days: 1 };
  const data = await handler(inputs);
  assert.deepEqual(data.data.items.map(item => item.id), ['match']);
  assert.equal((await handler({ ...inputs, minPrice: ['100'] })).error.code, 'INVALID_FILTER');
});

test('catalog vocabulary accepts the Mini Program’s catalog options', async () => {
  const { handler } = fixture(CATEGORIES.map((category, index) => product(`product-${index}`, {
    category, condition: CONDITIONS[index % CONDITIONS.length], region: REGIONS[index % REGIONS.length],
    deliveryMethod: DELIVERY_METHODS[index % DELIVERY_METHODS.length]
  })));
  const { data } = await handler({ action: 'items.browse' });
  assert.deepEqual(data.items.map(item => item.category), CATEGORIES);
  assert.ok(data.items.every(item => CONDITIONS.includes(item.condition) && REGIONS.includes(item.region) && DELIVERY_METHODS.includes(item.deliveryMethod)));
});

test('unsupported actions and backend faults cannot expose data or write', async () => {
  const store = { list: () => { throw new Error('private database error'); } };
  const handle = createCatalogHandler({ store, clock: () => NOW });
  for (const action of ['items.publish', 'items.transition', 'profile.me', 'messages.list', 'constructor']) {
    const denied = await handle({ action });
    assert.equal(denied.error.code, 'ACTION_NOT_ALLOWED');
  }
  assert.deepEqual(await handle({ action: 'items.browse' }), {
    ok: false, error: { code: 'CATALOG_UNAVAILABLE', message: '商品信息暂不可用，请稍后重试' }
  });
});
