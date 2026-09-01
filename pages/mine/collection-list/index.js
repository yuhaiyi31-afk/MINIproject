const itemRouter = require('../../../utils/item-router');
const marketCloud = require('../../../utils/market-cloud');

Page({
  data: {
    list: [],
    showAction: false,
    actionItem: null
  },

  async onShow() {
    wx.showNavigationBarLoading();
    try {
      this.setData({ list: await marketCloud.listFavorites() });
    } catch (error) {
      this.setData({ list: [] });
      wx.showToast({ title: marketCloud.getErrorMessage(error), icon: 'none' });
    } finally {
      wx.hideNavigationBarLoading();
    }
  },

  onItemTap(e) {
    const item = e.currentTarget.dataset.item;
    itemRouter.navigateToDetail(item, item.source || 'favorite');
  },

  onRemoveFav(e) {
    const item = e.currentTarget.dataset.item;
    this.setData({ showAction: true, actionItem: item });
  },

  async onConfirmRemove() {
    const item = this.data.actionItem;
    if (!item) return;
    try {
      await marketCloud.toggleFavorite(item.id, false);
      this.setData({ list: this.data.list.filter(i => !itemRouter.isSameItem(i, item)), showAction: false, actionItem: null });
      wx.showToast({ title: '已取消收藏', icon: 'none' });
    } catch (error) {
      wx.showToast({ title: marketCloud.getErrorMessage(error), icon: 'none' });
    }
  },

  onCancelAction() {
    this.setData({ showAction: false, actionItem: null });
  },
  noop() {}

})
