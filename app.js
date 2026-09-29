// app.js
const demoService = require('./utils/demoService');
App({
  onLaunch() {
    // 顺序很重要（两种模式）：
    // ① 中转模式（demoService.CLOUD_ENV_ID 已填）：先 wx.cloud.init 拿到真实云环境，
    //    再装转发层 —— 转发层会把 init 之后的"真实 callFunction"捕获下来，
    //    所有 wx.cloud.callFunction({name}) 被转成 callFunction('api') 云函数中转。
    // ② 直连模式（CLOUD_ENV_ID 为空）：直接装转发层，wx.request 打自建后端。
    //    ⚠️ WorkBuddy 托管网关拦微信 UA，此模式小程序端必 403，仅作兜底。
    if (demoService.CLOUD_ENV_ID && wx.cloud && typeof wx.cloud.init === 'function') {
      // 只有中转模式才允许 init：init 会重建 wx.cloud 对象，
      // 直连模式下调用它会把刚装的转发层冲掉（这是历史踩坑点）。
      wx.cloud.init({ env: demoService.CLOUD_ENV_ID, traceUser: false });
      console.log('[App] 云开发环境已连接：', demoService.CLOUD_ENV_ID);
    } else {
      console.log('[App] 未配置云环境，转发层走直连模式（小程序端会被托管网关 403）');
    }
    demoService.install();

    this.globalData.isDemoMode = demoService.isEnabled();
    this.checkUserLoginState();
  },

  globalData: {
    userInfo: null,
    isUserLoggedIn: null,
    sellListNeedRefresh: false,
    requestListNeedRefresh: false,
    cartNeedRefresh: false,
    isDemoMode: demoService.isEnabled(),
    // 新增：用于存储页面注册的登录状态回调函数
    pageLoginCallbacks: {}
  },

  // 注册页面登录状态回调
  registerLoginCallback: function (pageName, callback) {
    if (pageName && typeof callback === 'function') {
      this.globalData.pageLoginCallbacks[pageName] = callback;
      console.log(`[App.js] Page '${pageName}' registered login callback.`);
      // 如果注册时已经有登录状态，立即回调一次
      if (this.globalData.isUserLoggedIn !== null) { // 确保状态已确定（true或false）
        callback(this.globalData.isUserLoggedIn, this.globalData.userInfo);
      }
    }
  },

  // 注销页面登录状态回调
  unregisterLoginCallback: function (pageName) {
    if (pageName && this.globalData.pageLoginCallbacks[pageName]) {
      delete this.globalData.pageLoginCallbacks[pageName];
      console.log(`[App.js] Page '${pageName}' unregistered login callback.`);
    }
  },

  // 触发所有已注册页面的登录状态回调
  notifyPagesLoginStateChanged: function (isLoggedIn, userInfo) {
    console.log('[App.js] Notifying pages of login state change:', isLoggedIn);
    for (const pageName in this.globalData.pageLoginCallbacks) {
      if (typeof this.globalData.pageLoginCallbacks[pageName] === 'function') {
        this.globalData.pageLoginCallbacks[pageName](isLoggedIn, userInfo);
      }
    }
  },

  checkUserLoginState: function() {
    const userInfo = wx.getStorageSync('userInfo');
    const openidFromStorage = wx.getStorageSync('openid');

    if (userInfo && userInfo.user_id && openidFromStorage) {
      console.log('[App.js] User info found in storage, setting globalData.');
      this.globalData.userInfo = userInfo;
      this.globalData.isUserLoggedIn = true;
      this.notifyPagesLoginStateChanged(true, userInfo); // 通知页面
    } else {
      console.log('[App.js] No valid user info in storage, attempting to login silently.');
      this.doCloudLogin(null, true); // 静默登录
    }
  },

  doCloudLogin: function(userInfoFromWx = null, isSilent = false) {
    if (!isSilent && !this.isLoggingIn) { // 防止重复的非静默登录
        wx.showLoading({ title: '登录中...' });
        this.isLoggingIn = true; // 标记正在登录
    }

    // 自建后端沿用「openid 即账号」的免密登录：本地持久化一个设备标识当 openid。
    let clientId = wx.getStorageSync('openid');
    if (!clientId) {
      clientId = `mp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      wx.setStorageSync('openid', clientId);
    }

    return wx.cloud.callFunction({
      name: 'login',
      data: {
        clientId,
        nickName: (userInfoFromWx && userInfoFromWx.nickName) || '',
        avatarUrl: (userInfoFromWx && userInfoFromWx.avatarUrl) || ''
      }
    }).then(res => {
      if (!isSilent) { wx.hideLoading(); this.isLoggingIn = false; }
      console.log('[App.js] login result:', res);
      let isLoggedIn = false;
      let currentUserInfo = null;

      const payload = (res && res.result) || {};
      if (payload.success && payload.token) {
        wx.setStorageSync('token', payload.token);
        currentUserInfo = payload.userData || null;
        isLoggedIn = Boolean(currentUserInfo);
        if (currentUserInfo) wx.setStorageSync('userInfo', currentUserInfo);
        if (!isSilent) wx.showToast({ title: '登录成功', icon: 'success', duration: 1000 });
      } else {
        wx.removeStorageSync('userInfo');
        if (!isSilent && payload.message) {
          wx.showToast({ title: payload.message, icon: 'none' });
        } else if (!isSilent) {
          wx.showToast({ title: '登录失败', icon: 'none' });
        }
      }
      // 无论成功失败，都更新全局状态并通知页面
      this.globalData.userInfo = currentUserInfo;
      this.globalData.isUserLoggedIn = isLoggedIn;
      this.notifyPagesLoginStateChanged(isLoggedIn, currentUserInfo);
      return isLoggedIn;

    }).catch(err => {
      if (!isSilent) { wx.hideLoading(); this.isLoggingIn = false; }
      this.globalData.isUserLoggedIn = false;
      this.globalData.userInfo = null;
      // 注意：不要清 openid，它就是本机的账号标识，清了会变成新账号
      wx.removeStorageSync('userInfo');
      wx.removeStorageSync('token');
      console.error('[App.js] login error:', err);
      if (!isSilent) wx.showToast({ title: '登录请求失败', icon: 'none' });
      this.notifyPagesLoginStateChanged(false, null); // 通知页面登录失败
      return false;
    });
  }
})
