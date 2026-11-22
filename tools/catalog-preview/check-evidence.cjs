const fs = require('node:fs');
const { EVIDENCE_SCHEMA, testEnvironment } = require('./miniprogram/catalog-client');

const PLATFORMS = ['wechat', 'android', 'ios'];
const DATA_FIELDS = ['environmentId', 'itemId', 'status', 'currency', 'priceCents'];
const REQUIRED_FIELDS = ['schema', 'platform', ...DATA_FIELDS];

function compareEvidence(rows) {
  if (!Array.isArray(rows) || rows.length !== PLATFORMS.length) throw new Error('需要微信、Android 和 iOS 各一份结果');
  const results = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Object.keys(row).length !== REQUIRED_FIELDS.length
      || !REQUIRED_FIELDS.every(field => Object.hasOwn(row, field)) || row.schema !== EVIDENCE_SCHEMA
      || !PLATFORMS.includes(row.platform) || results.has(row.platform)) {
      throw new Error('验收格式无效，或有平台重复');
    }
    if (testEnvironment(row.environmentId) !== row.environmentId || typeof row.itemId !== 'string'
      || !/^[a-zA-Z0-9_-]{1,100}$/.test(row.itemId) || row.currency !== 'NZD' || !['ACTIVE', 'SOLD'].includes(row.status)) {
      throw new Error('验收记录的环境、商品编号、币种或状态无效');
    }
    if (row.status === 'ACTIVE' ? !Number.isSafeInteger(row.priceCents) || row.priceCents < 0 : row.priceCents !== null) {
      throw new Error('验收记录的价格无效');
    }
    results.set(row.platform, row);
  }
  const baseline = results.get('wechat');
  for (const platform of ['android', 'ios']) {
    const mismatches = DATA_FIELDS.filter(field => results.get(platform)[field] !== baseline[field]);
    if (mismatches.length) throw new Error(`${platform} 与微信结果不一致：${mismatches.join('、')}`);
  }
  return { platforms: PLATFORMS, ...Object.fromEntries(DATA_FIELDS.map(field => [field, baseline[field]])) };
}

if (require.main === module) {
  try {
    const files = process.argv.slice(2);
    if (files.length !== 3) throw new Error('用法：node check-evidence.cjs wechat.json android.json ios.json');
    const result = compareEvidence(files.map(file => JSON.parse(fs.readFileSync(file, 'utf8'))));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof SyntaxError ? '验收文件不是有效的 JSON' : error.message);
    process.exitCode = 1;
  }
}

module.exports = { compareEvidence };
