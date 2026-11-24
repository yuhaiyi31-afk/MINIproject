const serviceGroups = require('../../../utils/service-groups');
const itemRouter = require('../../../utils/item-router');
const marketCloud = require('../../../utils/market-cloud');

const FEED_REFRESH_INTERVAL = 60 * 1000;
const SERVICE_TYPE_MAP = { all: 8, pickup: 0, moving: 1, job: 2, party: 3, help: 4, rent: 5, carpool: 6, purchasing: 7 };

Page({
  data: {
    tabs: ['接机', '搬家', '找工', '组局', '求助', '租房', '拼车', '代购', '全部'],
    groups: serviceGroups,
    currentTab: 8,
    services: [],
    filteredList: [],
    loading: true,
    errorText: '',
    hasMore: true,
    nextSkip: 0
  },

  onLoad(options) {
    let tabIndex = SERVICE_TYPE_MAP.all;

    if (options && options.type && SERVICE_TYPE_MAP[options.type] !== undefined) {
      tabIndex = SERVICE_TYPE_MAP[options.type];
    } else {
      const app = getApp();
      if (app.globalData.helpTabType && SERVICE_TYPE_MAP[app.globalData.helpTabType] !== undefined) {
        tabIndex = SERVICE_TYPE_MAP[app.globalData.helpTabType];
        app.globalData.helpTabType = null;
      }
    }

    this.setData({ currentTab: tabIndex });
    const hasCache = this.showCachedServices(tabIndex);
    const freshCache = marketCloud.getCachedServices(this.categoryFor(tabIndex), 0, 20, FEED_REFRESH_INTERVAL);
    if (!freshCache) this.refreshServices(true, hasCache);
  },

  onShow() {
    const app = getApp();
    const pendingType = app.globalData.helpTabType;
    if (pendingType && SERVICE_TYPE_MAP[pendingType] !== undefined) {
      app.globalData.helpTabType = null;
      this.selectServiceTab(SERVICE_TYPE_MAP[pendingType]);
      return;
    }
    if (this._loadedOnce && app.globalData.serviceNeedsRefresh) {
      this.refreshServices(true, this.data.services.length > 0);
    } else if (this._loadedOnce && Date.now() - Number(this._lastRefreshAt || 0) > FEED_REFRESH_INTERVAL) {
      this.refreshServices(true, this.data.services.length > 0);
    }
  },

  showCachedServices(tabIndex) {
    const category = this.categoryFor(tabIndex);
    const cached = marketCloud.getCachedServices(category, 0, 20);
    if (!cached || !cached.items || !cached.items.length) return false;
    this.setData({
      services: cached.items,
      filteredList: cached.items,
      loading: false,
      hasMore: cached.hasMore,
      nextSkip: cached.nextSkip
    });
    this._loadedOnce = true;
    this._lastRefreshAt = Date.now();
    getApp().globalData._serviceItems = cached.items;
    return true;
  },

  async refreshServices(reset, background) {
    if (this.data.loading && !reset) return;
    if (reset) this._revision = (this._revision || 0) + 1;
    if (!background) this.setData({ loading: true, errorText: '' });
    const category = this.categoryFor(this.data.currentTab);
    const revision = this._revision || 0;
    try {
      const result = await marketCloud.listServices(category, reset ? 0 : this.data.nextSkip, 20);
      if (revision !== (this._revision || 0)) return;
      const services = reset ? result.items : this.data.services.concat(result.items);
      this._loadedOnce = true;
      this._lastRefreshAt = Date.now();
      getApp().globalData.serviceNeedsRefresh = false;
      this.setData({ services, filteredList: services, loading: false, hasMore: result.hasMore, nextSkip: result.nextSkip });
      getApp().globalData._serviceItems = services;
    } catch (error) {
      if (revision !== (this._revision || 0)) return;
      if (background && this.data.services.length) return;
      this._loadedOnce = true;
      const services = reset ? [] : this.data.services;
      this.setData({ services, filteredList: services, loading: false, hasMore: false, errorText: services.length ? '' : marketCloud.getErrorMessage(error) });
      getApp().globalData._serviceItems = services;
    }
  },

  categoryFor(index) { return this.data.tabs[index] === '全部' ? '' : this.data.tabs[index]; },
  chooseGroup(e) {
    const group = this.data.groups[Number(e.currentTarget.dataset.index)];
    if (group) wx.showActionSheet({ itemList: group.options, success: (result) => this.selectServiceTab(this.data.tabs.indexOf(group.options[result.tapIndex])) });
  },
  retryServices() { this.refreshServices(true); },
  showAll() { this.selectServiceTab(SERVICE_TYPE_MAP.all); },
  onTabChange(e) {
    const index = e.currentTarget.dataset.index;
    this.selectServiceTab(index);
  },

  selectServiceTab(index) {
    const tabIndex = Number(index) || 0;
    this._revision = (this._revision || 0) + 1;
    this.setData({ loading: false, errorText: '', currentTab: tabIndex, services: [], filteredList: [], hasMore: true, nextSkip: 0 });
    const hasCache = this.showCachedServices(tabIndex);
    const freshCache = marketCloud.getCachedServices(this.categoryFor(tabIndex), 0, 20, FEED_REFRESH_INTERVAL);
    if (!freshCache) this.refreshServices(true, hasCache);
  },

  onServiceTap(e) {
    const item = e.currentTarget.dataset.item;
    itemRouter.navigateToDetail(item, item.source || 'cloud');
  },

  onPublishTap(e) {
    const type = this.categoryFor(this.data.currentTab);
    const app = getApp();
    app.globalData.publishServiceType = type;
    wx.navigateTo({ url: '/pages/publish/index?type=service&category=' + encodeURIComponent(type) });
  },

  async onPullDownRefresh() {
    await this.refreshServices(true);
    wx.stopPullDownRefresh();
  },

  onReachBottom() {
    if (this.data.hasMore) this.refreshServices(false);
  }
})
