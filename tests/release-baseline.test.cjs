'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

test('mini program retains its original native routes until shared frontend identity passes acceptance', () => {
  const app = JSON.parse(read('app.json'));
  assert.deepEqual(app.tabBar.list.map(row => row.text), ['首页', '集市', '服务大厅', '我的']);
  assert.ok(app.pages.includes('pages/auth/index'), 'original WeChat auth route must stay available');
  assert.equal(app.cloudfunctionRoot, undefined, 'cloudfunctionRoot is in project.config.json, not app.json');
  assert.match(read('app.js'), /enforceIdentityGate\(\)/);
  assert.match(read('utils/user-cloud.js'), /wx\.cloud\.callFunction/);
});

test('mini program uses matching campus blue theme and preserved reusable listing-card template', () => {
  const color = JSON.parse(read('design/campus.json')).color;
  const app = JSON.parse(read('app.json'));
  assert.equal(color.brand.toLowerCase(), '#4a90d9');
  assert.equal(app.tabBar.selectedColor, color.action);
  assert.equal(app.window.backgroundColor, color.canvas);
  for (const file of ['pages/index/index.wxml', 'pages/market/list/list.wxml']) {
    assert.match(read(file), /<template is="listing-card"/);
  }
});

test('integration preview tools never enter the original mini program package', () => {
  const project = JSON.parse(read('project.config.json'));
  const ignored = (project.packOptions?.ignore || []).map(entry => entry.value);
  for (const folder of ['tools/catalog-preview', 'tools/unified-ui']) {
    assert.ok(ignored.includes(folder), 'missing preview exclusion: ' + folder);
  }
  assert.equal(project.cloudfunctionRoot, 'cloudfunctions/');
});
