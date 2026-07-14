Page({
  data: {
    tabs: ['全部', '日常用品', '二手车', '电子产品'],
    currentTab: 0,
    items: [
      { id: 1, icon: '🪑', title: '宜家书桌+办公椅套装，9成新，City自取', price: 50, time: '2小时前', nickname: '小明', category: '日常用品', bgColor: '#FFF3E0', avatar: '👤' },
      { id: 2, icon: '🚗', title: '2015 Toyota Corolla 1.8L，12万公里，新WOF', price: 8500, time: '3小时前', nickname: 'David', category: '二手车', bgColor: '#E8F5E9', avatar: '👤' },
      { id: 3, icon: '📱', title: 'iPhone 14 Pro 256GB 暗紫色，送原装壳膜', price: 1200, time: '5小时前', nickname: 'Lucy', category: '电子产品', bgColor: '#E3F2FD', avatar: '👤' },
      { id: 4, icon: '📚', title: 'NZCEL Lv4/5 全套教材+笔记，几乎全新', price: 30, time: '6小时前', nickname: '学姐Amy', category: '日常用品', bgColor: '#FCE4EC', avatar: '👤' },
      { id: 5, icon: '🖥️', title: 'MacBook Pro 14寸 M2 Pro 16G/512G，用了不到半年', price: 2800, time: '8小时前', nickname: 'Tom', category: '电子产品', bgColor: '#E3F2FD', avatar: '👤' },
      { id: 6, icon: '🚙', title: '2018 Honda CR-V AWD，顶配，一键启动', price: 22000, time: '10小时前', nickname: 'Jack', category: '二手车', bgColor: '#E8F5E9', avatar: '👤' },
      { id: 7, icon: '🍳', title: '九阳豆浆机+电饭煲+空气炸锅打包出', price: 80, time: '12小时前', nickname: '小丽', category: '日常用品', bgColor: '#FFF3E0', avatar: '👤' },
      { id: 8, icon: '🎧', title: 'AirPods Pro 2代，全新未拆封', price: 350, time: '1天前', nickname: 'Kevin', category: '电子产品', bgColor: '#E3F2FD', avatar: '👤' }
    ],
    filteredList: []
  },

  onLoad() {
    this.filterItems(0);
  },

  onTabChange(e) {
    const index = e.currentTarget.dataset.index;
    this.setData({ currentTab: index });
    this.filterItems(index);
  },

  filterItems(tabIndex) {
    const categoryMap = ['全部', '日常用品', '二手车', '电子产品'];
    const category = categoryMap[tabIndex];
    let filtered = this.data.items;
    if (category !== '全部') {
      filtered = this.data.items.filter(item => item.category === category);
    }
    this.setData({ filteredList: filtered });
  },

  onItemTap(e) {
    const id = e.currentTarget.dataset.id;
    wx.showToast({ title: `查看详情: 第${id}条`, icon: 'none' });
  },

  onPublishTap() {
    wx.showToast({ title: '发布功能开发中', icon: 'none' });
  },

  onPullDownRefresh() {
    this.filterItems(this.data.currentTab);
    wx.stopPullDownRefresh();
    wx.showToast({ title: '刷新成功', icon: 'none' });
  },

  onReachBottom() {
    wx.showToast({ title: '加载更多...', icon: 'none' });
  }
})
