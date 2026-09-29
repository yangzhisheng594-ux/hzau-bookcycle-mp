// pages/sell/sell.js
const app = getApp();
const PAGE_NAME_SELL = 'sellPage'; // 定义页面名称，用于回调注册

Page({
  data: {
    sellingBooks: [],
    hasMoreSelling: true,
    sellingPage: 1,
    sellingPageSize: 10,
    isLoadingSelling: false,

    seekingBooks: [],
    hasMoreSeeking: true,
    seekingPage: 1,
    seekingPageSize: 10,
    isLoadingSeeking: false,

    isLoggedIn: false, // 由 app.js 通知更新
    // appLoginCallbackId 不再需要，使用 PAGE_NAME_SELL
  },

  onLoad: function (options) {
    // 注册登录状态回调
    app.registerLoginCallback(PAGE_NAME_SELL, this.handleLoginStateChange);
    // onLoad 时，app.js 的 checkUserLoginState 可能已经完成或正在进行
    // 如果已完成，上面的注册函数会立即回调一次 handleLoginStateChange
    // 如果还在进行，则会在登录完成后回调
    // 为了确保在 app.js 的异步登录完成前，页面能获取到一个初始的登录状态，我们也可以直接读取一次
    this.setData({ isLoggedIn: app.globalData.isUserLoggedIn });
    if (!app.globalData.isUserLoggedIn) {
        console.log(`[${PAGE_NAME_SELL}] onLoad: User not logged in initially.`);
        // 如果初始未登录，清空列表，WXML 会显示登录提示
        this.setData({ sellingBooks: [], seekingBooks: [] });
    } else {
        console.log(`[${PAGE_NAME_SELL}] onLoad: User logged in, will load data if needed.`);
        // 如果已登录，并且列表为空，则加载
        if (this.data.sellingBooks.length === 0) this.loadSellingBooks(true);
        if (this.data.seekingBooks.length === 0) this.loadSeekingBooks(true);
    }
  },

  onShow: function() {
    console.log(`[${PAGE_NAME_SELL}] onShow. Current isLoggedIn state:`, this.data.isLoggedIn);
    // 每次显示时，确保登录状态是最新的
    this.setData({ isLoggedIn: app.globalData.isUserLoggedIn });

    if (this.data.isLoggedIn) {
        // 待售书单刷新逻辑
        if (app.globalData.sellListNeedRefresh || (this.data.sellingBooks.length === 0 && !this.data.isLoadingSelling)) {
            console.log(`[${PAGE_NAME_SELL}] Refreshing selling books in onShow.`);
            this.loadSellingBooks(true);
            app.globalData.sellListNeedRefresh = false;
        }
    } else {
        // 未登录，确保待售列表为空
        this.setData({ sellingBooks: [], hasMoreSelling: true, sellingPage: 1 });
    }

    // 求购列表刷新逻辑 (求购列表不强依赖登录状态，除非你的业务是只显示“我的求购”)
    // 为保持与你之前逻辑一致，这里也检查 app.globalData.seekingListNeedRefresh
    if (app.globalData.seekingListNeedRefresh || (this.data.seekingBooks.length === 0 && !this.data.isLoadingSeeking)) {
        console.log(`[${PAGE_NAME_SELL}] Refreshing seeking books in onShow.`);
        this.loadSeekingBooks(true);
        if (app.globalData.seekingListNeedRefresh) app.globalData.seekingListNeedRefresh = false;
    }
  },

  // 由 app.js 调用的登录状态处理函数
  handleLoginStateChange: function(isLoggedIn, userInfo) {
    console.log(`[${PAGE_NAME_SELL}] handleLoginStateChange called. isLoggedIn:`, isLoggedIn);
    const previousIsLoggedIn = this.data.isLoggedIn;
    this.setData({ isLoggedIn: isLoggedIn });

    if (isLoggedIn) {
      // 仅当登录状态从“未登录”变为“已登录”时，或者列表为空且不在加载中，才主动加载
      if ((!previousIsLoggedIn || this.data.sellingBooks.length === 0) && !this.data.isLoadingSelling) {
          console.log(`[${PAGE_NAME_SELL}] Loading selling books due to login state change or empty list.`);
          this.loadSellingBooks(true);
      }
      // 求购列表可以一直加载，或者也根据登录状态变化加载
      if ((!previousIsLoggedIn || this.data.seekingBooks.length === 0) && !this.data.isLoadingSeeking) {
        console.log(`[${PAGE_NAME_SELL}] Loading seeking books due to login state change or empty list.`);
        this.loadSeekingBooks(true);
      }
    } else {
      // 从“已登录”变为“未登录”或初始就是“未登录”
      this.setData({
        sellingBooks: [], hasMoreSelling: true, sellingPage: 1,
        // seekingBooks: [], hasMoreSeeking: true, seekingPage: 1, // 如果求购也需登录
      });
    }
  },

  // --- 待售书籍相关 ---
  loadSellingBooks: async function(refresh = false) {
    if (!this.data.isLoggedIn) { // 未登录不加载“我的待售”
      console.log(`[${PAGE_NAME_SELL}] User not logged in. 'My Selling Books' will not be loaded.`);
      this.setData({ sellingBooks: [], hasMoreSelling: false, sellingPage: 1, isLoadingSelling: false });
      return;
    }
    if (this.data.isLoadingSelling && !refresh) return; // 如果正在加载且不是强制刷新，则返回
    if (!refresh && !this.data.hasMoreSelling) return;

    this.setData({ isLoadingSelling: true });
    const pageToLoad = refresh ? 1 : this.data.sellingPage + 1;
    if(refresh) this.setData({ sellingPage: 1, sellingBooks: [] });

    wx.showLoading({ title: '加载待售...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'getUserSellingBooks',
        data: { page: pageToLoad, pageSize: this.data.sellingPageSize }
      });
      wx.hideLoading();
      this.setData({ isLoadingSelling: false });
      console.log(`[${PAGE_NAME_SELL}] loadSellingBooks result:`, res);

      if (res.result && res.result.success) {
        const newBooks = res.result.data || [];
        this.setData({
          sellingBooks: refresh ? newBooks : this.data.sellingBooks.concat(newBooks),
          hasMoreSelling: res.result.hasMore,
          sellingPage: pageToLoad
        });
      } else {
        wx.showToast({ title: (res.result && res.result.message) || '加载待售书籍失败', icon: 'none' });
        if(refresh) this.setData({ hasMoreSelling: false });
      }
    } catch (err) {
      wx.hideLoading();
      this.setData({ isLoadingSelling: false });
      console.error(`Error calling getUserSellingBooks:`, err);
      wx.showToast({ title: '网络请求异常', icon: 'none' });
      if(refresh) this.setData({ hasMoreSelling: false });
    }
  },

  // --- 最近求购相关 ---
  loadSeekingBooks: async function(refresh = false) {
    // 求购列表不强制要求登录，但如果你的业务是“我的求购”，则需要加登录判断
    if (this.data.isLoadingSeeking && !refresh) return;
    if (!refresh && !this.data.hasMoreSeeking) {
        console.log("No more seeking posts to load.");
        return;
    }
    this.setData({ isLoadingSeeking: true });
    const pageToLoad = refresh ? 1 : this.data.seekingPage + 1;
    if(refresh) this.setData({ seekingPage: 1, seekingBooks: [] });

    wx.showLoading({ title: '加载求购...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'getSeekingPosts',
        data: { page: pageToLoad, pageSize: this.data.seekingPageSize }
      });
      wx.hideLoading();
      this.setData({ isLoadingSeeking: false });
      console.log(`[${PAGE_NAME_SELL}] loadSeekingBooks result:`, res);

      if (res.result && res.result.success) {
        const newPosts = res.result.data || [];
        this.setData({
          seekingBooks: refresh ? newPosts : this.data.seekingBooks.concat(newPosts),
          hasMoreSeeking: res.result.hasMore,
          seekingPage: pageToLoad
        });
      } else {
        wx.showToast({ title: (res.result && res.result.message) || '加载求购失败', icon: 'none' });
        if(refresh) this.setData({ hasMoreSeeking: false });
      }
    } catch (err) {
      wx.hideLoading();
      this.setData({ isLoadingSeeking: false });
      console.error(`Error calling getSeekingPosts:`, err);
      wx.showToast({ title: '网络请求异常', icon: 'none' });
      if(refresh) this.setData({ hasMoreSeeking: false });
    }
  },

  manageBook: function(event) {
    const bookId = event.currentTarget.dataset.id;
    if (bookId) wx.navigateTo({ url: `/pages/publish/publish?id=${bookId}` });
  },
  respondToSeek: function() {
    wx.showToast({ title: '请通过校园联系方式与求购者沟通', icon: 'none' });
  },

  loadMoreSelling: function() {
    this.loadSellingBooks(false);
  },

  navigateToPublishNew: function() {
    if (!this.data.isLoggedIn) {
        wx.showModal({
            title: '请先登录',
            content: '登录后才能发布书籍哦～',
            confirmText: '去登录',
            showCancel: false, // 或者 true 并处理取消
            success: (res) => {
                if (res.confirm) {
                    wx.switchTab({ url: '/pages/profile/profile' }); // 跳转到个人中心页登录
                }
            }
        });
        return;
    }
    wx.navigateTo({ url: '/pages/publish/publish' });
  },

  // 新增：跳转到登录页面 (即“我的”页面)
  navigateToLogin: function() {
    wx.switchTab({
      url: '/pages/profile/profile' // 假设“我的”页面是 TabBar 页面
    });
  },

  navigateToSoldOrders: function() {
    if (!this.data.isLoggedIn) {
      this.navigateToLogin();
      return;
    }
    wx.navigateTo({ url: '/pages/soldOrders/soldOrders' });
  },

  onReachBottom: function() {
    console.log(`[${PAGE_NAME_SELL}] onReachBottom`);
    if (this.data.isLoggedIn && this.data.hasMoreSelling && !this.data.isLoadingSelling) {
      this.loadSellingBooks();
    }
    // 求购列表加载更多
    if (this.data.hasMoreSeeking && !this.data.isLoadingSeeking) {
      this.loadSeekingBooks();
    }
  },

  onPullDownRefresh: function() {
    console.log(`[${PAGE_NAME_SELL}] onPullDownRefresh`);
    let loadTasks = [];
    if (this.data.isLoggedIn) {
        loadTasks.push(this.loadSellingBooks(true));
    } else {
        this.setData({ sellingBooks: [], hasMoreSelling: true, sellingPage: 1 });
    }
    loadTasks.push(this.loadSeekingBooks(true));

    Promise.all(loadTasks).catch(err => {
        console.error("Error during pull down refresh tasks:", err);
    }).finally(() => {
        wx.stopPullDownRefresh();
        wx.showToast({title: '刷新完成', icon: 'none', duration: 1000});
    });
  },

  onUnload: function() {
    // 页面卸载时注销回调
    app.unregisterLoginCallback(PAGE_NAME_SELL);
  }
})
