// pages/profile/profile.js
const app = getApp();

Page({
  data: {
    userInfo: {}, // 将使用 MySQL 返回的字段名, e.g., nick_name, avatar_url
    isLoggedIn: false,
    orderCounts: { pendingPayment: 0, pendingShipment: 0, pendingReceipt: 0 },
    recommendedBooks: [],
    isLoadingRecommendations: false,
    verifyTitle: '未认证 · 发布前需认证',
    verifyTone: 'pending'
  },

  onLoad() {
    app.registerLoginCallback('profilePage', () => this.checkLoginStatusAndLoadData());
  },

  onShow: function () {
    this.checkLoginStatusAndLoadData();
  },

  async checkLoginStatusAndLoadData() {
    // 从 globalData 获取登录状态和用户信息
    // app.js 中的 checkUserLoginState 会优先尝试从缓存恢复
    // 如果 app.js 还在进行异步登录，这里可能拿到旧状态，所以 onShow 多次检查是好的
    const isLoggedIn = app.globalData.isUserLoggedIn;
    const userInfoFromGlobal = app.globalData.userInfo;

    console.log('[ProfilePage] onShow - isLoggedIn from globalData:', isLoggedIn, 'UserInfo from globalData:', userInfoFromGlobal);

    this.setData({
        isLoggedIn: isLoggedIn,
        // 使用 MySQL 返回的字段名
        userInfo: userInfoFromGlobal && userInfoFromGlobal.user_id ?
                  { nickName: userInfoFromGlobal.nick_name, avatarUrl: userInfoFromGlobal.avatar_url, ...userInfoFromGlobal } :
                  {}
    });
    this.applyVerifyState(userInfoFromGlobal);

    if (isLoggedIn) {
      // 如果全局 userInfo 不完整（例如只有 openid），可以尝试从服务器加载
      if (!userInfoFromGlobal || !userInfoFromGlobal.nick_name) { // 检查 nick_name 是否存在
          console.log('[ProfilePage] Global userInfo might be incomplete, attempting to load from server.');
          await this.loadUserProfileFromServer(); // 确保这个函数也使用 MySQL
      }
      this.loadOrderCounts();
      this.loadRecommendations();
    } else {
        this.setData({ // 未登录时清空
            userInfo: {},
            orderCounts: { pendingPayment: 0, pendingShipment: 0, pendingReceipt: 0 },
            recommendedBooks: []
        });
    }
  },

  async loadUserProfileFromServer() {
    // 这个函数应该调用一个从 MySQL 获取用户信息的云函数，
    // 比如 'getUserProfile'，该云函数内部根据 openid (或 user_id) 从 MySQL users 表查询
    if (!app.globalData.isUserLoggedIn || !app.globalData.userInfo || !app.globalData.userInfo.open_id) {
        console.log('[ProfilePage] Cannot load user profile from server: not logged in or open_id missing.');
        return;
    }
    // 如果 globalData.userInfo 已经有 nick_name, avatar_url 等，可以考虑不重复加载，或只在特定情况加载
    // if (this.data.userInfo && this.data.userInfo.nickName) {
    //     console.log('[ProfilePage] User profile already seems loaded, skipping server fetch.');
    //     return;
    // }

    wx.showLoading({ title: '加载信息...' });
    try {
      // 假设 getUserProfile 云函数也已修改为从 MySQL 获取数据
      const res = await wx.cloud.callFunction({ name: 'getUserProfile' }); // getUserProfile 也需要改成用 MySQL
      wx.hideLoading();
      if (res.result && res.result.success && res.result.data) {
        const serverUserInfo = res.result.data; // 应该是 MySQL 字段
        this.setData({
            userInfo: { nickName: serverUserInfo.nick_name, avatarUrl: serverUserInfo.avatar_url, ...serverUserInfo }
        });
        app.globalData.userInfo = serverUserInfo;
        wx.setStorageSync('userInfo', serverUserInfo);
        console.log('User profile reloaded from server (MySQL):', serverUserInfo);
      } else {
        console.warn('从服务器获取用户信息失败 (MySQL):', res.result ? res.result.message : 'No result');
      }
    } catch (err) {
      wx.hideLoading();
      console.error('调用 getUserProfile 云函数失败 (MySQL):', err);
    }
  },

  async loadOrderCounts() {
    try {
      const res = await wx.cloud.callFunction({ name: 'getOrderCounts' });
      if (res.result && res.result.success) this.setData({ orderCounts: res.result.data });
    } catch (error) {
      console.warn('[ProfilePage] Failed to load order counts:', error);
    }
  },

  async loadRecommendations() {
    if (this.data.isLoadingRecommendations) return;
    this.setData({ isLoadingRecommendations: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'getBooks',
        data: { type: 'bestseller', page: 1, pageSize: 3 }
      });
      if (!res.result || !res.result.success) throw new Error((res.result && res.result.message) || '推荐加载失败');
      const recommendedBooks = (res.result.data || []).slice(0, 3).map(book => ({
        ...book,
        recommendationReason: book.courseCode ? `${book.courseCode} · 课程推荐` : '校园热门教材'
      }));
      this.setData({ recommendedBooks });
    } catch (error) {
      console.warn('[ProfilePage] Failed to load recommendations:', error);
    } finally {
      this.setData({ isLoadingRecommendations: false });
    }
  },

  handleLoginTap: async function() {
    if (this.data.isLoggedIn) {
      wx.showToast({ title: '您已登录', icon: 'none' });
      return;
    }
    // 调用 app.js 中的登录方法
    const loggedIn = await app.doCloudLogin(null, false);
    if (loggedIn) this.checkLoginStatusAndLoadData();
    // 登录成功后，app.js 会更新 globalData，onShow 会检测到变化并更新页面
    // 为了更即时响应，可以在 app.doCloudLogin 的 Promise resolve 后再次调用 checkLoginStatusAndLoadData
    // 但通常 app.loginStateCallback 机制配合 onShow 已经足够
  },

  onGetUserInfo: async function(e) {
    // 这个函数主要用于获取用户在微信端的昵称头像，并尝试更新到后端数据库
    // 需要用户主动点击 <button open-type="getUserInfo"> (在新版基础库中，此API受限，推荐使用头像昵称填写能力)
    if (e.detail.userInfo) {
      const wxUserInfo = e.detail.userInfo;
      console.log('[ProfilePage] Got wxUserInfo:', wxUserInfo);

      // 调用 app.js 中的登录/更新方法，并传递微信用户信息
      // app.doCloudLogin 会将 userInfoFromWx 传递给 login 云函数
      // login 云函数内部逻辑会判断是新建用户还是更新用户信息
      app.doCloudLogin({
        nickName: wxUserInfo.nickName,
        avatarUrl: wxUserInfo.avatarUrl
      }, false);
      // 登录/更新完成后，onShow 或 loginStateCallback 会刷新页面数据
    } else {
      wx.showToast({ title: '授权获取微信信息失败', icon: 'none' });
    }
  },

  // 身份认证状态 → 卡片文案（未通过时常驻提醒，通过后弱化）
  applyVerifyState(userInfo) {
    const status = (userInfo && userInfo.verifyStatus) || 'none';
    const map = {
      none:     { title: '未认证 · 发布前需认证', tone: 'pending' },
      pending:  { title: '审核中', tone: 'pending' },
      approved: { title: '已认证', tone: 'ok' },
      rejected: { title: '未通过 · 点击重新提交', tone: 'bad' }
    };
    const item = map[status] || map.none;
    this.setData({ verifyTitle: item.title, verifyTone: item.tone });
  },

  navigateToVerify: function () {
    wx.navigateTo({ url: '/pages/verify/verify' });
  },

  navigateToEditProfile: function() { wx.navigateTo({ url: '/pages/editProfile/editProfile' }); },
  navigateToOrderList: function(e) {
    const status = e.currentTarget.dataset.status || 'all';
    wx.navigateTo({ url: `/pages/orderList/orderList?status=${status}` });
  },

  openRecommendation: function(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/bookDetail/bookDetail?id=${id}` });
  },

  logout: function() {
    wx.showModal({
      title: '提示',
      content: '确定要退出登录吗？',
      success: async (res) => {
        if (res.confirm) {
          app.globalData.userInfo = null;
          app.globalData.isUserLoggedIn = false; // 确保设置isUserLoggedIn
          // app.globalData.openid = null; // 如果你之前在 globalData 中存了 openid
          wx.removeStorageSync('userInfo');
          wx.removeStorageSync('openid');

          this.setData({ // 直接更新页面状态
            userInfo: {},
            isLoggedIn: false,
            orderCounts: { pendingPayment: 0, pendingShipment: 0, pendingReceipt: 0 }
          });
          wx.showToast({ title: '已退出', icon: 'success' });
          app.notifyPagesLoginStateChanged(false, null);
        }
      }
    });
  },

  onUnload() {
    app.unregisterLoginCallback('profilePage');
  }
});
