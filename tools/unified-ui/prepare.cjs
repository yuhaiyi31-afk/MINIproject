'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalSource, prepareStage, verifyStage } = require('./shared-source.cjs');

// IMPORTANT: Preview and staging intentionally have different semantics.
// Preview substitutes demo APIs. Staging retains real App frontend code,
// but strips all environment configuration until backend auth is verified.
function main(args = process.argv.slice(2)) {
  const mode = args[0] || '--preview';
  if (!['--source', '--stage', '--verify', '--preview'].includes(mode) && mode.startsWith('--')) {
    throw new Error('用法：node tools/unified-ui/prepare.cjs [--source | --preview [新目录] | --stage [新目录] | --verify 目录]');
  }
  if (mode === '--source') {
    if (args.length !== 1) throw new Error('--source 不需要其他参数');
    console.log(canonicalSource().source);
    return;
  }
  if (mode === '--stage') {
    if (args.length > 2) throw new Error('--stage 最多接受一个新目录');
    const out = prepareStage(args[1]);
    console.log(out);
    console.error('共享页面、组件与图标已直接从 SECONDHAND_APP/client 复制；没有使用原生 MINIproject 页面。');
    console.error('此工程故意不包含 CloudBase 凭证、正式微信 AppID 或业务联调，禁止直接作为生产版本提交。');
    return;
  }
  if (mode === '--verify') {
    if (args.length !== 2) throw new Error('--verify 需要一个生成目录');
    const count = verifyStage(args[1]);
    console.log('一致性校验通过：' + count + ' 个共享源码与资源文件匹配');
    return;
  }
  const outDir = mode === '--preview' ? args[1] : args[0]; // legacy demo invocation
  if (args.length > (mode === '--preview' ? 2 : 1)) throw new Error('预览参数数量不正确');
  const app = canonicalSource().root;
  const entry = path.join(app, 'scripts/prepare-ui-preview.cjs');
  if (!fs.existsSync(entry)) throw new Error('共享 App 预览生成器不存在');
  const out = require(entry).prepare(outDir);
  console.log(out);
  console.error('这是示例数据预览，不连接真实 CloudBase；真实项目请使用 --stage。');
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { main };
