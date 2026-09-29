Page({
  data: {
    orders: [],
    page: 1,
    pageSize: 20,
    hasMore: false,
    isLoading: false,
    loadFailed: false
  },

  onLoad() {
    this.loadOrders(true);
  },

  async loadOrders(reset = false) {
    if (this.data.isLoading || (!reset && !this.data.hasMore)) return;
    const page = reset ? 1 : this.data.page + 1;
    this.setData({ isLoading: true, loadFailed: false });
    try {
      const res = await wx.cloud.callFunction({
        name: 'getSellerOrders',
        data: { page, pageSize: this.data.pageSize }
      });
      if (!res.result || !res.result.success) throw new Error((res.result && res.result.message) || '加载失败');
      this.setData({
        orders: reset ? (res.result.data || []) : this.data.orders.concat(res.result.data || []),
        page,
        hasMore: Boolean(res.result.pagination && res.result.pagination.hasMore)
      });
    } catch (error) {
      console.error('[SoldOrders] loadOrders failed:', error);
      this.setData({ loadFailed: true });
      wx.showToast({ title: error.message || '加载售出订单失败', icon: 'none' });
    } finally {
      this.setData({ isLoading: false });
      wx.stopPullDownRefresh();
    }
  },

  shipItem(event) {
    const orderItemId = event.currentTarget.dataset.id;
    wx.showModal({
      title: '确认面交',
      content: '确认已在校内与买家完成面交吗？确认后将等待买家验书并确认收书。',
      success: async result => {
        if (!result.confirm) return;
        wx.showLoading({ title: '处理中...' });
        try {
          const res = await wx.cloud.callFunction({ name: 'shipOrderItem', data: { orderItemId } });
          if (!res.result || !res.result.success) throw new Error((res.result && res.result.message) || '确认面交失败');
          wx.showToast({ title: '已确认面交', icon: 'success' });
          this.loadOrders(true);
        } catch (error) {
          wx.showToast({ title: error.message || '确认面交失败', icon: 'none' });
        } finally {
          wx.hideLoading();
        }
      }
    });
  },

  retryLoad() { this.loadOrders(true); },
  goBack() { wx.navigateBack(); },
  loadMore() { this.loadOrders(false); },
  onReachBottom() { this.loadOrders(false); },
  onPullDownRefresh() { this.loadOrders(true); }
});
