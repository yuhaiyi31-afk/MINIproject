const { createWechatTrade } = require('../trade-client');
const { prepareListingPhoto, uploadListingPhoto } = require('../listing-photo');

const LABELS = { ACTIVE: '在售', SOLD: '已售', UNLISTED: '已下架', DELETED: '已删除', SUSPENDED: '平台暂停' };
const MUTABLE = ['ACTIVE', 'SOLD', 'UNLISTED'];
const INPUTS = ['title', 'description', 'price'];
const PICKERS = { category: 'categories', condition: 'conditions', region: 'regions', deliveryMethod: 'deliveryMethods' };

function newRequestId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000000000000)}`;
}

Page({
  data: { ready: false, busy: false, error: '', items: [], hasMore: false, offset: 0, form: null, photos: [], options: {} },

  onLoad(options) {
    try {
      this.environmentId = options.env;
      this.publishType = options.publishType === 'service' ? 'service' : 'market';
      this.setData({ service: this.publishType === 'service' });
      if (this.data.service) wx.setNavigationBarTitle({ title: '我的服务' });
      this.call = createWechatTrade(wx.cloud, options.env);
      this.initialize();
    } catch (error) {
      this.setData({ error: error.message });
    }
  },

  async run(operation) {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try { await operation(); }
    catch (error) { this.setData({ error: error.message || '操作失败' }); }
    finally { this.setData({ busy: false }); }
  },

  initialize() {
    if (typeof this.call !== 'function') return;
    return this.run(async () => {
      const { userId } = await this.call('identity.status');
      if (!userId) throw new Error('请用已完成身份确认的测试账号');
      this.draftKey = `market.trade.${this.environmentId}.${userId}.editor` + (this.data.service ? '.service' : '');
      const options = await this.call('items.options');
      await this.loadPage(0);
      this.setData({ options, ready: true });
    });
  },

  async loadPage(offset) {
    const { items, page } = await this.call('items.mine', { offset, publishType: this.publishType });
    const shown = items.map(item => ({
      ...item, statusLabel: this.data.service && item.status === 'SOLD' ? '已结束' : LABELS[item.status] || item.status, editable: MUTABLE.includes(item.status)
    }));
    this.setData({
      items: offset ? [...this.data.items, ...shown] : shown,
      offset: page.nextOffset, hasMore: page.hasMore
    });
  },

  loadMore() { return this.run(() => this.loadPage(this.data.offset)); },

  persist() {
    wx.setStorageSync(this.draftKey, { form: this.data.form, photos: this.data.photos, requestId: this.requestId });
  },

  restoreDraft(itemId) {
    const draft = wx.getStorageSync(this.draftKey);
    if (!draft?.form || draft.form.id !== itemId) return false;
    this.requestId = draft.requestId;
    this.setData({ form: draft.form, photos: draft.photos || [], error: '' });
    return true;
  },

  newItem() {
    if (this.data.busy || this.restoreDraft('')) return;
    this.requestId = newRequestId('publish');
    this.setData({
      form: { id: '', title: '', description: '', price: '', category: '', condition: '', region: '', deliveryMethod: '', imageCount: 0 },
      photos: [], error: ''
    });
  },

  edit(event) {
    const { id } = event.currentTarget.dataset;
    if (this.data.busy || this.restoreDraft(id)) return;
    return this.run(async () => {
      const item = await this.call('items.getOwned', { itemId: id, publishType: this.publishType });
      this.requestId = newRequestId('edit');
      this.setData({ form: { ...item, price: String(item.price) }, photos: [] });
    });
  },

  enterField(event) {
    const { field } = event.currentTarget.dataset;
    if (INPUTS.includes(field)) this.setData({ [`form.${field}`]: event.detail.value });
  },

  selectOption(event) {
    const { field } = event.currentTarget.dataset;
    if (Object.prototype.hasOwnProperty.call(PICKERS, field)) {
      const key = field === 'category' && this.data.service ? 'serviceCategories' : PICKERS[field];
      const value = this.data.options[key][Number(event.detail.value)];
      if (value) this.setData({ [`form.${field}`]: value });
    }
  },

  choosePhotos() {
    if (this.data.busy || this.data.photos.length >= 9) return;
    wx.chooseMedia({
      count: 9 - this.data.photos.length, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'],
      success: result => {
        const added = result.tempFiles.map(file => ({ localPath: file.tempFilePath, uploadId: newRequestId('media') }));
        this.setData({ photos: [...this.data.photos, ...added] });
      },
      fail: error => { if (!String(error.errMsg).includes('cancel')) this.setData({ error: '无法选择照片，请检查相册或相机权限' }); }
    });
  },

  removePhoto(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!this.data.busy) this.setData({ photos: this.data.photos.filter((_photo, position) => position !== index) });
  },

  closeEditor() {
    if (this.data.busy) return;
    this.persist();
    this.setData({ form: null, photos: [], error: '' });
  },

  discardDraft() {
    if (this.data.busy) return;
    wx.removeStorageSync(this.draftKey);
    this.setData({ form: null, photos: [], error: '' });
  },

  submit() {
    return this.run(async () => {
      const { form, photos } = this.data;
      const { id, revision, title, description, price, category, condition, region, deliveryMethod, imageCount } = form;
      if (!title.trim() || !description.trim() || !category) throw new Error('请填写标题、描述和分类');
      if (!this.data.service && (!condition || !region || !deliveryMethod)) {
        throw new Error('请选择成色、区域和交付方式');
      }
      if (!/^[0-9]{1,9}(\.[0-9]{1,2})?$/.test(price.trim())) throw new Error('请输入有效价格，最多两位小数');
      if (!photos.length && !imageCount) throw new Error('请至少添加一张真实图片');
      this.persist();
      const ids = [];
      for (let index = 0; index < photos.length; index++) {
        const photo = this.data.photos[index];
        const path = photo.transferPath || await prepareListingPhoto(wx, photo.localPath);
        if (!photo.transferPath) {
          this.setData({ [`photos[${index}].transferPath`]: path });
          this.persist();
        }
        const assetId = photo.assetId || await uploadListingPhoto(wx, this.call, path, photo.uploadId);
        this.setData({ [`photos[${index}].assetId`]: assetId });
        this.persist();
        ids.push(assetId);
      }
      const payload = { requestId: this.requestId, publishType: this.publishType, title, description, price, category, condition, region, deliveryMethod };
      if (ids.length) payload.photoAssetIds = ids;
      const updated = id
        ? await this.call('items.edit', { ...payload, itemId: id, revision })
        : await this.call('items.publish', { ...payload, promiseReal: true });
      wx.removeStorageSync(this.draftKey);
      this.setData({ form: null, photos: [], lastItemId: updated.id });
      wx.showToast({ title: id ? '已保存修改' : '发布成功' });
      await this.loadPage(0);
    });
  },

  setStatus(event) {
    const { id, next } = event.currentTarget.dataset;
    const item = this.data.items.find(row => row.id === id);
    if (!item || this.data.busy) return;
    wx.showModal({
      title: '确认操作',
      content: next === 'DELETED' ? '删除后内容将从目录移除，历史聊天仍可查看。' : '确认将状态改为「' + (this.data.service && next === 'SOLD' ? '已结束' : LABELS[next]) + '」？',
      success: ({ confirm }) => {
        if (confirm) this.run(async () => {
          try { await this.call('items.transition', { itemId: id, status: next, revision: item.revision, publishType: this.publishType }); }
          catch (error) { if (error.code === 'ITEM_REVISION') await this.loadPage(0); throw error; }
          await this.loadPage(0);
        });
      }
    });
  },

  copyItemId(event) { wx.setClipboardData({ data: event.currentTarget.dataset.id }); }
});
