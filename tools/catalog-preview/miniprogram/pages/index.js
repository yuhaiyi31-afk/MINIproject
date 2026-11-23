const { createWechatCatalog, testEnvironment } = require('../catalog-client');

Page({
  data: {
    environmentId: '', itemId: '', items: [], busy: false, loaded: false, error: '', evidence: null, copyable: '',
    categories: ['接机', '搬家', '找工', '组局', '求助', '租房', '拼车', '代购'],
    serviceCategory: '接机', services: [], servicePage: '', serviceLoaded: false, serviceDetail: null
  },

  onEnvironmentInput(event) {
    this.client = null;
    this.connectedEnvironment = '';
    this.setData({
      environmentId: event.detail.value, items: [], itemId: '', loaded: false, error: '', evidence: null, copyable: '',
      services: [], servicePage: '', serviceLoaded: false, serviceDetail: null
    });
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
  },

  selectServiceCategory(event) {
    const serviceCategory = this.data.categories[Number(event.detail.value)];
    this.setData({ serviceCategory, services: [], servicePage: '', serviceLoaded: false, serviceDetail: null });
    return this.loadServices();
  },

  async loadServices() {
    if (this.data.busy) return;
    const { serviceCategory, servicePage } = this.data;
    this.setData({ busy: true, error: '' });
    try {
      const client = this.getClient();
      const { items, page } = await client.services(serviceCategory, servicePage);
      this.setData({ services: servicePage ? [...this.data.services, ...items] : items, servicePage: page.nextCursor, serviceLoaded: true });
    } catch (error) {
      this.setData({ error: error.message || '读取服务失败' });
    } finally {
      this.setData({ busy: false });
    }
  },

  async showService(event) {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '', serviceDetail: null });
    try {
      this.setData({ serviceDetail: await this.getClient().service(event.currentTarget.dataset.id) });
    } catch (error) {
      this.setData({ error: error.message || '读取服务详情失败' });
    } finally {
      this.setData({ busy: false });
    }
  },

  openPublishService() {
    try {
      const env = testEnvironment(this.data.environmentId);
      wx.navigateTo({ url: '/pages/items?env=' + encodeURIComponent(env) + '&publishType=service' });
    } catch (error) {
      this.setData({ error: error.message });
    }
  },

  openServiceTrade() {
    const service = this.data.serviceDetail;
    if (service?.status !== 'ACTIVE') return;
    const env = this.connectedEnvironment;
    wx.navigateTo({ url: '/pages/trade?publishType=service&env=' + encodeURIComponent(env) + '&itemId=' + encodeURIComponent(service.id) });
  },

  openTrade() {
    try {
      const env = testEnvironment(this.data.environmentId);
      const itemId = this.data.itemId.trim();
      wx.navigateTo({ url: `/pages/trade?env=${encodeURIComponent(env)}&itemId=${encodeURIComponent(itemId)}` });
    } catch (error) {
      this.setData({ error: error.message });
    }
  }
});
