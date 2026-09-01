const marketCloud = require('../../utils/market-cloud');
const userCloud = require('../../utils/user-cloud');
const marketOptions = require('../../utils/market-options');
const contentPolicy = require('../../utils/content-policy');

Page({
  data: {
    // 编辑模式
    editId: null,
    isEdit: false,

    // 发布类型: 'market' 或 'service'
    publishType: 'market',
    serviceCategory: '',

    // 图片
    images: [],
    thumbnail: '',
    thumbnailSource: '',
    videoPath: '',

    // 表单
    title: '',
    description: '',
    categoryText: '',
    subCategory: '',
    categoryOptions: marketOptions.CATEGORIES,
    serviceCategoryOptions: ['接机', '搬家', '找工', '组局', '求助', '租房', '拼车', '代购'],
    price: '',
    contact: '',
    condition: '',
    conditionOptions: marketOptions.CONDITIONS,
    region: '',
    regionOptions: marketOptions.REGIONS,
    deliveryMethod: '',
    deliveryOptions: marketOptions.DELIVERY_METHODS,

    // 仅预留字段，第一阶段不请求 AI 服务。
    aiMetadata: {
      schemaVersion: 1,
      status: 'reserved',
      recognizedLabels: [],
      generatedTitle: '',
      suggestedCategory: '',
      generatedDescription: '',
      estimatedPriceMin: 0,
      estimatedPriceMax: 0,
      currency: 'NZD'
    },

    promiseReal: false,

    // 提交状态
    submitting: false
  },

  onLoad(options) {
    this._submitInFlight = false;
    this._submissionId = `publish_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    // 编辑模式
    if (options && options.editId) {
      const rawEditId = decodeURIComponent(options.editId);
      this.loadCloudEditItem(rawEditId);
      return;
    }

    if (options && options.type === 'service') {
      const cat = options.category ? decodeURIComponent(options.category) : '';
      const serviceCats = ['接机', '搬家', '找工', '组局', '求助', '租房', '拼车', '代购'];
      this.setData({
        publishType: 'service',
        serviceCategory: cat,
        categoryText: serviceCats.includes(cat) ? cat : ''
      });
    }
    // 也支持从 globalData 获取
    const app = getApp();
    if (app.globalData.publishServiceType) {
      const cat = app.globalData.publishServiceType;
      const serviceCats = ['接机', '搬家', '找工', '组局', '求助', '租房', '拼车', '代购'];
      this.setData({
        publishType: 'service',
        serviceCategory: cat,
        categoryText: serviceCats.includes(cat) ? cat : ''
      });
      app.globalData.publishServiceType = null;
    }
  },

  async loadCloudEditItem(editId) {
    wx.showLoading({ title: '读取发布…', mask: true });
    try {
      const item = await marketCloud.getOwnedItem(editId);
      if (!item) throw new Error('发布不存在');
      this.setData({
        editId,
        isEdit: true,
        title: item.title || '',
        description: item.description || '',
        categoryText: item.category || '',
        subCategory: item.subCategory || '',
        price: String(item.price || ''),
        contact: item.contact || '',
        condition: item.condition || '',
        region: item.region || '',
        deliveryMethod: item.deliveryMethod || '',
        aiMetadata: item.aiMetadata || this.data.aiMetadata,
        images: item.images || [],
        thumbnail: item.thumbnail || '',
        thumbnailSource: item.thumbnailSource || (item.images && item.images[0]) || '',
        videoPath: item.videoPath || '',
        promiseReal: !!item.promiseReal,
        publishType: item.publishType === 'service' ? 'service' : 'market',
        serviceCategory: item.publishType === 'service' ? (item.category || '') : ''
      });
      wx.setNavigationBarTitle({ title: item.publishType === 'service' ? '编辑服务' : '编辑商品' });
    } catch (error) {
      wx.showModal({
        title: '无法编辑',
        content: marketCloud.getErrorMessage(error),
        showCancel: false,
        success: () => wx.navigateBack()
      });
    } finally {
      wx.hideLoading();
    }
  },

  // ========== 图片选择 ==========
  onChooseImage() {
    const remain = 9 - this.data.images.length;
    wx.chooseImage({
      count: remain,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const newImages = this.data.images.concat(res.tempFilePaths);
        this.setData({ images: newImages });
      }
    });
  },

  onDeleteImage(e) {
    const idx = e.currentTarget.dataset.index;
    const images = this.data.images;
    images.splice(idx, 1);
    this.setData({ images });
  },

  onChooseVideo() {
    wx.chooseVideo({ sourceType:['album','camera'], maxDuration:60, compressed:true,
      success:(res)=>{ this.setData({ videoPath: res.tempFilePath }); } });
  },
  onDeleteVideo() { this.setData({ videoPath: '' }); },

  // ========== 表单输入 ==========
  onTitleInput(e) { this.setData({ title: e.detail.value }); },
  onDescInput(e) { this.setData({ description: e.detail.value }); },
  onPriceInput(e) {
    this.setData({ price: e.detail.value });
  },
  onContactInput(e) { this.setData({ contact: e.detail.value }); },
  onConditionChange(e) { this.setData({ condition: this.data.conditionOptions[Number(e.detail.value)] || '' }); },
  onRegionChange(e) { this.setData({ region: this.data.regionOptions[Number(e.detail.value)] || '' }); },
  onDeliveryChange(e) { this.setData({ deliveryMethod: this.data.deliveryOptions[Number(e.detail.value)] || '' }); },

  onCategoryChange(e) {
    const idx = e.detail.value;
    if (this.data.publishType === 'service') {
      const cat = this.data.serviceCategoryOptions[idx];
      this.setData({ categoryText: cat });
    } else {
      this.setData({ categoryText: this.data.categoryOptions[idx] });
    }
  },

  onTogglePromise() { this.setData({ promiseReal: !this.data.promiseReal }); },

  // ========== 提交发布 ==========
  onSubmit() {
    if (this._submitInFlight || this.data.submitting) return;
    const userInfo = wx.getStorageSync('userInfo') || {};
    if (!userCloud.isSignedIn(userInfo)) {
      wx.showModal({
        title: '请先登录',
        content: '发布真实信息前，请先绑定微信手机号并确认头像昵称。',
        confirmText: '去登录',
        success: (res) => {
          if (res.confirm) wx.reLaunch({ url: '/pages/auth/index' });
        }
      });
      return;
    }
    if (this.data.images.length === 0) { wx.showToast({ title: '请至少上传一张图片', icon: 'none' }); return; }
    const title = this.data.title.trim();
    if (!title) { wx.showToast({ title: '请输入标题', icon: 'none' }); return; }
    const desc = this.data.description.trim();
    if (!desc) { wx.showToast({ title: '请输入描述', icon: 'none' }); return; }
    if (!this.data.categoryText) { wx.showToast({ title: '请选择分类', icon: 'none' }); return; }
    const price = parseFloat(this.data.price);
    if (!this.data.price || isNaN(price) || price < 0) { wx.showToast({ title: '请输入有效价格', icon: 'none' }); return; }
    const contact = this.data.contact.trim();
    if (this.data.publishType === 'service' && !contact) { wx.showToast({ title: '请输入联系方式', icon: 'none' }); return; }
    if (this.data.publishType === 'market' && !this.data.condition) { wx.showToast({ title: '请选择新旧程度', icon: 'none' }); return; }
    if (this.data.publishType === 'market' && !this.data.region) { wx.showToast({ title: '请选择大概区域', icon: 'none' }); return; }
    if (this.data.publishType === 'market' && !this.data.deliveryMethod) { wx.showToast({ title: '请选择交付方式', icon: 'none' }); return; }

    const subCat = this.data.publishType === 'service'
      ? (this.data.subCategory || '')
      : (this.data.subCategory || this.getDefaultSubCategory(this.data.categoryText));

    const policyMessage = contentPolicy.getValidationMessage({ title, description: desc, category: this.data.categoryText, subCategory: subCat });
    if (policyMessage) { wx.showModal({ title: '无法发布', content: policyMessage, showCancel: false }); return; }

    this._submitInFlight = true;
    this.setData({ submitting: true });
    wx.showLoading({ title: this.data.isEdit ? '保存中...' : '发布中...', mask: true });

    const isService = this.data.publishType === 'service';
    const newItemId = Date.now();
    const itemType = isService ? 'service' : 'product';
    const newItem = {
      id: newItemId, title, description: desc,
      category: this.data.categoryText, price, contact,
      subCategory: subCat,
      condition: isService ? '' : this.data.condition,
      region: isService ? '' : this.data.region,
      deliveryMethod: isService ? '' : this.data.deliveryMethod,
      images: this.data.images.slice(),
      thumbnail: this.data.thumbnail || '',
      thumbnailSource: this.data.thumbnailSource || '',
      videoPath: this.data.videoPath || '',
      time: '刚刚', nickname: userInfo.nickName || '我', avatar: userInfo.avatarUrl || '👤',
      publisherNick: userInfo.nickName || '',
      publisherAvatar: userInfo.avatarUrl || '',
      icon: '📦', bgColor: '#FFF3E0',
      promiseReal: this.data.promiseReal,
      publishType: isService ? 'service' : 'market',
      itemType,
      source: 'published',
      itemKey: `published:${itemType}:${newItemId}`,
      clientRequestId: this._submissionId,
      aiMetadata: this.data.aiMetadata,
      createdAt: new Date().toISOString()
    };

    this.saveItemToCloud(newItem);
  },

  async saveItemToCloud(item) {
    try {
      await marketCloud.saveItem(item, this.data.isEdit ? this.data.editId : '');
      if (item.publishType === 'service') getApp().globalData.serviceNeedsRefresh = true;
      else getApp().globalData.marketNeedsRefresh = true;
      wx.hideLoading();
      wx.vibrateShort({ type: 'light' });
      this.setData({ submitting: false });
      wx.showToast({ title: this.data.isEdit ? '修改成功！' : '发布成功！', icon: 'success', duration: 1500 });
      setTimeout(() => { wx.navigateBack(); }, 1500);
    } catch (error) {
      wx.hideLoading();
      this._submitInFlight = false;
      this.setData({ submitting: false });
      wx.showModal({
        title: '真实发布失败',
        content: marketCloud.getErrorMessage(error),
        showCancel: false
      });
    }
  },

  getDefaultSubCategory(category) {
    const map = {
      '交通工具': '汽车', '电子产品': '手机/平板', '生活家居': '家具',
      '学习用品': '课本/教材', '运动户外': '运动鞋', '服饰美妆': '衣物',
      '宠物用品': '猫用品', '乐器': '吉他/尤克里里', '游戏娱乐': '游戏机/游戏',
      '其他': '其他闲置'
    };
    return map[category] || '其他闲置';
  }
})
