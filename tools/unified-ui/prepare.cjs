'use strict';

const fs = require('node:fs');
const path = require('node:path');

const app = process.env.SECONDHAND_APP_DIR || path.resolve(__dirname, '../../../SECONDHAND_APP');
const entry = path.join(app, 'scripts/prepare-ui-preview.cjs');
if (!fs.existsSync(entry)) {
  console.error('请将含新版界面的 SECONDHAND_APP 与 MINIproject 放在同一目录，或通过 SECONDHAND_APP_DIR 指定其位置。');
  process.exitCode = 1;
} else if (process.argv[2] === '--source') {
  console.log(path.resolve(app, 'client'));
} else {
  try {
    console.log(require(entry).prepare(process.argv[2]));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
