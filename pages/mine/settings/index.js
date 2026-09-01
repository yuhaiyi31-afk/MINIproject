const userCloud = require('../../../utils/user-cloud');

Page({
  data: {
    isLoggedIn: false,
    nickName: ""
  },

  onShow: function() {
    var userInfo = wx.getStorageSync("userInfo");
    if (userCloud.isSignedIn(userInfo)) {
      this.setData({ isLoggedIn: true, nickName: userInfo.nickName });
    } else {
      this.setData({ isLoggedIn: false, nickName: "" });
    }
  },

  onLogout: function() {
    var that = this;
    wx.showModal({
      title: "提示",
      content: "确定退出登录？",
      success: function(res) {
        if (res.confirm) {
          wx.removeStorageSync("userInfo");
          wx.setStorageSync("userSessionDisabled", true);
          wx.removeStorageSync("userProfileSyncedAtV2");
          wx.removeStorageSync("mineStatsCacheV1");
          getApp().globalData.userInfo = null;
          getApp()._profileSyncedAt = 0;
          that.setData({ isLoggedIn: false, nickName: "" });
          wx.showToast({ title: "已退出", icon: "none" });
          setTimeout(function() {
            wx.reLaunch({ url: "/pages/auth/index" });
          }, 1000);
        }
      }
    });
  },

  onClearCache: function() {
    wx.showModal({
      title: "提示",
      content: "确定清除所有数据？",
      success: function(res) {
        if (res.confirm) {
          var keys = ["publishedItems","marketItems","favorites","reports","searchHistory","rentItems","chatConversations","messageNotifications"];
          for (var i = 0; i < keys.length; i++) {
            wx.removeStorageSync(keys[i]);
          }
          wx.showToast({ title: "已清理", icon: "success" });
        }
      }
    });
  },

  onBlockedUsers: function() {
    wx.navigateTo({ url: '/pages/mine/blocked-users/index' });
  },

  onPolicyTap: function(e) {
    var type = e.currentTarget.dataset.type || 'terms';
    wx.navigateTo({ url: '/pages/policies/index?type=' + encodeURIComponent(type) });
  }
});
