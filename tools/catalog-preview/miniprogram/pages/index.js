const { createWechatCatalog } = require('../catalog-client');

Page({
  data: { environmentId: '', itemId: '', items: [], busy: false, loaded: false, error: '', evidence: null, copyable: '' },

  onEnvironmentInput(event) {
    this.client = null;
    this.connectedEnvironment = '';
    this.setData({ environmentId: event.detail.value, items: [], itemId: '', loaded: false, error: '', evidence: null, copyable: '' });
  },

  onItemInput(event) {
    this.setData({ itemId: event.detail.value, error: '', evidence: null, copyable: '' });
  },

  getClient() {
    const environmentId = this.data.environmentId.trim();
    if (!this.client || this.connectedEnvironment !== environmentId) {
      this.client = createWechatCatalog(wx.cloud, environmentId);
      this.connectedEnvironment = environmentId;
    }
    return this.client;
  },

  async loadList() {
    if (this.data.busy) return;
    this.setData({ busy: true, loaded: false, items: [], error: '', evidence: null, copyable: '' });
    try {
      const items = await this.getClient().list();
      this.setData({ items, loaded: true });
    } catch (error) {
      this.setData({ error: error.message || '读取商品列表失败' });
    } finally {
      this.setData({ busy: false });
    }
  },

  chooseItem(event) {
    if (this.data.busy) return;
    this.setData({ itemId: event.currentTarget.dataset.id });
    this.loadItem();
  },

  async loadItem() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '', evidence: null, copyable: '' });
    try {
      const evidence = await this.getClient().get(this.data.itemId.trim());
      this.setData({ evidence, copyable: JSON.stringify(evidence) });
    } catch (error) {
      this.setData({ error: error.message || '读取商品详情失败' });
    } finally {
      this.setData({ busy: false });
    }
  },

  copyEvidence() {
    if (this.data.copyable) wx.setClipboardData({ data: this.data.copyable });
  }
});
