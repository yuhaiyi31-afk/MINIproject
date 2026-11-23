const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { formatMarketPrice } = require('../utils/price-format');

test('完整保留金额，缺失和无效值不会作为免费发布', () => {
  assert.equal(formatMarketPrice(0), '免费');
  assert.equal(formatMarketPrice(49.5), 'NZ$ 49.50');
  assert.equal(formatMarketPrice(99999999999), 'NZ$ 99,999,999,999');
  for (const value of [null, '', '  ', NaN, -1]) assert.equal(formatMarketPrice(value), '价格待确认');
});

test('首页和集市共用商品卡，四个标签都引用真实图标', () => {
  const root = path.resolve(__dirname, '..');
  for (const page of ['pages/index/index.wxml', 'pages/market/list/list.wxml']) {
    assert.match(fs.readFileSync(path.join(root, page), 'utf8'), /<template is="listing-card"/);
  }
  const tabs = require('../app.json').tabBar.list;
  assert.deepEqual(tabs.map(tab => tab.text), ['首页','集市','服务大厅','我的']);
  for (const tab of tabs) for (const img of [tab.iconPath, tab.selectedIconPath]) {
    assert.equal(fs.readFileSync(path.join(root, img)).subarray(1, 4).toString(), 'PNG');
  }
});

function loadScreen(file, dependencies, wx = {}, app = { globalData: {} }) {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  let screen;
  const realRequire = require('node:module').createRequire(path.resolve(__dirname, '..', file));
  new Function('Page', 'require', 'wx', 'getApp', src)(
    value => { screen = value; },
    key => Object.hasOwn(dependencies, key) ? dependencies[key] : realRequire(key), wx, () => app
  );
  screen.data = structuredClone(screen.data);
  screen.setData = changes => Object.assign(screen.data, changes);
  return screen;
}

test('切换筛选时迟到的旧请求不能覆盖当前列表', async () => {
  const pending = [];
  const cloud = { browseItems: filters => new Promise(resolve => pending.push({filters, resolve})) };
  const ui = loadScreen('pages/market/list/list.js', { '../../../utils/market-cloud': cloud, '../../../utils/item-router': {} }, {stopPullDownRefresh() {}});
  const previous = ui.loadItems(true);
  ui.data.keyword = '相机';
  const latest = ui.loadItems(true);
  assert.equal(pending.length, 2);
  pending[1].resolve({items:[{id:'current',price:0}],hasMore:false});
  await latest;
  pending[0].resolve({items:[{id:'older',price:1}],hasMore:false});
  await previous;
  assert.deepEqual(ui.data.items.map(row => row.id), ['current']);
  assert.equal(ui.data.items[0].campusPrice, '免费');
});

test('发布确认可以取消，同一张确认单只提交一次', () => {
  const dialogs = [], posted = [];
  const wx = { getStorageSync: () => ({ nickName: '测试' }), showModal: options => dialogs.push(options) };
  const ui = loadScreen('pages/publish/index.js', {
    '../../utils/market-cloud': {},
    '../../utils/user-cloud': { isSignedIn: () => true },
    '../../utils/content-policy': { getValidationMessage: () => '' }
  }, wx);
  Object.assign(ui.data, { images:['test-image'],title:'测试',description:'描述',categoryText:'学习用品',price:'0',condition:'全新',region:'North Shore',deliveryMethod:'自取' });
  ui._submissionId='unit-request';
  ui.saveItemToCloud = item => posted.push(item);
  ui.onSubmit(); ui.onSubmit();
  assert.equal(dialogs.length, 1);
  assert.match(dialogs[0].content, /免费/);
  dialogs[0].success({confirm:false});
  assert.equal(ui.data.title, '测试');
  assert.equal(posted.length, 0);
  ui.onSubmit(); dialogs[1].success({confirm:true}); ui.onSubmit();
  assert.equal(posted.length, 1);
  assert.equal(posted[0].clientRequestId, 'unit-request');
});
