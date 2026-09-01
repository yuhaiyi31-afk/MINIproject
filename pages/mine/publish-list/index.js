const itemRouter = require('../../../utils/item-router');
const marketCloud = require('../../../utils/market-cloud');

Page({
  data: {
    list: [],
    showAction: false,
    actionItem: null,
    actionType: ''
  },

  async onShow() {
    wx.showNavigationBarLoading();
    try {
      const cloudItems = await marketCloud.listMine();
      this.setData({ list: cloudItems });
    } catch (error) {
      this.setData({ list: [] });
      wx.showToast({ title: marketCloud.getErrorMessage(error), icon: 'none', duration: 3000 });
    } finally {
      wx.hideNavigationBarLoading();
    }
  },

  onItemTap(e) {
    const item = e.currentTarget.dataset.item;
    if (item && item.status === 'deleting') {
      wx.showToast({ title: '该内容待完成清理', icon: 'none' });
      return;
    }
    if (item && item.status === 'deleted') {
      wx.showToast({ title: '该内容已删除，仅保留状态记录', icon: 'none' });
      return;
    }
    itemRouter.navigateToDetail(item, item.source || 'published');
  },

  onEdit(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.list.find(entry => String(entry.id) === String(id));
    if (item && item.status === 'deleting') {
      wx.showToast({ title: '该内容待完成清理', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: `/pages/publish/index?editId=${encodeURIComponent(id)}` });
  },

  onUnlist(e) {
    this.openAction(e.currentTarget.dataset.id, 'unlist');
  },

  onMarkSold(e) {
    this.openAction(e.currentTarget.dataset.id, 'sold');
  },

  onRelist(e) {
    this.openAction(e.currentTarget.dataset.id, 'relist');
  },

  onDelete(e) {
    this.openAction(e.currentTarget.dataset.id, 'delete');
  },

  openAction(id, actionType) {
    const item = this.data.list.find(entry => String(entry.id) === String(id));
    if (item) this.setData({ showAction: true, actionItem: item, actionType });
  },

  async onConfirmAction() {
    const item = this.data.actionItem;
    const actionType = this.data.actionType;
    if (!item) return;
    const loadingTitles = { delete: '删除中...', unlist: '下架中...', sold: '标记中...', relist: '上架中...' };
    wx.showLoading({ title: loadingTitles[actionType] || '处理中...', mask: true });
    try {
      if (actionType === 'delete') await marketCloud.removeItem(item.id);
      else if (actionType === 'unlist') await marketCloud.setItemStatus(item.id, 'unlisted');
      else if (actionType === 'sold') await marketCloud.setItemStatus(item.id, 'sold');
      else if (actionType === 'relist') await marketCloud.setItemStatus(item.id, 'active');
      getApp().globalData.marketNeedsRefresh = true;
      getApp().globalData.serviceNeedsRefresh = true;
      this.setData({ showAction: false, actionItem: null, actionType: '' });
      const successTitles = { delete: '已删除', unlist: '已下架', sold: '已标记售出', relist: '已重新上架' };
      wx.showToast({ title: successTitles[actionType] || '操作成功', icon: 'success' });
      this.onShow();
    } catch (error) {
      wx.showModal({ title: '操作失败', content: marketCloud.getErrorMessage(error), showCancel: false });
      this.onShow();
    } finally {
      wx.hideLoading();
    }
  },

  onCancelAction() {
    this.setData({ showAction: false, actionItem: null, actionType: '' });
  },

  noop() {}
});
