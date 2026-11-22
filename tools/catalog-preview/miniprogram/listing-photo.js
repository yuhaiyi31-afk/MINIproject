'use strict';

const LIMIT = 699052;

function readBase64(platform, filePath) {
  return new Promise((resolve, reject) => platform.getFileSystemManager().readFile({
    filePath, encoding: 'base64',
    success: result => resolve(result.data),
    fail: () => reject(new Error('无法读取图片，请重新选择这张照片'))
  }));
}

function compress(platform, src, compressedWidth) {
  return new Promise((resolve, reject) => platform.compressImage({
    src, quality: 78, compressedWidth,
    success: result => resolve(result.tempFilePath),
    fail: () => reject(new Error('图片压缩失败，请更换照片'))
  }));
}

async function prepareListingPhoto(platform, path) {
  const regular = await compress(platform, path, 1280);
  return (await readBase64(platform, regular)).length <= LIMIT ? regular : compress(platform, path, 768);
}

async function uploadListingPhoto(platform, call, path, requestId) {
  const imageBase64 = await readBase64(platform, path);
  if (!imageBase64 || imageBase64.length > LIMIT) throw new Error('请改用不超过 512 KB 的压缩图片');
  const { assetId } = await call('media.upload', { requestId, imageBase64 });
  if (!assetId) throw new Error('上传未返回商品图片编号');
  return assetId;
}

module.exports = { prepareListingPhoto, uploadListingPhoto };
