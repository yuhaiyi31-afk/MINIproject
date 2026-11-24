'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareStage, verifyStage } = require('../tools/unified-ui/shared-source.cjs');

function write(root, relative, data) {
  const dest = path.join(root, relative);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, data);
}

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-ui-test-'));
  const app = path.join(base, 'SECONDHAND_APP');
  const client = path.join(app, 'client');
  const tabs = ['首页', '集市', '服务大厅', '我的'];
  const icons = ['home', 'market', 'services', 'mine'];
  const names = ['home', 'market', 'services', 'mine'];
  const pages = names.map(p => ({ path: 'pages/' + p + '/index' }));
  const list = names.map((p, index) => ({
    pagePath: 'pages/' + p + '/index',
    text: tabs[index],
    iconPath: 'static/ui/tab-' + icons[index] + '.png',
    selectedIconPath: 'static/ui/tab-' + icons[index] + '-active.png'
  }));
  write(client, 'pages.json', JSON.stringify({ pages, tabBar: { list } }));
  write(client, 'manifest.json', JSON.stringify({ 'uni-app-x': { vapor: false }, 'appid': '' }));
  write(client, 'App.uvue', '<style>.page { color: #215B98; }</style>');
  write(client, 'styles/campus.css', '.campus { color: #215B98; }');
  write(client, 'components/item-card/card.uvue', '<template><text>共享商品卡</text></template>');
  write(client, 'main.uts', 'export function createApp() {}');
  write(client, 'config/app-config.uts', [
    'export const APP_CONFIG = {',
    "  environmentId: 'production-test',",
    "  apiBase: 'https://example.com',",
    "  publishableKey: '',",
    "  uploadUrl: '',",
    '  localWebCatalog: false,',
    '  catalogPreview: false,',
    '  tradePreview: false,',
    '  uiPreview: false,',
    '}'
  ].join('\n'));
  for (const page of pages) write(client, page.path + '.uvue', '<template><text>' + page.path + '</text></template>');
  for (const icon of list) {
    write(client, icon.iconPath, Buffer.from([137, 80, 78, 71, 1]));
    write(client, icon.selectedIconPath, Buffer.from([137, 80, 78, 71, 2]));
  }
  return { base, app, client };
}

test('one-source staging preserves all pages, CSS, components and icons byte-for-byte', t => {
  const f = fixture();
  t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
  const prior = process.env.SECONDHAND_APP_DIR;
  process.env.SECONDHAND_APP_DIR = f.app;
  try {
    const stage = path.join(f.base, 'generated-wechat-app');
    assert.equal(prepareStage(stage), stage);
    assert.ok(verifyStage(stage) >= 16);
    for (const file of [
      'pages/home/index.uvue', 'pages/market/index.uvue',
      'styles/campus.css', 'App.uvue', 'components/item-card/card.uvue', 'static/ui/tab-home.png'
    ]) {
      assert.deepEqual(fs.readFileSync(path.join(stage, file)), fs.readFileSync(path.join(f.client, file)), file);
    }
    const cfg = fs.readFileSync(path.join(stage, 'config/app-config.uts'), 'utf8');
    assert.match(cfg, /environmentId: "staging-not-configured"/);
    assert.match(cfg, /apiBase: ""/);
    assert.match(cfg, /publishableKey: ""/);
    assert.match(cfg, /uiPreview: false/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(stage, 'manifest.json'))).uniStatistics.enable, false);
    assert.throws(() => prepareStage(stage), /目标目录已存在/);
    assert.throws(() => prepareStage(path.join(f.app, 'new-project')), /两个 GitHub 仓库之外/);
    write(stage, 'pages/home/index.uvue', '<template>diverged!</template>');
    assert.throws(() => verifyStage(stage), /不同步/);
  } finally {
    if (prior == null) delete process.env.SECONDHAND_APP_DIR;
    else process.env.SECONDHAND_APP_DIR = prior;
  }
});

test('missing routes and tabs prevent staging instead of generating silently incomplete UI', t => {
  const f = fixture();
  t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
  const prior = process.env.SECONDHAND_APP_DIR;
  process.env.SECONDHAND_APP_DIR = f.app;
  try {
    const file = path.join(f.client, 'pages/mine/index.uvue');
    fs.unlinkSync(file);
    assert.throws(() => prepareStage(path.join(f.base, 'bad-stage')), /缺少页面/);
  } finally {
    if (prior == null) delete process.env.SECONDHAND_APP_DIR;
    else process.env.SECONDHAND_APP_DIR = prior;
  }
});
