// pages/checkout/checkout.js
const app = getApp();

Page({
  data: {
    orderItems: [],        // 要结算的商品列表
    totalOrderPrice: "0.00", // 订单总价
    source: '',            // 订单来源 (例如 'cart', 'buy_now')
    isLoading: true,       // 添加加载状态，初始为 true
    errorLoading: false,
    isPaying: false
  },

  onLoad: function (options) {
    console.log(`[CheckoutPage] onLoad triggered. Options:`, options);
    this.setData({
        source: options.from || 'cart', // 获取来源，默认为 cart
        isLoading: true, // 开始加载数据
        errorLoading: false
    });

    // --- 修改核心：使用 EventChannel 接收数据 ---
    let receivedData = false;
    const eventChannel = this.getOpenerEventChannel();
    if (eventChannel) {
      console.log('[CheckoutPage] EventChannel found. Setting up listener for acceptDataFromCartPage.');
      eventChannel.on('acceptDataFromCartPage', (event) => {
        console.log('[CheckoutPage] Received data via eventChannel:', JSON.parse(JSON.stringify(event.data || [])));
        const itemsFromEvent = event.data;

        if (itemsFromEvent && Array.isArray(itemsFromEvent) && itemsFromEvent.length > 0) {
          receivedData = true;
          this.processCheckoutItems(itemsFromEvent); // 调用处理函数
        } else {
          console.error('[CheckoutPage] Received empty or invalid data via eventChannel.');
          this.handleLoadingError('未能获取到有效的结算商品信息');
        }
      });
      // (可选) 添加一个监听失败或超时的处理逻辑
      // setTimeout(() => {
      //   if (this.data.isLoading) { // 如果一段时间后还在加载状态，说明 eventChannel 可能没收到数据
      //      console.error('[CheckoutPage] Timeout waiting for eventChannel data.');
      //      this.handleLoadingError('加载结算信息超时');
      //   }
      // }, 5000); // 例如设置5秒超时

    }

    // 兼容旧入口：此前页面会把结算商品暂存到本地。新入口均使用 EventChannel。
    this.checkoutFallbackTimer = setTimeout(() => {
      if (receivedData || !this.data.isLoading) return;
      const storedItems = wx.getStorageSync('checkoutItems');
      if (Array.isArray(storedItems) && storedItems.length) {
        wx.removeStorageSync('checkoutItems');
        this.processCheckoutItems(storedItems);
      } else {
        this.handleLoadingError('无法获取结算信息，请返回重试');
      }
    }, 500);
  },

  // --- 新增：统一处理结算商品数据的函数 ---
  processCheckoutItems: function(items) {
    let calculatedTotalPrice = 0;
    let allItemsValid = true; // 标记是否有无效商品

    const processedOrderItems = items.map(item => {
      // 确保 price 和 quantity 是数字
      const numericPrice = parseFloat(item.price);
      const quantity = parseInt(item.quantity) || 1; // 默认为 1

      let itemSubTotal = 0;
      const isValidItem = !isNaN(numericPrice) && !isNaN(quantity) && quantity > 0;

      if (isValidItem) {
          itemSubTotal = numericPrice * quantity;
          calculatedTotalPrice += itemSubTotal;
      } else {
          console.warn('[CheckoutPage] Invalid price or quantity found for item:', JSON.stringify(item));
          allItemsValid = false; // 标记数据有问题
      }

      // 确保返回的对象包含所有需要的信息，特别是 cartItemId (如果来源是购物车)
      return {
        ...item,
        id: item.id || item.bookId,
        price: isValidItem ? numericPrice : 0, // 使用数字价格
        quantity: quantity,
        displayPrice: item.displayPrice || (isValidItem ? numericPrice.toFixed(2) : "0.00"), // 显示价格
        // 确保 cartItemId 被传递过来了
        cartItemId: item.cartItemId || null // 如果没有 cartItemId，则为 null
      };
    });

    if (!allItemsValid) {
        // 如果存在无效商品数据，可以给用户提示，或者过滤掉无效商品（取决于业务逻辑）
        console.error("[CheckoutPage] Some items had invalid price or quantity.");
        // 这里选择继续处理有效商品，但可以根据需要修改
        // wx.showToast({ title: '部分商品信息有误', icon: 'none' });
    }

    console.log('[CheckoutPage] Processed orderItems for setData:', processedOrderItems);
    console.log('[CheckoutPage] Calculated Total Price (number):', calculatedTotalPrice);

    this.setData({
      orderItems: processedOrderItems,
      totalOrderPrice: calculatedTotalPrice.toFixed(2),
      isLoading: false, // 数据加载和处理完成
      errorLoading: false
    });
  },

  // --- 新增：处理加载错误的函数 ---
  handleLoadingError: function(message) {
    this.setData({
      isLoading: false,
      errorLoading: true // 设置错误状态
    });
    wx.showToast({ title: message || '加载结算信息失败', icon: 'none', duration: 2000 });
    // 延迟返回上一页
    setTimeout(() => {
      wx.navigateBack({ delta: 1 });
    }, 2000);
  },


  // --- handlePayment 函数保持不变，但需要注意几点 ---
  handlePayment: async function() {
    if (!this.data.orderItems || this.data.orderItems.length === 0 || this.data.isLoading || this.data.errorLoading) {
        const title = this.data.isLoading ? '页面加载中...' : (this.data.errorLoading ? '页面加载错误' : '没有商品可以支付');
        wx.showToast({ title: title, icon: 'none'});
        return;
    }

    // --- (创建订单和支付逻辑，保持你原来的代码) ---
    // ...
    // 确保在调用 'updateCartItem' 删除购物车商品时， item 对象中确实有 cartItemId
    // ...

    wx.showModal({
      title: '确认支付',
      content: `总计 ¥${this.data.totalOrderPrice}。确认后将锁定教材，并进入校内面交安排。`,
      success: async (res) => {
        if (res.confirm) {
          console.log('用户确认支付');
          wx.showLoading({ title: '订单处理中...', mask: true });

          this.setData({ isPaying: true });
          try {
            const orderRes = await wx.cloud.callFunction({
              name: 'createAndPayOrder',
              data: {
                source: this.data.source === 'cart' ? 'cart' : 'buy_now',
                items: this.data.orderItems.map(item => ({
                  bookId: item.id,
                  quantity: item.quantity,
                  cartItemId: item.cartItemId || null
                }))
              }
            });
            if (!orderRes.result || !orderRes.result.success) {
              throw new Error((orderRes.result && orderRes.result.message) || '订单创建失败');
            }
            app.globalData.cartNeedRefresh = true;
            app.globalData.orderListNeedRefresh = true;
            wx.showToast({ title: '下单成功，等待约定面交', icon: 'success', duration: 1800 });
            setTimeout(() => wx.switchTab({ url: '/pages/profile/profile' }), 1800);
          } catch (err) {
            console.error("[CheckoutPage] Error during payment/order processing:", err);
            wx.showToast({ title: err.message || '订单处理异常', icon: 'none' });
          } finally {
            this.setData({ isPaying: false });
            wx.hideLoading();
          }
        } else if (res.cancel) {
          console.log('用户取消支付');
        }
      }
    });
  },

  goBack() { wx.navigateBack(); },

  onUnload() {
    if (this.checkoutFallbackTimer) clearTimeout(this.checkoutFallbackTimer);
  }
})
