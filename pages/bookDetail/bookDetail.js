// pages/bookDetail/bookDetail.js
const app = getApp();

Page({
  data: {
    bookId: null,
    book: {},
    currentSwiper: 0,
    // imageContainerStyle 和 swiperHeight 用于动态高度，根据你之前的需求
    imageContainerStyle: 'height: auto;',
    swiperHeight: 'auto',
    imageHeights: {},
    maxImageHeight: 0,
    loadedImageCount: 0,
  },

  onLoad: function (options) {
    const bookId = options.id;
    console.log('BookDetail onLoad, bookId:', bookId);

    if (bookId) {
      this.setData({
        bookId: bookId,
        book: {},
        // 重置图片高度相关data
        imageContainerStyle: 'height: auto;',
        swiperHeight: 'auto',
        imageHeights: {},
        maxImageHeight: 0,
        loadedImageCount: 0,
      });
      this.loadBookDetail(bookId);
    } else {
      console.error('No book ID provided to BookDetail page');
      wx.showToast({
        title: '参数错误', icon: 'none', duration: 2000,
        complete: () => { setTimeout(() => { wx.navigateBack(); }, 500); }
      });
    }
  },

  async loadBookDetail(bookId) {
    wx.showLoading({ title: '加载中...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'getBookDetail', // 确保此云函数已修改为从MySQL获取图片信息
        data: { bookId: bookId }
      });
      wx.hideLoading();
      console.log('[BookDetail] loadBookDetail result:', res);

      if (res.result && res.result.success && res.result.data) {
        let bookData = res.result.data;
        // 确保 imageUrls 是一个数组
        if (!bookData.imageUrls || !Array.isArray(bookData.imageUrls)) {
            bookData.imageUrls = [];
        }
        // 如果 imageUrls 为空但 coverUrl 有值，将其加入 imageUrls (用于轮播)
        // 后端 getBookDetail 应该已经处理好 coverUrl 和 imageUrls 的关系了
        // if (bookData.imageUrls.length === 0 && bookData.coverUrl) {
        //     bookData.imageUrls.push(bookData.coverUrl);
        // }
        this.setData({ book: bookData });
        if (bookData.title) wx.setNavigationBarTitle({ title: bookData.title });

        // 如果没有图片，给容器一个默认高度，避免塌陷
        if ((!bookData.imageUrls || bookData.imageUrls.length === 0) && !bookData.coverUrl) {
            this.setData({ imageContainerStyle: 'height: 300rpx;' }); // 与WXML占位块高度一致
        }

      } else {
        wx.showToast({ title: (res.result && res.result.message) || '加载失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      console.error("Error calling getBookDetail:", err);
      wx.showToast({ title: '网络请求失败', icon: 'none' });
    }
  },

  // 图片加载完成，用于动态计算swiper高度 (如果使用)
  onImageLoad: function(e) {
    if (!this.data.book || (!this.data.book.imageUrls && !this.data.book.coverUrl)) return;

    const originalWidth = e.detail.width;
    const originalHeight = e.detail.height;
    const screenWidth = wx.getSystemInfoSync().windowWidth;
    const scaledHeight = (screenWidth / originalWidth) * originalHeight;

    if (this.data.book.imageUrls && this.data.book.imageUrls.length > 0) { // 轮播图
      const index = e.currentTarget.dataset.index;
      const imageHeights = { ...this.data.imageHeights };
      imageHeights[index] = scaledHeight;

      let currentMaxHeight = 0;
      let loadedCount = 0;
      for (const key in imageHeights) {
        loadedCount++;
        if (imageHeights[key] > currentMaxHeight) {
          currentMaxHeight = imageHeights[key];
        }
      }
      this.setData({ imageHeights: imageHeights });

      // 只有当所有图片（或至少一个，这里用最大值）加载完才设置swiper高度
      if (currentMaxHeight > 0 && currentMaxHeight !== this.data.maxImageHeight) {
        this.setData({
          maxImageHeight: currentMaxHeight,
          swiperHeight: currentMaxHeight + 'px',
          imageContainerStyle: `height: ${currentMaxHeight}px;`
        });
        console.log(`Swiper/Container height set to: ${currentMaxHeight}px`);
      }
    } else if (this.data.book.coverUrl) { // 单张图片
      this.setData({
        imageContainerStyle: `height: ${scaledHeight}px;`,
        swiperHeight: 'auto' // 单图时swiper不显示，高度设为auto
      });
      console.log(`Single image container height set to: ${scaledHeight}px`);
    }
  },

  swiperChange: function(e) { this.setData({ currentSwiper: e.detail.current }); },

  goBack: function() { wx.navigateBack(); },

  // 修改后的 addToCart 方法
  async addToCart() {
    if (!app.globalData.isUserLoggedIn) {
      wx.showModal({
        title: '提示',
        content: '请先登录才能加入购物车',
        confirmText: '去登录',
        showCancel: false,
        success: res => { if (res.confirm) wx.switchTab({ url: '/pages/profile/profile' });}
      });
      return;
    }
    if (!this.data.bookId || !this.data.book || !this.data.book.id) {
      wx.showToast({ title: '商品信息加载不完整', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '添加中...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'addToCart', // 调用你创建的 addToCart 云函数
        data: {
          bookId: this.data.book.id,
          quantity: 1 // 默认添加1件，云函数中会处理价格
        }
      });
      wx.hideLoading();
      if (res.result && res.result.success) {
        wx.showToast({ title: res.result.message || '成功加入购物车', icon: 'success' });
        app.globalData.cartNeedRefresh = true; // 设置购物车刷新标志
        // 你可以在这里更新tabBar角标 (如果需要)
        // if (res.result.totalCartItems !== undefined) {
        //   wx.setTabBarBadge({ index: YOUR_CART_TAB_INDEX, text: String(res.result.totalCartItems) });
        // }
      } else {
        wx.showToast({ title: (res.result && res.result.message) || '添加失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      console.error("Error calling addToCart cloud function:", err);
      wx.showToast({ title: '请求失败，请重试', icon: 'none' });
    }
  },

  buyNow: function() {
    if (!app.globalData.isUserLoggedIn) { // 购买前也检查登录
      wx.showModal({
        title: '请先登录',
        content: '登录后才能购买书籍',
        confirmText: '去登录',
        success: res => { if (res.confirm) wx.switchTab({ url: '/pages/profile/profile' }); }
      });
      return;
    }
    if (!this.data.bookId || !this.data.book || !this.data.book.id) {
      wx.showToast({ title: '商品信息加载不完整', icon: 'none' });
      return;
    }
    const orderItem = {
      id: this.data.book.id,
      title: this.data.book.title,
      // 修改点：移除对本地默认图片的引用
      coverUrl: this.data.book.coverUrl || (this.data.book.imageUrls && this.data.book.imageUrls.length > 0 ? this.data.book.imageUrls[0] : null), // 如果没有图片，则为 null
      price: parseFloat(this.data.book.price) || 0,
      courseCode: this.data.book.courseCode || '',
      quantity: 1
    };
    wx.navigateTo({
      url: '/pages/checkout/checkout?from=buy_now',
      success: res => res.eventChannel.emit('acceptDataFromCartPage', { data: [orderItem] }),
      fail: error => {
        console.error('[BookDetail] Unable to open checkout:', error);
        wx.showToast({ title: '无法打开结算页，请重试', icon: 'none' });
      }
    });
  },

  onShareAppMessage: function () {
    if (!this.data.book || !this.data.book.title) {
      return { title: '淘好书，上二手书交易平台！', path: '/pages/index/index' };
    }
    return {
      title: `推荐给你《${this.data.book.title}》`,
      path: `/pages/bookDetail/bookDetail?id=${this.data.bookId}`,
      // 修改点：移除对本地默认图片的引用
      imageUrl: this.data.book.coverUrl || (this.data.book.imageUrls && this.data.book.imageUrls.length > 0 ? this.data.book.imageUrls[0] : null) // 如果没有图片，则不指定分享图
    };
  },
});
