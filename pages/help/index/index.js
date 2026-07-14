Page({
  data: {
    tabs: ['接机', '搬家', '找工', '组局', '求助'],
    currentTab: 0,
    services: [
      { id: 1, icon: '✈️', title: '奥克兰机场→City接机', desc: '7月25日下午3点到达，需要接机服务，行李2个箱子，目的地在City Symonds St附近。', contact: '微信: akl_pickup', time: '2小时前', tag: '接机', category: '接机', bgColor: '#E8F4FD' },
      { id: 2, icon: '🚚', title: '中区搬家到北岸Albany', desc: '7月30日搬家，中区Mt Eden到北岸Albany，需要一辆面包车，东西不多主要是行李箱和几个收纳箱。', contact: '微信: mover_nz', time: '3小时前', tag: '搬家', category: '搬家', bgColor: '#FFF3E8' },
      { id: 3, icon: '💼', title: 'City餐馆招兼职服务员', desc: '中餐馆招兼职服务员，工作时间灵活，适合学生，有经验者优先，薪资面议。', contact: '电话: 021-xxx-xxx', time: '4小时前', tag: '找工', category: '找工', bgColor: '#E8F8E8' },
      { id: 4, icon: '🎉', title: '周末桌游局，缺2人', desc: '周六下午在City的Board Game Cafe组局，现有4人缺2人，新手友好，费用AA。', contact: '微信: boardgame_akl', time: '5小时前', tag: '组局', category: '组局', bgColor: '#FDF3E8' },
      { id: 5, icon: '🙋', title: '求推荐靠谱的会计中介', desc: '需要帮忙报税，求推荐奥克兰靠谱的华人会计，最好在City附近，谢谢！', contact: '微信: help_me_tax', time: '6小时前', tag: '求助', category: '求助', bgColor: '#FDE8E8' },
      { id: 6, icon: '✈️', title: '东区→机场送机，8月1日早班机', desc: '8月1日早上6点的航班，需要凌晨4点从东区Howick出发去机场，1人1行李。', contact: '微信: early_bird', time: '7小时前', tag: '接机', category: '接机', bgColor: '#E8F4FD' },
      { id: 7, icon: '💼', title: '西区仓库招周末帮工', desc: '西区Henderson仓库招周末帮工，整理货物，$22/h cash，体力活需要男生。', contact: '电话: 022-xxx-xxx', time: '9小时前', tag: '找工', category: '找工', bgColor: '#E8F8E8' },
      { id: 8, icon: '🚚', title: '北岸小型搬家，学生优惠', desc: '提供小型搬家服务，北岸地区$60起，学生优惠，van可以装双人床垫和家具。', contact: '微信: northshore_van', time: '11小时前', tag: '搬家', category: '搬家', bgColor: '#FFF3E8' }
    ],
    filteredList: []
  },

  onLoad(options) {
    // 支持从首页金刚区跳转时携带 type 参数
    const typeMap = { 'pickup': 0, 'moving': 1, 'job': 2, 'party': 3, 'help': 4 };
    let tabIndex = 0;

    if (options && options.type && typeMap[options.type] !== undefined) {
      tabIndex = typeMap[options.type];
    } else {
      // 尝试从全局变量获取
      const app = getApp();
      if (app.globalData.helpTabType && typeMap[app.globalData.helpTabType] !== undefined) {
        tabIndex = typeMap[app.globalData.helpTabType];
        app.globalData.helpTabType = null;
      }
    }

    this.setData({ currentTab: tabIndex });
    this.filterServices(tabIndex);
  },

  onTabChange(e) {
    const index = e.currentTarget.dataset.index;
    this.setData({ currentTab: index });
    this.filterServices(index);
  },

  filterServices(tabIndex) {
    const category = this.data.tabs[tabIndex];
    const filtered = this.data.services.filter(item => item.category === category);
    this.setData({ filteredList: filtered });
  },

  onServiceTap(e) {
    const id = e.currentTarget.dataset.id;
    wx.showToast({ title: `查看详情: 第${id}条`, icon: 'none' });
  },

  onPublishTap() {
    wx.showToast({ title: '发布功能开发中', icon: 'none' });
  },

  onPullDownRefresh() {
    this.filterServices(this.data.currentTab);
    wx.stopPullDownRefresh();
    wx.showToast({ title: '刷新成功', icon: 'none' });
  },

  onReachBottom() {
    wx.showToast({ title: '加载更多...', icon: 'none' });
  }
})
