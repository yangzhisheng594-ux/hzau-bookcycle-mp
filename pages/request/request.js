// pages/request/request.js
const app = getApp();
const PAGE_NAME_REQUEST = 'requestPage'; // 定义页面名称

Page({
  data: {
    myRequests: [],
    hasMoreRequests: true,
    requestPage: 1,
    requestPageSize: 10,
    isLoadingRequests: false,
    isLoggedIn: false,
    // appLoginCallbackId 不再需要，使用 PAGE_NAME_REQUEST
  },

  onLoad: function (options) {
    // 注册登录状态回调
    app.registerLoginCallback(PAGE_NAME_REQUEST, this.handleLoginStateChange);

    // onLoad 时也根据当前 app.globalData 初始化登录状态并决定是否加载数据
    this.setData({ isLoggedIn: app.globalData.isUserLoggedIn });
    if (app.globalData.isUserLoggedIn) {
      console.log(`[${PAGE_NAME_REQUEST}] onLoad: User logged in, loading initial requests.`);
      this.loadMyRequests(true); // 首次加载
    } else {
      console.log(`[${PAGE_NAME_REQUEST}] onLoad: User not logged in initially.`);
      this.setData({ myRequests: [], hasMoreRequests: false, requestPage: 1 }); // 未登录则清空
    }
  },

  onShow: function() {
    console.log(`[${PAGE_NAME_REQUEST}] onShow. Current isLoggedIn state:`, this.data.isLoggedIn);
    // 每次显示时，确保登录状态与全局同步
    this.setData({ isLoggedIn: app.globalData.isUserLoggedIn });

    if (this.data.isLoggedIn) {
        // 如果需要刷新 (例如从发布求购页返回) 或者列表为空且不在加载中
        if (app.globalData.requestListNeedRefresh || (this.data.myRequests.length === 0 && !this.data.isLoadingRequests)) {
            console.log(`[${PAGE_NAME_REQUEST}] Refreshing my requests in onShow.`);
            this.loadMyRequests(true); // true 表示刷新，会重置页码和数据
            if(app.globalData.requestListNeedRefresh) app.globalData.requestListNeedRefresh = false;
        }
    } else {
        // 未登录，确保列表为空
        this.setData({ myRequests: [], hasMoreRequests: false, requestPage: 1 });
    }
  },

  // 由 app.js 调用的登录状态处理函数
  handleLoginStateChange: function(isLoggedIn, userInfo) {
    console.log(`[${PAGE_NAME_REQUEST}] handleLoginStateChange called. isLoggedIn:`, isLoggedIn);
    const previousIsLoggedIn = this.data.isLoggedIn;
    this.setData({ isLoggedIn: isLoggedIn });

    if (isLoggedIn) {
      // 仅当登录状态从“未登录”变为“已登录”时，或者列表为空且不在加载中，才主动加载
      if ((!previousIsLoggedIn || this.data.myRequests.length === 0) && !this.data.isLoadingRequests) {
          console.log(`[${PAGE_NAME_REQUEST}] Loading my requests due to login state change or empty list.`);
          this.loadMyRequests(true);
      }
    } else {
      this.setData({
        myRequests: [],
        hasMoreRequests: false,
        requestPage: 1
      });
    }
  },

  // 加载我的求购数据
  loadMyRequests: async function(refresh = false) {
    if (!this.data.isLoggedIn) {
      console.log(`[${PAGE_NAME_REQUEST}] User not logged in. 'My Requests' will not be loaded.`);
      this.setData({ myRequests: [], hasMoreRequests: false, requestPage: 1, isLoadingRequests: false });
      return;
    }
    if (this.data.isLoadingRequests && !refresh) {
      console.log(`[${PAGE_NAME_REQUEST}] Already loading requests.`);
      return;
    }
    if (!refresh && !this.data.hasMoreRequests) {
      console.log("No more 'My Requests' to load.");
      return;
    }

    this.setData({ isLoadingRequests: true });
    const pageToLoad = refresh ? 1 : this.data.requestPage + 1;
    if(refresh) this.setData({ requestPage: 1, myRequests: [] });

    wx.showLoading({ title: '加载中...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'getSeekingPosts',
        data: {
          page: pageToLoad,
          pageSize: this.data.requestPageSize,
          // 传递 userId 来获取“我的”求购
          userId: app.globalData.userInfo ? app.globalData.userInfo.user_id : null
        }
      });
      wx.hideLoading();
      this.setData({ isLoadingRequests: false });
      console.log(`[${PAGE_NAME_REQUEST}] loadMyRequests result:`, res);

      if (res.result && res.result.success) {
        const newRequests = res.result.data || [];
        this.setData({
          myRequests: refresh ? newRequests : this.data.myRequests.concat(newRequests),
          hasMoreRequests: res.result.hasMore,
          requestPage: pageToLoad
        });
      } else {
        wx.showToast({ title: (res.result && res.result.message) || '加载求购失败', icon: 'none' });
        if(refresh) this.setData({ hasMoreRequests: false });
      }
    } catch (err) {
      wx.hideLoading();
      this.setData({ isLoadingRequests: false });
      console.error(`Error calling getSeekingPosts:`, err);
      wx.showToast({ title: '网络请求异常', icon: 'none' });
      if(refresh) this.setData({ hasMoreRequests: false });
    }
  },

  manageRequest: function(event) {
    const requestId = event.currentTarget.dataset.id;
    if (!requestId) return;
    // 确保已登录才能管理
    if (!this.data.isLoggedIn) {
        this.navigateToLogin();
        return;
    }
    wx.navigateTo({
      url: `/pages/publishRequest/publishRequest?id=${requestId}`
    });
  },

  navigateToPublishNewRequest: function() {
    if (!this.data.isLoggedIn) {
      wx.showModal({
            title: '请先登录',
            content: '登录后才能发布求购信息哦～',
            confirmText: '去登录',
            showCancel: false,
            success: (res) => { if (res.confirm) this.navigateToLogin(); }
        });
      return;
    }
    wx.navigateTo({
      url: '/pages/publishRequest/publishRequest'
    });
  },

  // 新增：跳转到登录页面 (即“我的”页面)
  navigateToLogin: function() {
    wx.switchTab({
      url: '/pages/profile/profile' // 假设“我的”页面是 TabBar 页面
    });
  },

  loadMoreRequests: function() {
    this.loadMyRequests(false);
  },

  onReachBottom: function() {
    if (this.data.isLoggedIn && this.data.hasMoreRequests && !this.data.isLoadingRequests) {
      this.loadMyRequests();
    }
  },

  onPullDownRefresh: function() {
    if (this.data.isLoggedIn) {
      this.loadMyRequests(true).finally(() => {
        wx.stopPullDownRefresh();
      });
    } else {
      wx.stopPullDownRefresh();
      this.setData({myRequests: [], hasMoreRequests: false, requestPage: 1}); // 未登录也清空
      // 可以在这里再次提示登录，或者 onShow 会处理
    }
  },

  onUnload: function() {
    app.unregisterLoginCallback(PAGE_NAME_REQUEST);
  }
})
