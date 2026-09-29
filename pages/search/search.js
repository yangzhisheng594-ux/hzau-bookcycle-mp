Page({
  data: {
    keyword: '',
    books: [],
    page: 1,
    pageSize: 12,
    total: 0,
    hasMore: false,
    hasSearched: false,
    isLoading: false,
    loadFailed: false,
    collection: '',
    pageTitle: '搜索书籍'
  },

  onLoad(options) {
    const keyword = decodeURIComponent(options.keyword || '').trim();
    const collection = ['hot', 'recent'].includes(options.collection) ? options.collection : '';
    const pageTitle = collection === 'hot' ? '热门教材' : collection === 'recent' ? '新书上架' : '搜索书籍';
    this.setData({ keyword, collection, pageTitle });
    if (keyword || collection) this.loadBooks(true);
  },

  onKeywordInput(event) {
    const keyword = event.detail.value;
    this.setData({ keyword, collection: keyword ? '' : this.data.collection, pageTitle: keyword ? '搜索书籍' : this.data.pageTitle });
  },

  search() {
    const keyword = this.data.keyword.trim();
    if (!keyword && !this.data.collection) {
      wx.showToast({ title: '请输入搜索关键词', icon: 'none' });
      return;
    }
    this.loadBooks(true);
  },

  async loadBooks(reset = false) {
    if (this.data.isLoading || (!reset && !this.data.hasMore)) return;
    const page = reset ? 1 : this.data.page + 1;
    this.setData({ isLoading: true, loadFailed: false });
    try {
      const keyword = this.data.keyword.trim();
      const type = keyword ? 'search' : this.data.collection === 'hot' ? 'bestseller' : 'recent';
      const res = await wx.cloud.callFunction({
        name: 'getBooks',
        data: { type, searchKeyword: keyword, page, pageSize: this.data.pageSize }
      });
      if (!res.result || !res.result.success) throw new Error((res.result && res.result.message) || '搜索失败');
      const result = res.result;
      this.setData({
        books: reset ? result.data : this.data.books.concat(result.data || []),
        page,
        total: result.pagination.totalItems || 0,
        hasMore: Boolean(result.pagination.hasMore),
        hasSearched: true
      });
    } catch (error) {
      console.error('[SearchPage] loadBooks failed:', error);
      this.setData({ hasSearched: true, loadFailed: true });
      wx.showToast({ title: error.message || '搜索失败，请重试', icon: 'none' });
    } finally {
      this.setData({ isLoading: false });
      wx.stopPullDownRefresh();
    }
  },

  loadMore() { this.loadBooks(false); },
  onReachBottom() { this.loadBooks(false); },
  onPullDownRefresh() { this.loadBooks(true); },
  goBack() { wx.navigateBack(); },
  openDetail(event) { wx.navigateTo({ url: `/pages/bookDetail/bookDetail?id=${event.currentTarget.dataset.id}` }); }
});
