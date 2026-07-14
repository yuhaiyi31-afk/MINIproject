Page({
  data: {
    searchKeyword: '',
    displayList: [],
    searchEmpty: false,
    kingkongRow1: [
      { id: 1, icon: '✈️', name: '接机', type: 'pickup', bgColor: '#E8F4FD' },
      { id: 2, icon: '🚚', name: '搬家', type: 'moving', bgColor: '#FFF3E8' },
      { id: 3, icon: '💼', name: '找工', type: 'job', bgColor: '#E8F8E8' },
      { id: 4, icon: '🛒', name: '二手', type: 'secondhand', bgColor: '#FDE8F0' }
    ],
    kingkongRow2: [
      { id: 5, icon: '🏠', name: '租房', type: 'rent', bgColor: '#E8E8FD' },
      { id: 6, icon: '🎉', name: '组局', type: 'party', bgColor: '#FDF3E8' },
      { id: 7, icon: '🙋', name: '求助', type: 'help', bgColor: '#FDE8E8' },
      { id: 8, icon: '💬', name: '答疑', type: 'qa', bgColor: '#E8FDF5' }
    ],
    hotServices: [
      { id: 1, icon: '✈️', title: '机场接送', desc: '安全准时', bgColor: '#E8F4FD' },
      { id: 2, icon: '🚚', title: '学生搬家', desc: '价格实惠', bgColor: '#FFF3E8' },
      { id: 3, icon: '💼', title: '兼职推荐', desc: '靠谱岗位', bgColor: '#E8F8E8' },
      { id: 4, icon: '🏠', title: '租房信息', desc: '室友匹配', bgColor: '#E8E8FD' }
    ],
    infoList: [
      { id: 1, icon: '🪑', title: '出宜家书桌和办公椅，City自取', price: 50, time: '2小时前', nickname: '小明', category: '日常用品', bgColor: '#FFF3E0' },
      { id: 2, icon: '🚗', title: '2015年Toyota Corolla，低公里数，车况好', price: 8500, time: '5小时前', nickname: 'David', category: '二手车', bgColor: '#E8F5E9' },
      { id: 3, icon: '📱', title: 'iPhone 14 Pro 256GB 黑色，送壳膜', price: 1200, time: '8小时前', nickname: 'Lucy', category: '电子产品', bgColor: '#E3F2FD' },
      { id: 4, icon: '✈️', title: '7月25日奥克兰机场接机，东区方向', price: 0, time: '10小时前', nickname: '小张', category: '接机服务', bgColor: '#E8F4FD' },
      { id: 5, icon: '📦', title: '免费送闲置教材和笔记，Accounting/Finance', price: 0, time: '1天前', nickname: '学姐Amy', category: '免费赠送', bgColor: '#FCE4EC' },
      { id: 6, icon: '🖥️', title: '出MacBook Pro M2，几乎全新，有发票', price: 1800, time: '1天前', nickname: 'Tom', category: '电子产品', bgColor: '#E3F2FD' }
    ]
  },

  onLoad() {
    // 初始化显示列表
    this.setData({ displayList: this.data.infoList });
  },

  onSearchInput(e) {
    const keyword = e.detail.value.trim();
    this.setData({ searchKeyword: keyword });

    if (!keyword) {
      // 空关键词，恢复全部
      this.setData({
        displayList: this.data.infoList,
        searchEmpty: false
      });
      return;
    }

    // 在标题、分类、昵称中模糊匹配
    const lowerKeyword = keyword.toLowerCase();
    const filtered = this.data.infoList.filter(item => {
      return item.title.toLowerCase().includes(lowerKeyword) ||
             item.category.toLowerCase().includes(lowerKeyword) ||
             item.nickname.toLowerCase().includes(lowerKeyword);
    });

    this.setData({
      displayList: filtered,
      searchEmpty: filtered.length === 0
    });
  },

  onClearSearch() {
    this.setData({
      searchKeyword: '',
      displayList: this.data.infoList,
      searchEmpty: false
    });
  },

  onKingkongTap(e) {
    const type = e.currentTarget.dataset.type;
    if (type === 'secondhand') {
      wx.switchTab({ url: '/pages/market/list/list' });
    } else if (['pickup', 'moving', 'job', 'party', 'help'].includes(type)) {
      wx.switchTab({ url: '/pages/help/index/index' });
      // 通过全局变量传递类型参数
      const app = getApp();
      app.globalData.helpTabType = type;
    } else {
      wx.showToast({ title: '功能开发中', icon: 'none' });
    }
  },

  onInfoTap(e) {
    const id = e.currentTarget.dataset.id;
    wx.showToast({ title: `查看详情: 第${id}条`, icon: 'none' });
  },

  onPullDownRefresh() {
    wx.showToast({ title: '刷新成功', icon: 'none' });
    wx.stopPullDownRefresh();
  },

  onReachBottom() {
    wx.showToast({ title: '加载更多...', icon: 'none' });
  }
})
