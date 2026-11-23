const fs = require('node:fs');
const { EVIDENCE_SCHEMA, DEVICE_SCHEMA, testEnvironment } = require('./miniprogram/catalog-client');

const PLATFORMS = ['wechat', 'android', 'ios'];
const DATA_FIELDS = ['environmentId', 'itemId', 'status', 'currency', 'priceCents'];
function compareEvidence(rows, full = false) {
  if (!Array.isArray(rows) || rows.length !== PLATFORMS.length) throw new Error('需要微信、Android 和 iOS 各一份结果');
  const schema = rows[0]?.schema;
  if (![EVIDENCE_SCHEMA, DEVICE_SCHEMA].includes(schema) || (full && schema !== DEVICE_SCHEMA)) throw new Error('需要相同版本的设备验收结果，完整验收请重新复制新版结果');
  const fields = schema === DEVICE_SCHEMA ? [...DATA_FIELDS, 'contentSha256', 'photoCount'] : DATA_FIELDS;
  const required = ['schema', 'platform', ...fields];
  const results = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Object.keys(row).length !== required.length
      || !required.every(field => Object.hasOwn(row, field)) || row.schema !== schema
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
    if (schema === DEVICE_SCHEMA) {
      const active = typeof row.contentSha256 === 'string' && /^[a-f0-9]{64}$/.test(row.contentSha256)
        && Number.isInteger(row.photoCount) && row.photoCount >= (full ? 2 : 0) && row.photoCount <= 9;
      const sold = row.contentSha256 === null && row.photoCount === 0;
      if (row.status === 'ACTIVE' ? !active : !sold) throw new Error('商品内容或照片数量不符合验收要求');
    }
    results.set(row.platform, row);
  }
  const baseline = results.get('wechat');
  for (const platform of ['android', 'ios']) {
    const mismatches = fields.filter(field => results.get(platform)[field] !== baseline[field]);
    if (mismatches.length) throw new Error(`${platform} 与微信结果不一致：${mismatches.join('、')}`);
  }
  return { platforms: PLATFORMS, ...Object.fromEntries(fields.map(field => [field, baseline[field]])) };
}

function compareSaleCycle(activeRows, soldRows) {
  const active = compareEvidence(activeRows, true);
  const sold = compareEvidence(soldRows, true);
  if (active.status !== 'ACTIVE' || sold.status !== 'SOLD' || active.itemId !== sold.itemId || active.environmentId !== sold.environmentId) {
    throw new Error('需要同一测试环境中同一件商品在售和已售的两组记录');
  }
  return { active, sold };
}

if (require.main === module) {
  try {
    const files = process.argv.slice(2);
    const cycle = files[0] === '--sale-cycle';
    if (cycle) files.shift();
    if (files.length !== (cycle ? 6 : 3)) throw new Error('请传入三端记录；--sale-cycle 依次需要在售和已售各三份');
    const rows = files.map(file => JSON.parse(fs.readFileSync(file, 'utf8')));
    const result = cycle ? compareSaleCycle(rows.slice(0, 3), rows.slice(3)) : compareEvidence(rows);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof SyntaxError ? '验收文件不是有效的 JSON' : error.message);
    process.exitCode = 1;
  }
}

module.exports = { compareEvidence, compareSaleCycle };
