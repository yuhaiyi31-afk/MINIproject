const itemRouter = require('../../../utils/item-router');
const marketCloud = require('../../../utils/market-cloud');

const FEED_REFRESH_INTERVAL = 60 * 1000;

Page({
  data: {
    items: [],
    loading: true,
    errorText: '',
    hasMore: true,
    nextSkip: 0
  },

  onLoad() {
    const cached = marketCloud.getCachedServices('租房', 0, 20);
    if (cached && cached.items && cached.items.length) {
      this.applyItems(cached, true);
      if (!marketCloud.getCachedServices('租房', 0, 20, FEED_REFRESH_INTERVAL)) this.refreshItems(true, true);
    } else {
      this.refreshItems(true);
    }
  },

  onShow() {
    if (this._loadedOnce && Date.now() - Number(this._lastRefreshAt || 0) > FEED_REFRESH_INTERVAL) {
      this.refreshItems(true, this.data.items.length > 0);
    }
  },

  applyItems(result, reset) {
    const items = reset ? result.items : this.data.items.concat(result.items);
    this._loadedOnce = true;
    this._lastRefreshAt = Date.now();
    this.setData({ items, loading: false, hasMore: result.hasMore, nextSkip: result.nextSkip });
  },

  async refreshItems(reset, background) {
    if (this.data.loading && !reset) return;
    if (!background) this.setData({ loading: true, errorText: '' });
    try {
      const result = await marketCloud.listServices('租房', reset ? 0 : this.data.nextSkip, 20);
      this.applyItems(result, reset);
    } catch (error) {
      if (background && this.data.items.length) return;
      this._loadedOnce = true;
      this.setData({ items: reset ? [] : this.data.items, loading: false, hasMore: false, errorText: marketCloud.getErrorMessage(error) });
    }
  },

  onDetail(e) {
    const item = e.currentTarget.dataset.item;
    itemRouter.navigateToDetail(item, item.source || 'cloud');
  },

  async onPullDownRefresh() {
    await this.refreshItems(true);
    wx.stopPullDownRefresh();
  },

  onReachBottom() {
    if (this.data.hasMore) this.refreshItems(false);
  }
});
