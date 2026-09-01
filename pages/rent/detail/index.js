Page({
  onLoad(options) {
    const id = encodeURIComponent(options.id || '');
    const source = encodeURIComponent(options.source || 'cloud');
    wx.redirectTo({
      url: `/pages/market/detail/index?id=${id}&itemType=service&source=${source}`
    });
  }
});
