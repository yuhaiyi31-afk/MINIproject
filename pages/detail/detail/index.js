Page({
  onLoad(options) {
    const id = encodeURIComponent(options.id || '');
    const source = options.source ? `&source=${encodeURIComponent(options.source)}` : '';
    wx.redirectTo({
      url: `/pages/market/detail/index?id=${id}&itemType=product${source}`
    });
  }
});
