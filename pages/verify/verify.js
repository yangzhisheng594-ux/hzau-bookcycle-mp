// pages/verify/verify.js
// 身份认证：发布书籍 / 发布求购的前置门槛。
// 后端 approvedRequired 中间件要求 verifyStatus === 'approved' 才能写操作，
// 未认证的用户提交时会拿到 403「请先完成企业微信身份认证」—— 所以必须先有这个页面，
// 否则用户填完整个表单才被挡回来，属于死路体验。
const { hasContact, copyAdminWechat } = require('../../utils/contact');

Page({
  data: {
    status: 'none',        // none | pending | approved | rejected
    rejectReason: '',
    proofImage: '',        // 已上传/已选择的凭证图
    localProofPath: '',    // 本地待上传路径
    submittedImage: '',    // 服务端已有的凭证图
    submitting: false,
    loading: true,
    hasContact: false,

    statusTitle: '未认证',
    statusDesc: '完成华农身份认证后即可发布书籍与求购信息',
    statusTone: 'pending'
  },

  onLoad: function () {
    this.setData({ hasContact: hasContact() });
    this.loadStatus();
  },

  onShow: function () {
    // 提交后返回本页时刷新，能看到最新审核状态
    if (this.needRefresh) {
      this.needRefresh = false;
      this.loadStatus();
    }
  },

  loadStatus: function () {
    this.setData({ loading: true });
    // 本地已有登录态时，先用全局缓存渲染，再拉接口校正
    const app = getApp();
    const cached = (app && app.globalData && app.globalData.userInfo) || wx.getStorageSync('userInfo') || null;
    if (cached && cached.verifyStatus) this.applyStatus(cached.verifyStatus, cached.rejectReason || '');

    wx.cloud.callFunction({ name: 'getMyVerification' })
      .then(res => {
        const result = (res && res.result) || {};
        if (!result.success || !result.data) throw new Error(result.message || '获取认证状态失败');
        const d = result.data || {};
        this.applyStatus(d.verifyStatus || 'none', d.rejectReason || '');
        if (d.proofImage) this.setData({ submittedImage: d.proofImage, proofImage: d.proofImage });
        // 同步回全局，个人中心等页面能立刻反映最新状态
        if (app && app.globalData) {
          app.globalData.userInfo = Object.assign({}, app.globalData.userInfo, {
            verifyStatus: d.verifyStatus || 'none',
            rejectReason: d.rejectReason || ''
          });
          const stored = wx.getStorageSync('userInfo') || {};
          stored.verifyStatus = d.verifyStatus || 'none';
          stored.rejectReason = d.rejectReason || '';
          wx.setStorageSync('userInfo', stored);
        }
      })
      .catch(err => {
        console.warn('[Verify] 获取认证状态失败:', err);
      })
      .then(() => this.setData({ loading: false }));
  },

  // 状态 → 文案映射，集中在一处便于维护
  applyStatus: function (status, rejectReason) {
    const map = {
      none:     { title: '未认证',   desc: '完成华农身份认证后即可发布书籍与求购信息', tone: 'pending' },
      pending:  { title: '审核中',   desc: '已提交认证材料，管理员审核通过后即可发布', tone: 'pending' },
      approved: { title: '已认证',   desc: '认证已通过，现在可以发布书籍与求购信息了', tone: 'ok' },
      rejected: { title: '未通过',   desc: '认证材料未通过审核，请重新提交', tone: 'bad' }
    };
    const item = map[status] || map.none;
    this.setData({
      status: status,
      rejectReason: rejectReason || '',
      statusTitle: item.title,
      statusDesc: item.desc,
      statusTone: item.tone
    });
  },

  chooseProof: function () {
    if (this.data.status === 'pending' || this.data.status === 'approved') return;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: res => {
        const file = (res.tempFiles || [])[0];
        if (!file || !file.tempFilePath) return;
        this.setData({ localProofPath: file.tempFilePath, proofImage: file.tempFilePath });
      },
      fail: () => { /* 用户取消，不提示 */ }
    });
  },

  previewProof: function () {
    const src = this.data.proofImage;
    if (!src) return;
    wx.previewImage({ urls: [src], current: src });
  },

  removeProof: function () {
    if (this.data.status === 'pending' || this.data.status === 'approved') return;
    this.setData({ localProofPath: '', proofImage: '', submittedImage: '' });
  },

  submit: function () {
    const local = this.data.localProofPath;
    if (!local) {
      wx.showToast({ title: '请先上传学生证或校园卡截图', icon: 'none' });
      return;
    }
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中…', mask: true });

    const finish = () => { wx.hideLoading(); this.setData({ submitting: false }); };

    wx.cloud.uploadFile({ filePath: local })
      .then(up => {
        const url = up && (up.fileID || up.url);
        if (!url) throw new Error((up && up.errMsg) || '截图上传失败，请重试');
        return wx.cloud.callFunction({ name: 'submitVerification', data: { proofImage: url } });
      })
      .then(res => {
        const result = (res && res.result) || {};
        if (!result.success) throw new Error(result.message || '提交失败');
        finish();
        this.needRefresh = true;
        wx.showToast({ title: '已提交，等待审核', icon: 'success' });
        this.setData({ localProofPath: '', status: 'pending', statusTitle: '审核中',
          statusDesc: '已提交认证材料，管理员审核通过后即可发布', statusTone: 'pending' });
      })
      .catch(err => {
        finish();
        wx.showToast({ title: (err && err.message) || '提交失败，请重试', icon: 'none', duration: 2500 });
      });
  },

  copyWechat: function () {
    copyAdminWechat();
  },

  goBack: function () {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/profile/profile' }) });
  },

  goPublish: function () {
    wx.navigateTo({ url: '/pages/publish/publish' });
  }
});
