'use strict';

// One canonical front end: SECONDHAND_APP/client.
// This copies the real UVue/UTS sources without replacing their services with
// demo fixtures. HBuilderX compiles this source to WeChat, Android and iOS.
// Do NOT use the original native MINIproject root as the new release artifact.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');

const MINI_ROOT = path.resolve(__dirname, '../..');
const EXCLUDED = new Set(['.git', 'node_modules', 'unpackage', 'dist', 'build']);
const CERTIFICATE = /\.(?:pem|key|p12|pfx|jks|keystore|mobileprovision|provisionprofile)$/i;
const PROVENANCE = 'shared-ui-source.json';
const SOURCE_SKIP = new Set(['manifest.json', 'config/app-config.uts', PROVENANCE]);
const TABS = ['首页', '集市', '服务大厅', '我的'];

function canonicalSource() {
  const root = path.resolve(process.env.SECONDHAND_APP_DIR || path.join(MINI_ROOT, '..', 'SECONDHAND_APP'));
  const source = path.join(root, 'client');
  if (!fs.existsSync(source)) {
    throw new Error('找不到 SECONDHAND_APP/client，请把两仓库放在同级目录或设置 SECONDHAND_APP_DIR');
  }
  return { root: fs.realpathSync(root), source: fs.realpathSync(source) };
}

function ensureDesign(source) {
  const pages = JSON.parse(fs.readFileSync(path.join(source, 'pages.json'), 'utf8'));
  const labels = pages.tabBar.list.map(item => item.text);
  if (JSON.stringify(labels) !== JSON.stringify(TABS)) throw new Error('共享前端四个标签与设计基准不一致');
  for (const page of pages.pages) {
    if (!fs.existsSync(path.join(source, page.path + '.uvue'))) {
      throw new Error('共享前端缺少页面 ' + page.path);
    }
  }
  for (const tab of pages.tabBar.list) {
    for (const icon of [tab.iconPath, tab.selectedIconPath]) {
      if (!fs.existsSync(path.join(source, icon))) throw new Error('共享前端缺少图标 ' + icon);
    }
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
  if (!manifest['uni-app-x']) throw new Error('预期使用 uni-app x 共享工程');
  return pages;
}

function tracked(file) {
  return file.split(path.sep).every(part => part && !part.startsWith('.') && !EXCLUDED.has(part)) &&
    !CERTIFICATE.test(file);
}

function walk(dir, parent = '') {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relative = parent ? path.join(parent, entry.name) : entry.name;
    if (!tracked(relative) || entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) files.push(...walk(path.join(dir, entry.name), relative));
    else if (entry.isFile() && !SOURCE_SKIP.has(relative.replace(/\\/g, '/'))) files.push(relative.replace(/\\/g, '/'));
  }
  return files.sort();
}

function digests(source) {
  return Object.fromEntries(walk(source).map(relative => [
    relative,
    createHash('sha256').update(fs.readFileSync(path.join(source, relative))).digest('hex')
  ]));
}

function assertOutsideRepos(target, source, appRoot) {
  const parent = fs.realpathSync(path.dirname(target));
  const normalized = path.join(parent, path.basename(target));
  for (const repo of [MINI_ROOT, appRoot]) {
    if (normalized === repo || normalized.startsWith(repo + path.sep)) {
      throw new Error('生成工程必须放在两个 GitHub 仓库之外，避免覆盖源代码：' + normalized);
    }
  }
  if (normalized === source || normalized.startsWith(source + path.sep)) {
    throw new Error('不能修改共享前端源代码');
  }
  return normalized;
}

function copyAllowed(from, source) {
  const relative = path.relative(source, from);
  if (relative === '') return true;
  if (!tracked(relative) || fs.lstatSync(from).isSymbolicLink()) return false;
  return true;
}

function configureSafeStage(out) {
  const configFile = path.join(out, 'config/app-config.uts');
  let lines = fs.readFileSync(configFile, 'utf8').split('\n');
  const settings = {
    environmentId: 'staging-not-configured', apiBase: '', publishableKey: '', uploadUrl: '',
    localWebCatalog: false, catalogPreview: false, tradePreview: false, uiPreview: false
  };
  for (const [key, value] of Object.entries(settings)) {
    const search = '  ' + key + ': ';
    const matches = lines.flatMap((line, index) => line.startsWith(search) ? [index] : []);
    if (matches.length !== 1) throw new Error('客户端配置结构已变化，请核对字段 ' + key);
    lines[matches[0]] = search + JSON.stringify(value) + ',';
  }
  fs.writeFileSync(configFile, lines.join('\n'));

  const manifestFile = path.join(out, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.appid = '';
  manifest['mp-weixin'] = { appid: 'touristappid', setting: { urlCheck: true } };
  manifest.uniStatistics = { enable: false };
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
}

function prepareStage(destination) {
  const { root, source } = canonicalSource();
  ensureDesign(source);
  const out = destination ?
    assertOutsideRepos(path.resolve(destination), source, root) :
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'campus-shared-project-')), 'client');
  if (fs.existsSync(out)) throw new Error('目标目录已存在，不会覆盖：' + out);
  let created = false;
  try {
    fs.cpSync(source, out, { recursive: true, filter: file => copyAllowed(file, source) });
    created = true;
    configureSafeStage(out);
    const manifest = {
      schema: 'campus-shared-ui/v1',
      sourceRepo: 'SECONDHAND_APP/client',
      mode: 'unconfigured-staging',
      tabs: TABS,
      hashes: digests(source)
    };
    fs.writeFileSync(path.join(out, PROVENANCE), JSON.stringify(manifest, null, 2) + '\n');
    verifyStage(out);
    return out;
  } catch (error) {
    if (created || fs.existsSync(out)) fs.rmSync(out, { recursive: true, force: true });
    throw error;
  }
}

function verifyStage(destination) {
  if (!destination) throw new Error('请提供需要校验的生成目录');
  const { source } = canonicalSource();
  ensureDesign(source);
  const out = fs.realpathSync(path.resolve(destination));
  const manifest = JSON.parse(fs.readFileSync(path.join(out, PROVENANCE), 'utf8'));
  if (manifest.schema !== 'campus-shared-ui/v1' || manifest.mode !== 'unconfigured-staging') {
    throw new Error('不是统一前端生成的隔离工程');
  }
  const expected = digests(source);
  const actual = digests(out);
  for (const relative of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    if (expected[relative] !== actual[relative] || manifest.hashes[relative] !== expected[relative]) {
      throw new Error('统一工程与 App 源码不同步：' + relative);
    }
  }
  const config = fs.readFileSync(path.join(out, 'config/app-config.uts'), 'utf8');
  if (!config.includes("publishableKey: \"\"") || !config.includes("uiPreview: false")) {
    throw new Error('这不是尚未连接真实云环境的安全预发布工程');
  }
  const generatedManifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  if (generatedManifest['mp-weixin']?.appid !== 'touristappid' || generatedManifest.uniStatistics?.enable !== false) {
    throw new Error('预发布工程的微信测试标识和统计配置被修改');
  }
  return Object.keys(expected).length;
}

module.exports = { canonicalSource, prepareStage, verifyStage, digests, ensureDesign };
