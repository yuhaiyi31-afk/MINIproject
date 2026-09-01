const POLICIES = {
  terms: {
    title: 'Terms of Use',
    subtitle: '用户协议（MVP 结构版）',
    sections: [
      { heading: '平台定位', body: '平台仅提供新西兰本地信息发布、发现和联系撮合服务，不是交易款项的收款方、托管方或担保方。' },
      { heading: '用户责任', body: '用户应确保发布内容和交易行为真实、合法，不得冒用他人身份，不得发布禁售或侵权内容。' },
      { heading: '交易方式', body: '商品款由买卖双方自行完成，平台不提供钱包、充值、代收款、托管、自动分账、担保、退款或赔付。' },
      { heading: '平台治理', body: '平台可以根据举报和安全风险暂停、下架或删除内容，并限制违规账号使用。正式法律文本上线前可替换本页面内容。' }
    ]
  },
  privacy: {
    title: 'Privacy Policy',
    subtitle: '隐私政策（MVP 结构版）',
    sections: [
      { heading: '最小化收集', body: '仅保存登录、发布、收藏、聊天和安全治理所需的数据。不会主动要求身份证、护照、银行卡、精确家庭住址、人脸信息或完整学生证照片。' },
      { heading: '地区信息', body: '商品只保存用户选择的大概区域，不要求或公开门牌号及精确家庭地址。' },
      { heading: '使用目的', body: '头像、昵称和必要账号标识用于登录、沟通、展示发布者信息、防止滥用及处理举报。手机号如获授权，仅用于身份验证，完整号码不公开。' },
      { heading: '数据保留', body: '普通删除会清理商品媒体并保留最小状态记录；违规、举报和管理员处置记录可为安全追踪而保留。' }
    ]
  },
  community: {
    title: 'Community Guidelines',
    subtitle: '社区规范',
    sections: [
      { heading: '真实友善', body: '请如实描述商品状况、价格和交付方式，尊重其他用户，禁止骚扰、辱骂、欺诈和恶意引流。' },
      { heading: '合法交易', body: '不得发布违法、侵权、危险或明显不适合社区交易的商品和服务。' },
      { heading: '处理方式', body: '用户可举报商品或卖家、拉黑用户；管理员可暂停或软删除内容并封禁严重违规账号。' }
    ]
  },
  prohibited: {
    title: 'Prohibited Items Policy',
    subtitle: '禁售物品政策',
    sections: [
      { heading: '明确禁止', body: '禁止毒品、非法武器和弹药、处方药、盗窃物、假证件、明显仿冒商品、色情或违法服务，以及其他法律禁止交易的商品或服务。' },
      { heading: '自动与人工治理', body: '发布时会进行敏感关键词检查；漏网内容可由用户举报，管理员可以暂停、软删除内容或封禁账号。' },
      { heading: '不确定时', body: '如无法确认商品是否合法合规，请不要发布，并先咨询适用的专业或监管机构。' }
    ]
  },
  safety: {
    title: 'Safety Guidelines',
    subtitle: '安全交易指南',
    sections: [
      { heading: '付款安全', body: '平台不代收款。优先选择公共场所当面验货，确认无误后付款，勿因催促而提前转账。' },
      { heading: '保护隐私', body: '不要在商品描述或聊天中发送身份证、银行卡、密码、验证码、精确家庭住址等敏感信息。' },
      { heading: '发现风险', body: '遇到诈骗、违禁品、虚假信息或骚扰时立即停止交易，保留必要证据并使用举报和拉黑功能。' }
    ]
  }
};

Page({
  data: { policy: POLICIES.terms },
  onLoad(options) {
    const type = options && POLICIES[options.type] ? options.type : 'terms';
    const policy = POLICIES[type];
    this.setData({ policy });
    wx.setNavigationBarTitle({ title: policy.title });
  }
});
