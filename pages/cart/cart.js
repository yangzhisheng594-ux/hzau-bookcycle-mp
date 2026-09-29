// pages/cart/cart.js
const app = getApp();
const PAGE_NAME = 'cartPage'; // 定义页面名称，用于回调注册

Page({
  data: {
    books: [],
    isAllSelected: false,
    totalPrice: "0.00",
    selectedCount: 0,
    isManageMode: false, // 这个状态控制显示“合计”还是“已选”，以及按钮是“结算”还是“删除”
    isLoading: false,
    isLoggedIn: false, // 页面自身的登录状态，由 app.js 通知更新
  },

  onLoad: function (options) {
    console.log(`[${PAGE_NAME}] onLoad`);
    // 注册登录状态回调
    app.registerLoginCallback(PAGE_NAME, this.handleLoginStateChange);
    // onLoad 时也根据当前 app.globalData 初始化登录状态并决定是否加载数据
    this.setData({ isLoggedIn: app.globalData.isUserLoggedIn });
    if (app.globalData.isUserLoggedIn) {
      console.log(`[${PAGE_NAME}] onLoad: User logged in, loading initial cart items.`);
      this.loadCartItems(); // 首次加载
    } else {
      console.log(`[${PAGE_NAME}] onLoad: User not logged in initially.`);
      this.setData({ books: [], isAllSelected: false, totalPrice: "0.00", selectedCount: 0 }); // 未登录则清空
    }
  },

  onShow: function() {
    console.log(`[${PAGE_NAME}] onShow. Current isLoggedIn state:`, this.data.isLoggedIn);
    // 确保登录状态是最新的
    this.setData({ isLoggedIn: app.globalData.isUserLoggedIn });

    if (this.data.isLoggedIn) {
        // 检查是否需要强制刷新 (例如从其他页面添加了商品后返回)
        // 或者 购物车为空且不在加载中 (可能登录后第一次进入)
        if (app.globalData.cartNeedRefresh || (this.data.books.length === 0 && !this.data.isLoading)) {
            console.log(`[${PAGE_NAME}] Refreshing cart items in onShow.`);
            this.loadCartItems(); // 加载数据
            app.globalData.cartNeedRefresh = false; // 重置刷新标志
        } else if (this.data.books.length > 0) {
            // 如果购物车有数据，并且不需要强制刷新，也执行一次更新计算
            // 这可以同步购物车中商品可能发生的价格变动或其他状态（如果后端有更新）
            // 或者仅仅是为了确保选中状态和总价正确（如果loadCartItems没有完全处理好）
            console.log(`[${PAGE_NAME}] Updating selection and price in onShow (no full reload).`);
            // 考虑是否需要调用 loadCartItems 来获取最新数据，或者仅更新选中状态
            // 如果只是为了更新选中和总价，可以调用:
            this.updateSelectionAndPrice();
            // 如果需要从服务器同步最新商品状态（价格、库存等），则应调用：
            // this.loadCartItems();
        }
    } else {
        // 未登录状态，确保购物车是清空的
        this.setData({ books: [], isAllSelected: false, totalPrice: "0.00", selectedCount: 0 });
    }
  },

  // 由 app.js 调用的登录状态处理函数
  handleLoginStateChange: function(isLoggedIn, userInfo) {
    console.log(`[${PAGE_NAME}] handleLoginStateChange called. isLoggedIn:`, isLoggedIn);
    const previousIsLoggedIn = this.data.isLoggedIn;
    this.setData({ isLoggedIn: isLoggedIn });

    if (isLoggedIn) {
      // 仅当登录状态从“未登录”变为“已登录”时，或者列表为空且不在加载中，才主动加载
      if ((!previousIsLoggedIn || this.data.books.length === 0) && !this.data.isLoading) {
          console.log(`[${PAGE_NAME}] Loading items due to login state change or empty list.`);
          this.loadCartItems();
      }
    } else {
      // 从登录状态变为未登录状态，清空购物车
      this.setData({
        books: [],
        isAllSelected: false,
        totalPrice: "0.00",
        selectedCount: 0
      });
    }
  },

  // 加载购物车数据
  async loadCartItems() {
    if (!this.data.isLoggedIn) {
      console.log(`[${PAGE_NAME}] User not logged in. Not loading items.`);
      this.setData({books: [], isLoading: false, totalPrice: "0.00", selectedCount: 0, isAllSelected: false });
      return;
    }
    if (this.data.isLoading) {
      console.log(`[${PAGE_NAME}] Already loading items.`);
      return;
    }
    this.setData({ isLoading: true });
    wx.showLoading({ title: '加载中...' });

    try {
      // 调用云函数获取购物车列表
      const res = await wx.cloud.callFunction({ name: 'getCartItems' });
      wx.hideLoading();
      this.setData({ isLoading: false });
      console.log(`[${PAGE_NAME}] Raw result from getCartItems:`, JSON.parse(JSON.stringify(res))); // 打印原始返回结果

      if (res.result && res.result.success && Array.isArray(res.result.data)) {
        const rawBooks = res.result.data;
        // 处理数据，确保价格是数字，添加选中状态（默认为 false）
        const booksProcessed = rawBooks.map(item => {
          const numericPrice = parseFloat(item.price); // 确保 price 是数字
          const quantity = parseInt(item.quantity) || 1; // 确保 quantity 是数字, 默认 1
          const isValidPrice = !isNaN(numericPrice);
          // 查找旧数据中该商品的选中状态，如果找不到则默认为 false
          const previousSelectedState = this.data.books.find(b => b.cartItemId === item.cartItemId)?.selected || false;

          return {
            ...item,
            price: isValidPrice ? numericPrice : 0, // 使用数字价格进行计算
            displayPrice: isValidPrice ? numericPrice.toFixed(2) : "0.00", // 用于显示的格式化价格
            quantity: quantity,
            selected: previousSelectedState // 保留之前的选中状态或默认为 false
            // 确保你的 item 对象里包含 cartItemId 或其他唯一标识符
          };
        });
        this.setData({ books: booksProcessed });
      } else {
        console.error(`[${PAGE_NAME}] Failed to load cart items:`, res.result);
        wx.showToast({ title: (res.result && res.result.message) || '加载失败', icon: 'none' });
        this.setData({ books: [] }); // 加载失败则清空
      }
    } catch (err) {
      wx.hideLoading();
      this.setData({ isLoading: false, books: [] }); // 出错也清空
      console.error(`[${PAGE_NAME}] Error calling getCartItems:`, err);
      wx.showToast({ title: '网络请求失败', icon: 'none' });
    }
    // 无论加载成功或失败，最后都调用一次更新计算，以确保界面状态正确
    this.updateSelectionAndPrice();
  },

  // --- 核心交互函数 ---

  // 切换管理/完成模式
  toggleManageMode: function() {
    console.log(`[${PAGE_NAME}] Toggling manage mode`);
    this.setData({ isManageMode: !this.data.isManageMode });
    // 可以在这里选择性地重置选中状态，根据产品需求决定
    // 如果切换到管理模式时不清空选择，方便删除
    // 如果切换回完成模式时需要清空，可以取消下面的注释
    // if (!this.data.isManageMode) {
    //   const books = this.data.books;
    //   books.forEach(book => book.selected = false);
    // }
    // 无论如何，更新一下底部栏状态
    this.updateSelectionAndPrice();
  },

  // 切换单个商品选中状态
  toggleSelect: function(e) {
    const index = e.currentTarget.dataset.index;
    console.log(`[${PAGE_NAME}] toggleSelect for index: ${index}`);
    const books = this.data.books;
    if (books[index]) {
      books[index].selected = !books[index].selected;
      // 更新单个状态后，必须重新计算总价和全选状态
      this.updateSelectionAndPrice();
    } else {
      console.error(`[${PAGE_NAME}] toggleSelect error: Invalid index ${index}`);
    }
  },

  // 切换全选/取消全选状态
  toggleSelectAll: function() {
    const currentIsAllSelected = this.data.isAllSelected;
    console.log(`[${PAGE_NAME}] toggleSelectAll. Current isAllSelected: ${currentIsAllSelected}`);
    const books = this.data.books;
    const newSelectState = !currentIsAllSelected;

    books.forEach(book => {
      book.selected = newSelectState;
    });

    // 更新所有选中状态后，重新计算总价和更新全选状态本身
    this.updateSelectionAndPrice();
  },

  // 更新选中状态、总价格和选中数量 (核心计算函数)
  updateSelectionAndPrice: function() {
    console.log(`[${PAGE_NAME}] Updating selection and price...`);
    const books = this.data.books;
    let totalPrice = 0;
    let selectedCount = 0;
    // 购物车为空时，不应是全选状态
    let isAllSelected = books.length > 0;

    books.forEach(book => {
      if (book.selected) {
        const price = typeof book.price === 'number' ? book.price : parseFloat(book.price);
        const quantity = typeof book.quantity === 'number' ? book.quantity : parseInt(book.quantity) || 1;
        if (!isNaN(price) && !isNaN(quantity)) { // 确保价格和数量都是有效数字
          totalPrice += price * quantity;
        } else {
          console.warn(`[${PAGE_NAME}] Invalid price or quantity for book:`, book.title, book.price, book.quantity);
        }
        selectedCount++;
      } else {
        // 只要有一个商品没被选中，就不是全选
        isAllSelected = false;
      }
    });

    console.log(`[${PAGE_NAME}] Calculation result: totalPrice=${totalPrice.toFixed(2)}, selectedCount=${selectedCount}, isAllSelected=${isAllSelected}`);

    this.setData({
      // 更新 books 数组以反映选中状态的变化 (toggleSelectAll 会修改所有项)
      books: books,
      totalPrice: totalPrice.toFixed(2), // 总价保留两位小数
      selectedCount: selectedCount,      // 更新选中数量
      isAllSelected: isAllSelected       // 更新全选状态
    });
  },

  // --- 按钮操作 ---

  // 结算
  checkout: function() {
    console.log(`[${PAGE_NAME}] Checkout button clicked. Selected count: ${this.data.selectedCount}`);
    if (this.data.selectedCount === 0) {
      wx.showToast({ title: '请选择要结算的商品', icon: 'none' });
      return;
    }
    // 获取选中的商品
    const itemsToCheckout = this.data.books.filter(book => book.selected);
    console.log(`[${PAGE_NAME}] Items to checkout:`, itemsToCheckout);

    // 跳转到结算页面，并通过事件通道传递数据
    wx.navigateTo({
      url: '/pages/checkout/checkout', // 确认结算页路径正确
      success: function(res) {
        // 页面跳转成功的回调函数
        // 通过eventChannel向打开的页面传送数据
        console.log(`[${PAGE_NAME}] Navigating to checkout, sending data via eventChannel.`);
        res.eventChannel.emit('acceptDataFromCartPage', { data: itemsToCheckout });
      },
      fail: function(err) {
        console.error(`[${PAGE_NAME}] Navigate to checkout failed:`, err);
        wx.showToast({ title: '无法打开结算页面', icon: 'none' });
        // 可以在这里尝试使用全局变量或其他方式传递数据作为后备方案
        // app.globalData.itemsToCheckout = itemsToCheckout;
        // wx.navigateTo({ url: '/pages/checkout/checkout' });
      }
    });
  },

  // 删除选中的商品
  deleteSelected: async function() {
    console.log(`[${PAGE_NAME}] Delete button clicked. Selected count: ${this.data.selectedCount}`);
    if (this.data.selectedCount === 0) {
      wx.showToast({ title: '请选择要删除的商品', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '确认删除',
      content: `确定要删除选中的 ${this.data.selectedCount} 件商品吗？`,
      success: async (res) => {
        if (res.confirm) {
          console.log(`[${PAGE_NAME}] User confirmed deletion.`);
          // 获取选中商品的 cartItemId 列表
          const cartItemIdsToDelete = this.data.books
            .filter(book => book.selected)
            .map(book => book.cartItemId); // 确保你的 book 对象里有 cartItemId

          if (cartItemIdsToDelete.length > 0) {
            console.log(`[${PAGE_NAME}] Items IDs to delete:`, cartItemIdsToDelete);
            wx.showLoading({ title: '删除中...' });
            try {
              // 调用云函数执行删除操作
              const deleteRes = await wx.cloud.callFunction({
                name: 'deleteCartItems', // 确保你创建了名为 deleteCartItems 的云函数
                data: {
                  cartItemIds: cartItemIdsToDelete
                }
              });
              wx.hideLoading();
              console.log(`[${PAGE_NAME}] deleteCartItems result:`, deleteRes.result);

              if (deleteRes.result && deleteRes.result.success) {
                wx.showToast({ title: '删除成功', icon: 'success' });
                // 从前端数据中移除已删除的商品
                // 注意：直接修改 this.data.books 不是好做法，应该用 setData
                const remainingBooks = this.data.books.filter(book => !cartItemIdsToDelete.includes(book.cartItemId));
                this.setData({ books: remainingBooks });
                // 删除后必须重新计算总价和选中状态
                this.updateSelectionAndPrice();
              } else {
                 wx.showToast({ title: (deleteRes.result && deleteRes.result.message) || '删除失败', icon: 'none' });
              }
            } catch (err) {
              wx.hideLoading();
              console.error(`[${PAGE_NAME}] Error calling deleteCartItems:`, err);
              wx.showToast({ title: '删除请求失败', icon: 'none' });
            }
          } else {
              console.warn(`[${PAGE_NAME}] No valid cartItemIds found to delete.`);
          }
        } else {
            console.log(`[${PAGE_NAME}] User cancelled deletion.`);
        }
      }
    });
  },

  // (可选) 处理数量变化，如果你的 WXML 里有加减按钮
  // async changeQuantity(e) { ... },

  // 跳转到首页或其他购物页面
  goShopping: function() {
    wx.switchTab({ url: '/pages/index/index' }); // 确认首页路径正确
  },

  // 跳转到登录页面 (通常是个人中心页)
  navigateToLogin: function() {
    wx.switchTab({
      url: '/pages/profile/profile' // 确认个人中心页路径正确
    });
  },

  onUnload: function() {
    console.log(`[${PAGE_NAME}] onUnload`);
    // 页面卸载时注销回调，防止内存泄漏
    if (app && typeof app.unregisterLoginCallback === 'function') {
        app.unregisterLoginCallback(PAGE_NAME);
    }
  }
});
