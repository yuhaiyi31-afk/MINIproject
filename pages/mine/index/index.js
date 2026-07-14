Page({
  data: {},

  onMenuTap(e) {
    const type = e.currentTarget.dataset.type;
    const titles = {
      publish: '我的发布',
      favorite: '我的收藏',
      booking: '我的预约',
      settings: '设置'
    };
    wx.showToast({ title: `${titles[type]}功能开发中`, icon: 'none' });
  }
})
