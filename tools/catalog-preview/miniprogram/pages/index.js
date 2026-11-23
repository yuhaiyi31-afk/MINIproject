const { createWechatCatalog, testEnvironment, deviceEvidence } = require('../catalog-client');

Page({
  data: {
    environmentId: '', itemId: '', items: [], busy: false, loaded: false, error: '', detail: null,
    categories: ['接机', '搬家', '找工', '组局', '求助', '租房', '拼车', '代购'],
    serviceCategory: '接机', services: [], servicePage: '', serviceLoaded: false, serviceDetail: null
  },

  onEnvironmentInput(event) {
    this.client = null;
    this.connectedEnvironment = '';
    this.setData({
      environmentId: event.detail.value, items: [], itemId: '', loaded: false, error: '', detail: null,
      services: [], servicePage: '', serviceLoaded: false, serviceDetail: null
    });
  },

  onItemInput(event) {
    this.setData({ itemId: event.detail.value, error: '', detail: null });
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
    this.setData({ busy: true, loaded: false, items: [], error: '', detail: null });
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
    this.loadedUrls = new Set();
    this.setData({ busy: true, error: '', detail: null });
    try {
      const detail = await this.getClient().detail(this.data.itemId.trim(), true);
      this.setData({ detail });
    } catch (error) {
      this.setData({ error: error.message || '读取商品详情失败' });
    } finally {
      this.setData({ busy: false });
    }
  },

  photoLoaded(event) {
    const url = event.currentTarget.dataset.url;
    if (this.data.detail?.images?.some(photo => photo.url === url)) this.loadedUrls.add(url);
  },

  photoFailed(event) {
    const url = event.currentTarget.dataset.url;
    if (!this.data.detail?.images?.some(photo => photo.url === url)) return;
    this.loadedUrls.delete(url);
    this.setData({ error: '有商品图片未加载，请重新核对商品详情' });
  },

  copyEvidence() {
    if (!this.data.detail) return;
    try {
      const record = deviceEvidence(this.connectedEnvironment, this.data.itemId.trim(), this.data.detail, Array.from(this.loadedUrls));
      this.setData({ error: '' });
      wx.setClipboardData({ data: JSON.stringify(record), fail: () => this.setData({ error: '复制失败，请重试' }) });
    } catch (error) { this.setData({ error: error.message }); }
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
