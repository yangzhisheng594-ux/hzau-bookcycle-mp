// pages/orderList/orderList.js
Page({
  data: {
    currentStatus: 'all',
    orders: [],
    page: 1,
    pageSize: 20,
    hasMore: false,
    isLoading: false,
    loadFailed: false
  },

  onLoad: function (options) {
    const status = options.status || 'all';
    this.setData({ currentStatus: status });
    wx.setNavigationBarTitle({ title: this.getNavTitleByStatus(status) });
    this.loadOrders(true);
  },

  getNavTitleByStatus: function(status) {
    switch(status) {
      case 'pendingPayment': return '待付款订单';
        case 'pendingShipment': return '待面交订单';
        case 'pendingReceipt': return '待确认收书';
      case 'afterSales': return '退款/售后';
      default: return '我的订单';
    }
  },

  async loadOrders(reset = false) {
    if (this.data.isLoading || (!reset && !this.data.hasMore)) return;
    const page = reset ? 1 : this.data.page + 1;
    this.setData({ isLoading: true, loadFailed: false });
    try {
      const res = await wx.cloud.callFunction({
        name: 'getOrders',
        data: { status: this.data.currentStatus, page, pageSize: this.data.pageSize }
      });
      if (!res.result || !res.result.success) throw new Error((res.result && res.result.message) || '加载订单失败');
      this.setData({
        orders: reset ? (res.result.data || []) : this.data.orders.concat(res.result.data || []),
        page,
        hasMore: Boolean(res.result.pagination && res.result.pagination.hasMore)
      });
    } catch (error) {
      console.error('[OrderList] loadOrders failed:', error);
      this.setData({ orders: [], loadFailed: true });
      wx.showToast({ title: error.message || '加载订单失败', icon: 'none' });
    } finally {
      this.setData({ isLoading: false });
      wx.stopPullDownRefresh();
    }
  },

  confirmReceipt(e) {
    const orderId = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认收货',
      content: '确认已完成校内面交，并验收书籍无误吗？',
      success: async result => {
        if (!result.confirm) return;
        wx.showLoading({ title: '处理中...' });
        try {
          const res = await wx.cloud.callFunction({ name: 'confirmReceipt', data: { orderId } });
          if (!res.result || !res.result.success) throw new Error((res.result && res.result.message) || '操作失败');
          wx.showToast({ title: '确认收书成功', icon: 'success' });
          this.loadOrders(true);
        } catch (error) {
          wx.showToast({ title: error.message || '操作失败', icon: 'none' });
        } finally {
          wx.hideLoading();
        }
      }
    });
  },

  goToHome() { wx.switchTab({ url: '/pages/index/index' }); },
  goBack() { wx.navigateBack(); },
  retryLoad() { this.loadOrders(true); },
  loadMore() { this.loadOrders(false); },
  onReachBottom() { this.loadOrders(false); },
  onPullDownRefresh() { this.loadOrders(true); }
});
