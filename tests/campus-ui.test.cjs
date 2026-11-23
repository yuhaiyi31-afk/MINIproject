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
