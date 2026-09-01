const adminCloud = require('../../../utils/admin-cloud');

Page({
  data: { users: [], loading: false, busyId: '', errorText: '' },

  onShow() { this.loadUsers(); },

  async loadUsers() {
    if (this.data.loading) return;
    this.setData({ loading: true, errorText: '' });
    try {
      const users = (await adminCloud.listBlockedUsers()).map(user => ({
        ...user,
        initial: String(user.nickName || '用').slice(0, 1)
      }));
      this.setData({ users });
    } catch (error) {
      this.setData({ users: [], errorText: adminCloud.getErrorMessage(error) });
    } finally {
      this.setData({ loading: false });
    }
  },

  onUnblock(e) {
    const userId = e.currentTarget.dataset.id;
    if (!userId || this.data.busyId) return;
    wx.showModal({
      title: '取消拉黑？',
      content: '取消后可再次看到该用户的公开发布并发送消息。',
      success: async result => {
        if (!result.confirm) return;
        this.setData({ busyId: userId });
        try {
          await adminCloud.unblockUser(userId);
          getApp().globalData.marketNeedsRefresh = true;
          this.setData({ users: this.data.users.filter(user => user.id !== userId) });
          wx.showToast({ title: '已取消拉黑', icon: 'success' });
        } catch (error) {
          wx.showModal({ title: '操作失败', content: adminCloud.getErrorMessage(error), showCancel: false });
        } finally {
          this.setData({ busyId: '' });
        }
      }
    });
  }
});
