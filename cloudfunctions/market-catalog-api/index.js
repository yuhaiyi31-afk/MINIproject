const cloudbase = require('@cloudbase/js-sdk');
const { createCatalogHandler, createStore, previewConfig } = require('./catalog');

// Check the runtime before opening a database. The current live environment
// cannot serve this preview even if it receives the preview configuration.
const config = previewConfig(process.env);
let handler;

exports.main = async (event) => {
  if (!config) {
    return { ok: false, error: { code: 'CATALOG_DISABLED', message: '商品预览未开放' } };
  }
  if (!handler) {
    const app = cloudbase.init({ env: config.environmentId, timeout: 4000 });
    handler = createCatalogHandler({
      store: createStore(app.database()),
      mediaRoot: config.mediaRoot,
      signFiles: fileList => app.getTempFileURL({ fileList })
    });
  }
  return handler(event);
};
