'use strict';

const { createHash } = require('node:crypto');
const { collections, TradeError, check, hash, id } = require('./shared');

const MAX_IMAGE_BYTES = 512 * 1024;
const MAX_ENCODED_BYTES = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const UPLOAD_WINDOW = 10 * 60 * 1000;
const ATTACH_WINDOW = 24 * 60 * 60 * 1000;
const MAX_UPLOADS_PER_WINDOW = 24;
const ASSET_ID = /^media_[a-f0-9]{40}$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function imageBytes(image) {
  check(typeof image === 'string' && image.length > 0 && image.length <= MAX_ENCODED_BYTES,
    'IMAGE_SIZE', '请选择不超过 512 KB 的压缩图片');
  check(image.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(image),
    'IMAGE_INVALID', '无法读取图片内容');
  const bytes = Buffer.from(image, 'base64');
  check(bytes.length <= MAX_IMAGE_BYTES && bytes.toString('base64') === image, 'IMAGE_INVALID', '无法读取图片内容');
  return bytes;
}

function detectedFormat(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return '';
}

async function sanitizeListingImage(buffer) {
  const format = detectedFormat(buffer);
  check(format, 'IMAGE_TYPE', '请选择 JPG、PNG 或 WebP 图片');
  try {
    const sharp = require('sharp');
    const pipeline = sharp(buffer, { failOn: 'error', limitInputPixels: 12_000_000, sequentialRead: true });
    const metadata = await pipeline.metadata();
    check(metadata.format === format && metadata.width > 0 && metadata.height > 0
      && metadata.width <= 8000 && metadata.height <= 8000 && (metadata.pages || 1) === 1,
    'IMAGE_INVALID', '请选择尺寸正常的静态图片');
    return await pipeline.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  } catch (error) {
    if (error instanceof TradeError) throw error;
    throw new TradeError('IMAGE_INVALID', '图片损坏或尺寸异常，请更换图片');
  }
}

function assetFileId(root, assetId) {
  return `cloud://${root}/market/images/${assetId}.jpg`;
}

async function attachAssets(tx, ids, targetId, openId, mediaRoot, now) {
  check(mediaRoot, 'MEDIA_DISABLED', '测试图片存储尚未配置');
  const assets = [];
  for (const assetId of ids) {
    const asset = await tx.get(collections.media, assetId);
    check(ASSET_ID.test(assetId) && asset?.ownerOpenId === openId && asset.state === 'ready'
      && asset.fileId === assetFileId(mediaRoot, assetId)
      && (asset.itemId === targetId || (!asset.itemId && asset.expiresAtMs > now())),
    'ITEM_IMAGE_FORBIDDEN', '图片已失效、已用于其他内容或不属于当前账号');
    assets.push(asset);
  }
  for (let index = 0; index < ids.length; index++) {
    if (!assets[index].itemId) await tx.update(collections.media, ids[index], { itemId: targetId });
  }
  return assets.map(asset => asset.fileId);
}

function createMediaUpload({ store, account, mediaRoot, uploadFile, now }) {
  return async (principal, input) => {
    check(mediaRoot && typeof uploadFile === 'function', 'MEDIA_DISABLED', '测试图片存储尚未配置');
    const requestId = id(input.requestId);
    const bytes = imageBytes(input.imageBase64);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const reserved = await store.transaction(async tx => {
      const { openId } = await account(tx, principal);
      const assetId = `media_${hash(mediaRoot, openId, requestId).slice(0, 40)}`;
      const existing = await tx.get(collections.media, assetId);
      if (existing) {
        check(existing.ownerOpenId === openId && existing.checksum === checksum, 'IMAGE_CONFLICT', '该上传编号已用于另一张图片');
        check(existing.itemId || existing.expiresAtMs > now(), 'IMAGE_EXPIRED', '请重新选择这张图片');
        return { assetId, openId, ready: existing.state === 'ready' };
      }
      const time = now();
      const window = Math.floor(time / UPLOAD_WINDOW);
      const limitId = `upload_${hash(mediaRoot, openId).slice(0, 40)}`;
      const limit = await tx.get(collections.limits, limitId);
      const count = limit?.window === window ? limit.count : 0;
      check(count < MAX_UPLOADS_PER_WINDOW, 'UPLOAD_LIMIT', '上传过于频繁，请稍后重试');
      await tx.set(collections.limits, limitId, { window, count: count + 1 });
      await tx.add(collections.media, assetId, {
        ownerOpenId: openId, checksum, state: 'pending', createdAtMs: time, expiresAtMs: time + ATTACH_WINDOW
      });
      return { assetId, openId, ready: false };
    });
    const { assetId, openId, ready } = reserved;
    if (ready) return { assetId };

    const sanitized = await sanitizeListingImage(bytes);
    const response = await uploadFile(`market/images/${assetId}.jpg`, sanitized);
    const fileId = assetFileId(mediaRoot, assetId);
    check(response?.fileID === fileId, 'MEDIA_STORAGE', '测试存储未确认图片上传');

    return store.transaction(async tx => {
      const accountAfterUpload = await account(tx, principal);
      check(accountAfterUpload.openId === openId, 'LINK_STATE', '账号绑定已发生变化');
      const current = await tx.get(collections.media, assetId);
      check(current?.ownerOpenId === openId && current.checksum === checksum && current.expiresAtMs > now(),
        'IMAGE_EXPIRED', '请重新选择这张图片');
      if (current.state !== 'ready') await tx.update(collections.media, assetId, { state: 'ready', fileId });
      return { assetId };
    });
  };
}

module.exports = { MAX_ENCODED_BYTES, ASSET_ID, assetFileId, attachAssets, createMediaUpload, sanitizeListingImage };
