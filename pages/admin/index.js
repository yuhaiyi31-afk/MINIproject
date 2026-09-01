const adminCloud = require('../../utils/admin-cloud');

function formatTime(value) {
  const timestamp = Number(value) || 0;
  if (!timestamp) return '未知时间';
  const date = new Date(timestamp);
  const pad = number => String(number).padStart(2, '0');
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function confirm(options) {
  return new Promise(resolve => wx.showModal({ ...options, success: result => resolve(!!result.confirm), fail: () => resolve(false) }));
}

Page({
  data: {
    tab: 'reports',
    reports: [],
    items: [],
    users: [],
    loading: false,
    loadError: '',
    busyId: ''
  },

  onShow() {
    this.loadCurrent();
  },

  onPullDownRefresh() {
    this.loadCurrent(true).finally(() => wx.stopPullDownRefresh());
  },

  onTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (!['reports', 'items', 'users'].includes(tab) || tab === this.data.tab) return;
    this.setData({ tab, loadError: '' });
    this.loadCurrent();
  },

  async loadCurrent(force) {
    if (this.data.loading) return;
    const tab = this.data.tab;
    if (!force && Array.isArray(this.data[tab]) && this.data[tab].length) return;
    this.setData({ loading: true, loadError: '' });
    try {
      if (tab === 'reports') {
        const reports = (await adminCloud.listReports()).map(report => ({
          ...report,
          timeText: formatTime(report.updatedAtMs || report.createdAtMs),
          statusText: report.status === 'pending' ? '待处理' : report.status === 'dismissed' ? '已忽略' : '已处理',
          resolutionText: report.resolution === 'ban' ? '已暂停内容并封禁用户' : report.resolution === 'delete' ? '已软删除内容' : ['unlist', 'suspend'].includes(report.resolution) ? '已暂停内容' : report.resolution === 'dismiss' ? '举报不成立' : ''
        }));
        this.setData({ reports });
      } else if (tab === 'items') {
        const statusText = { active: '在线', unlisted: '卖家下架', sold: '已售', suspended: '平台暂停', deleted: '已删除', deleting: '清理中' };
        const items = (await adminCloud.listItems()).map(item => ({ ...item, timeText: formatTime(item.createdAtMs), statusText: statusText[item.status] || item.status }));
        this.setData({ items });
      } else {
        const users = (await adminCloud.listUsers()).map(user => ({
          ...user,
          initial: String(user.nickName || '用').slice(0, 1),
          timeText: formatTime(user.bannedAtMs || user.updatedAtMs)
        }));
        this.setData({ users });
      }
    } catch (error) {
      this.setData({ loadError: adminCloud.getErrorMessage(error) });
    } finally {
      this.setData({ loading: false });
    }
  },

  async onReportAction(e) {
    const reportId = e.currentTarget.dataset.id;
    const decision = e.currentTarget.dataset.action;
    if (!reportId || this.data.busyId) return;
    const options = {
      dismiss: { title: '忽略这条举报？', content: '举报会标记为不成立，商品保持在线。' },
      unlist: { title: '暂停该内容？', content: '内容将立即从公共列表隐藏，卖家不能自行恢复。' },
      suspend: { title: '暂停该内容？', content: '内容将立即从公共列表隐藏，卖家不能自行恢复。' },
      delete: { title: '软删除该内容？', content: '内容会停止展示，但保留状态和处置记录供后续追踪。' },
      ban: { title: '暂停并封禁发布者？', content: '该用户的在线发布会全部暂停，且不能继续发布或发送聊天消息。' }
    }[decision];
    if (!options || !(await confirm({ ...options, confirmColor: decision === 'dismiss' ? '#3478C9' : '#D94A4A' }))) return;
    this.setData({ busyId: reportId });
    wx.showLoading({ title: '正在处理…', mask: true });
    try {
      await adminCloud.resolveReport(reportId, decision);
      this.setData({ reports: [] });
      await this.loadCurrent(true);
      wx.showToast({ title: '处理完成', icon: 'success' });
    } catch (error) {
      wx.showModal({ title: '处理失败', content: adminCloud.getErrorMessage(error), showCancel: false });
    } finally {
      wx.hideLoading();
      this.setData({ busyId: '' });
    }
  },

  async onItemStatus(e) {
    const itemId = e.currentTarget.dataset.id;
    const status = e.currentTarget.dataset.status;
    if (!itemId || this.data.busyId) return;
    const options = status === 'active'
      ? { title: '恢复该内容？', content: '确认合规后，内容会重新出现在对应公共列表。', color: '#3478C9' }
      : status === 'deleted'
        ? { title: '软删除该内容？', content: '内容停止展示，但记录仍会保留用于安全追踪。', color: '#D94A4A' }
        : { title: '暂停该内容？', content: '内容会立即隐藏，卖家不能自行恢复。', color: '#D94A4A' };
    if (!(await confirm({ title: options.title, content: options.content, confirmColor: options.color }))) return;
    this.setData({ busyId: itemId });
    try {
      await adminCloud.setItemStatus(itemId, status, '管理员后台操作');
      this.setData({ items: [] });
      await this.loadCurrent(true);
      wx.showToast({ title: status === 'active' ? '已恢复' : status === 'deleted' ? '已删除' : '已暂停', icon: 'success' });
    } catch (error) {
      wx.showModal({ title: '操作失败', content: adminCloud.getErrorMessage(error), showCancel: false });
    } finally {
      this.setData({ busyId: '' });
    }
  },

  async onUserToggle(e) {
    const userId = e.currentTarget.dataset.id;
    const currentStatus = e.currentTarget.dataset.status;
    const willBan = currentStatus !== 'banned';
    if (!userId || this.data.busyId) return;
    const accepted = await confirm({
      title: willBan ? '确认封禁该用户？' : '确认解除封禁？',
      content: willBan ? '该用户所有在线发布会被下架，且不能继续发布或聊天。' : '用户可恢复发布和聊天，之前下架的内容不会自动恢复。',
      confirmColor: willBan ? '#D94A4A' : '#3478C9'
    });
    if (!accepted) return;
    this.setData({ busyId: userId });
    try {
      await adminCloud.setUserStatus(userId, willBan ? 'banned' : 'active', willBan ? '管理员处置' : '');
      this.setData({ users: [] });
      await this.loadCurrent(true);
      wx.showToast({ title: willBan ? '已封禁' : '已解封', icon: 'success' });
    } catch (error) {
      wx.showModal({ title: '操作失败', content: adminCloud.getErrorMessage(error), showCancel: false });
    } finally {
      this.setData({ busyId: '' });
    }
  }
});
