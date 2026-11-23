'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const sharp = require('sharp');
const { collections } = require('../shared');
const { MAX_ENCODED_BYTES } = require('../media');
const { createCatalogHandler } = require('../../market-catalog-api/catalog');
const { fixture, MEDIA_ROOT, SELLER, BUYER, APP, ITEM, CHAT } = require('./fixture');

const fields = {
  title: 'Fixture display', description: 'Comes with a stand', price: '499.95', category: '电子产品',
  condition: '正常使用', region: 'Auckland CBD', deliveryMethod: '当面交易'
};
const sourcePhoto = sharp({ create: { width: 2200, height: 30, channels: 3, background: '#346899' } })
  .withExif({ IFD0: { Artist: 'Synthetic device owner' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '0/1 0/1 0/1' } })
  .jpeg().toBuffer();

function call(handler, action, fields = {}) {
  return handler({ ...fields, action });
}

async function success(handler, action, fields) {
  const result = await call(handler, action, fields);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

async function denied(handler, action, fields, code) {
  const result = await call(handler, action, fields);
  assert.equal(result.error?.code, code, JSON.stringify(result));
}

async function imageInput(requestId) {
  return { requestId, imageBase64: (await sourcePhoto).toString('base64') };
}

async function publish(handler, requestId = 'new-listing') {
  const { assetId } = await success(handler, 'media.upload', await imageInput(`photo-${requestId}`));
  const input = { ...fields, promiseReal: true, requestId, photoAssetIds: [assetId] };
  return { input, item: await success(handler, 'items.publish', input), assetId };
}

test('the independently deployable seller policy matches the existing Mini marketplace policy', () => {
  assert.equal(fs.readFileSync(path.join(__dirname, '../content-policy.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '../../market-api/content-policy.js'), 'utf8'));
});

test('real image processing strips EXIF, bounds dimensions and exposes only a private receipt', async () => {
  const f = fixture();
  const seller = f.handler('wx', SELLER);
  const input = await imageInput('same-upload');
  const original = await sharp(Buffer.from(input.imageBase64, 'base64')).metadata();
  assert.ok(original.exif && original.width > 1600);
  const output = await success(seller, 'media.upload', input);
  assert.deepEqual(Object.keys(output), ['assetId']);
  assert.deepEqual(await success(seller, 'media.upload', input), output);
  assert.equal(f.objects.size, 1);
  const saved = await sharp([...f.objects.values()][0]).metadata();
  assert.equal(saved.format, 'jpeg');
  assert.equal(saved.exif, undefined);
  assert.equal(saved.width, 1600);
  assert.equal(f.rows(collections.limits)[0].count, 1);
  const changed = (await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000000' } }).png().toBuffer()).toString('base64');
  await denied(seller, 'media.upload', { ...input, imageBase64: changed }, 'IMAGE_CONFLICT');
  await denied(seller, 'media.upload', { requestId: 'bad', imageBase64: 'data:image/png;base64,AA==' }, 'IMAGE_INVALID');
  await denied(seller, 'media.upload', { requestId: 'large', imageBase64: 'A'.repeat(MAX_ENCODED_BYTES + 4) }, 'IMAGE_SIZE');
  assert.equal(f.objects.size, 1);
});

test('upload and document failures can be retried without a second object or a stuck receipt', async () => {
  let uploads = 0;
  let refusedListing = false;
  const f = fixture({
    onUpload: () => { if (++uploads === 1) throw new Error('synthetic storage timeout'); },
    failAdd: data => {
      if (data.publishType === 'market' && !refusedListing) { refusedListing = true; return true; }
      return false;
    }
  });
  const seller = f.handler('wx', SELLER);
  const image = await imageInput('retry-upload');
  await denied(seller, 'media.upload', image, 'TRADE_UNAVAILABLE');
  assert.equal(f.rows(collections.media)[0].state, 'pending');
  const { assetId } = await success(seller, 'media.upload', image);
  assert.equal(f.rows(collections.limits)[0].count, 1);
  const payload = { ...fields, requestId: 'retry-listing', promiseReal: true, photoAssetIds: [assetId] };
  await denied(seller, 'items.publish', payload, 'TRADE_UNAVAILABLE');
  assert.equal(f.rows(collections.media)[0].itemId, undefined);
  const [first, second] = await Promise.all([1, 2].map(() => success(seller, 'items.publish', payload)));
  assert.equal(first.id, second.id);
  assert.equal(f.rows(collections.items).filter(row => row.submissionHash).length, 1);
  assert.equal(f.rows(collections.media)[0].itemId, first.id);
  assert.equal(f.objects.size, 1);
});

test('publication rejects forged, foreign, reused and expired photos and private public-facing text', async () => {
  const f = fixture();
  const seller = f.handler('wx', SELLER);
  const buyer = f.handler('wx', BUYER);
  const { assetId } = await success(seller, 'media.upload', await imageInput('only-seller'));
  const payload = { ...fields, promiseReal: true, requestId: 'share-a-listing', photoAssetIds: [assetId] };
  await denied(f.handler(null), 'items.publish', { ...payload, ownerOpenId: SELLER }, 'AUTH_REQUIRED');
  await denied(f.handler('app', APP), 'media.upload', await imageInput('unlinked'), 'LINK_REQUIRED');
  await denied(buyer, 'items.publish', payload, 'ITEM_IMAGE_FORBIDDEN');
  await denied(seller, 'items.publish', { ...payload, photoAssetIds: ['cloud://example.invalid/foreign.jpg'] }, 'ITEM_IMAGES');
  await denied(seller, 'items.publish', { ...payload, title: 'Fixture buyer@example.invalid' }, 'ITEM_CONTACT');
  await denied(seller, 'items.publish', { ...payload, description: 'Collect at 10 Example Road' }, 'ITEM_CONTACT');
  await denied(seller, 'items.publish', { ...payload, price: '1.001' }, 'ITEM_PRICE');
  await denied(seller, 'items.publish', { ...payload, promiseReal: false }, 'ITEM_CONFIRMATION');
  await success(seller, 'items.publish', payload);
  await denied(seller, 'items.publish', { ...payload, requestId: 'reuse-same-photo' }, 'ITEM_IMAGE_FORBIDDEN');
  await denied(seller, 'items.publish', { ...payload, title: 'Changed submission' }, 'ITEM_REQUEST_CONFLICT');
  const idle = await success(seller, 'media.upload', await imageInput('expired-upload'));
  f.advance(86_400_001);
  await denied(seller, 'items.publish', { ...payload, requestId: 'expired-receipt', photoAssetIds: [idle.assetId] }, 'ITEM_IMAGE_FORBIDDEN');
  assert.equal(f.rows(collections.items).filter(row => row.submissionHash).length, 1);
});

test('only the owner can recover a publication by its original request ID', async () => {
  const f = fixture();
  const seller = f.handler('wx', SELLER);
  const request = { requestId: 'pending-publication' };
  assert.deepEqual(await success(seller, 'items.publishStatus', request), { item: null });
  await denied(f.handler(null), 'items.publishStatus', request, 'AUTH_REQUIRED');
  await denied(f.handler('app', APP), 'items.publishStatus', request, 'LINK_REQUIRED');
  await denied(seller, 'items.publishStatus', { requestId: 'wrong / id' }, 'INVALID_ID');
  const { item } = await publish(seller, request.requestId);
  assert.deepEqual(await success(seller, 'items.publishStatus', request), { item });
  assert.deepEqual(await success(f.handler('wx', BUYER), 'items.publishStatus', request), { item: null });
  const sold = await success(seller, 'items.transition', { itemId: item.id, revision: item.revision, status: 'SOLD' });
  assert.deepEqual(await success(seller, 'items.publishStatus', request), { item: sold });
  assert.equal(f.rows(collections.items).filter(row => row.submissionHash).length, 1);
});

test('service publishing and chat keep the original service ID and preserve the conversation when the service ends', async () => {
  const f = fixture();
  const seller = f.handler('wx', SELLER);
  const buyer = f.handler('wx', BUYER);
  const { assetId } = await success(seller, 'media.upload', await imageInput('service-image'));
  const input = {
    requestId: 'publish-service', publishType: 'service', category: '搬家', price: '49.50',
    title: 'Weekend moving help', description: 'Help with moving boxes', promiseReal: true, photoAssetIds: [assetId]
  };
  const item = await success(seller, 'items.publish', input);
  assert.equal((await success(seller, 'items.publish', input)).id, item.id);
  assert.deepEqual(await success(seller, 'items.publishStatus', { requestId: input.requestId }), { item: null });
  assert.deepEqual(await success(seller, 'items.publishStatus', input), { item });
  assert.equal((await success(seller, 'items.mine', { publishType: 'service' })).items[0].id, item.id);
  assert.ok((await success(seller, 'items.mine')).items.every(row => row.id !== item.id));
  await denied(buyer, 'chat.ensure', { itemId: item.id }, 'ITEM_UNAVAILABLE');
  const chat = await success(buyer, 'chat.ensure', { itemId: item.id, publishType: 'service' });
  assert.equal(chat.publishType, 'service');
  await success(buyer, 'chat.send', { conversationId: chat.id, requestId: 'service-message', text: 'Are you available on Saturday?' });
  const transition = { itemId: item.id, revision: item.revision, status: 'SOLD', publishType: 'service' };
  await denied(buyer, 'items.transition', transition, 'ITEM_FORBIDDEN');
  await success(seller, 'items.transition', transition);
  const history = await success(seller, 'chat.get', { conversationId: chat.id });
  assert.equal(history.itemId, item.id);
  assert.equal(history.messages[0].text, 'Are you available on Saturday?');
});

test('profile edits bind an owned avatar receipt without altering legacy identity fields', async () => {
  const f = fixture();
  const signFiles = async files => ({
    fileList: files.map(file => ({ ...file, status: 0, tempFileURL: 'https://fixture.invalid/avatar.jpg' }))
  });
  const seller = f.handler('wx', SELLER, { signFiles });
  const buyer = f.handler('wx', BUYER);
  const { assetId } = await success(seller, 'media.upload', await imageInput('new-avatar'));
  await denied(buyer, 'profile.save', { nickName: 'Buyer', avatarAssetId: assetId }, 'ITEM_IMAGE_FORBIDDEN');
  await denied(seller, 'profile.save', { nickName: 'owner@example.invalid' }, 'ITEM_CONTACT');
  await success(seller, 'profile.save', { nickName: 'Updated display name', avatarAssetId: assetId });
  const result = await success(seller, 'profile.me');
  assert.equal(result.profile.nickName, 'Updated display name');
  assert.equal(result.profile.avatar.url, 'https://fixture.invalid/avatar.jpg');
  assert.equal(result.permissions.isAdmin, false);
  await denied(seller, 'items.publish', { ...fields, requestId: 'avatar-reuse', promiseReal: true, photoAssetIds: [assetId] }, 'ITEM_IMAGE_FORBIDDEN');
  assert.doesNotMatch(JSON.stringify(result), /synthetic-private-value|ownerOpenId|internalTestAccess/);
  assert.equal(f.rows(collections.profiles).find(row => row._id === SELLER).privatePhone, 'synthetic-private-value');
  assert.equal(f.rows(collections.items).find(row => row._id === ITEM).ownerOpenId, SELLER);
});

test('publication, text edits, image edits and visibility changes use the same ID throughout', async () => {
  const f = fixture();
  const seller = f.handler('wx', SELLER);
  const buyer = f.handler('wx', BUYER);
  const signed = [];
  const catalogue = createCatalogHandler({
    store: f.catalogStore, mediaRoot: MEDIA_ROOT,
    signFiles: async files => {
      signed.push(...files.map(file => file.fileID));
      return { fileList: files.map(file => ({ ...file, tempFileURL: 'https://fixture.invalid/listing.jpg' })) };
    }
  });
  const { item } = await publish(seller);
  const initial = await success(catalogue, 'items.get', { itemId: item.id });
  assert.equal(initial.title, fields.title);
  assert.equal(initial.price, 499.95);
  assert.equal(initial.currency, 'NZD');
  assert.equal(initial.images.length, 1);
  assert.equal(signed.length, 1);
  assert.ok(!JSON.stringify(initial).includes(SELLER));
  await denied(buyer, 'items.getOwned', { itemId: item.id }, 'ITEM_FORBIDDEN');
  const update = { ...fields, itemId: item.id, revision: item.revision, requestId: 'edit-title', title: 'Updated fixture display' };
  await denied(buyer, 'items.edit', update, 'ITEM_FORBIDDEN');
  const edited = await success(seller, 'items.edit', update);
  assert.deepEqual(await success(seller, 'items.edit', update), edited);
  const { assetId } = await success(seller, 'media.upload', await imageInput('replacement-image'));
  const newPhoto = { ...update, requestId: 'new-photo-edit', photoAssetIds: [assetId] };
  await denied(seller, 'items.edit', newPhoto, 'ITEM_REVISION');
  const replaced = await success(seller, 'items.edit', { ...newPhoto, revision: edited.revision });
  assert.equal(replaced.id, item.id);
  assert.equal((await success(catalogue, 'items.get', { itemId: item.id })).title, 'Updated fixture display');
  assert.ok(signed.at(-1).endsWith(`/${assetId}.jpg`));
  const toggle = (record, status) => ({ itemId: record.id, revision: record.revision, status });
  await denied(buyer, 'items.transition', toggle(replaced, 'DELETED'), 'ITEM_FORBIDDEN');
  const unlisted = await success(seller, 'items.transition', toggle(replaced, 'UNLISTED'));
  assert.equal((await call(catalogue, 'items.get', { itemId: item.id })).ok, false);
  const active = await success(seller, 'items.transition', toggle(unlisted, 'ACTIVE'));
  await denied(seller, 'items.markSold', { itemId: active.id, revision: replaced.revision }, 'ITEM_REVISION');
  const removed = await success(seller, 'items.transition', toggle(active, 'DELETED'));
  assert.equal(removed.status, 'DELETED');
  assert.deepEqual(await success(seller, 'items.transition', toggle(active, 'DELETED')), removed);
  assert.equal((await call(catalogue, 'items.get', { itemId: item.id })).ok, false);
  const row = f.rows(collections.items).find(row => row._id === item.id);
  assert.deepEqual(row.images, []);
  assert.equal(row.retainedMedia.images.length, 1);
  await denied(seller, 'items.transition', toggle(removed, 'ACTIVE'), 'ITEM_STATE');
});

test('editing or deleting a legacy product preserves its owner, existing conversations and notifications', async () => {
  const f = fixture();
  const seller = f.handler('wx', SELLER);
  const buyer = f.handler('wx', BUYER);
  await f.store.transaction(tx => tx.update(collections.items, ITEM, {
    images: [`cloud://${MEDIA_ROOT}/market/images/legacy.jpg`], createdAtMs: 1795320000000
  }));
  const conversationBefore = await success(buyer, 'chat.get', { conversationId: CHAT });
  const owner = await success(seller, 'items.getOwned', { itemId: ITEM });
  const item = await success(seller, 'items.edit', { ...fields, itemId: ITEM, revision: owner.revision, requestId: 'legacy-edit' });
  assert.equal(item.id, ITEM);
  assert.equal(item.imageCount, 1);
  await success(seller, 'items.transition', { itemId: ITEM, revision: item.revision, status: 'DELETED' });
  const rows = (await success(seller, 'items.mine', { status: 'DELETED' })).items;
  assert.ok(rows.some(row => row.id === ITEM));
  assert.equal((await success(buyer, 'items.mine')).items.length, 0);
  assert.deepEqual(await success(buyer, 'chat.get', { conversationId: CHAT }), conversationBefore);
  assert.equal(f.rows(collections.notifications).length, 1);
  const stored = f.rows(collections.items).find(row => row._id === ITEM);
  assert.equal(stored.ownerOpenId, SELLER);
  assert.equal(stored.contact, 'synthetic-private-value');
});
