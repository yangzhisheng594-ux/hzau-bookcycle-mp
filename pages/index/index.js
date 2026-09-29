// pages/index/index.js
const { MAJORS, GRADES } = require('../../utils/catalog');

const NON_BOOK_KEYWORDS = ['电瓶车', '电动车', '自行车', '手机', '电脑', '笔记本', 'iPad', 'iphone', 'airpods', '耳机', '充电宝', '吹风机', '洗衣机', '自行车'];

// 首页只展示「看起来是教材/书」的条目。
// 判据宽松：只要标题没命中明显非书关键词、且价格在合理范围，就放行——
// 绝不能误杀正常书籍，只拦明显乱挂的（如群里那条「iPhone 手机。¥15000」测试贴）。
function isTextbook(book) {
  if (!book) return false;
  const title = String(book.title || '').trim();
  if (!title) return false;
  const lower = title.toLowerCase();
  if (NON_BOOK_KEYWORDS.some(k => lower.includes(k.toLowerCase()))) return false;
  // 教材不会上万；明显异常的高价视为乱挂
  const price = Number(book.price);
  if (Number.isFinite(price) && price > 3000) return false;
  return true;
}

// 统一走转发层调用。包一层的原因：
// 若 demoService.install() 没装成功，wx.cloud.callFunction 会是 undefined，
// 直接调用会抛同步 TypeError，.catch() 根本接不住 → 页面只显示"加载失败"、控制台一堆红错。
// 这里显式判断并返回一个「已 reject 的 Promise」，让错误能走到 catch 里被看见。
function callCloud(name, data) {
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.reject(new Error('转发层未安装：wx.cloud.callFunction 不可用（请检查 app.js 是否执行了 demoService.install）'));
  }
  try {
    return Promise.resolve(wx.cloud.callFunction({ name: name, data: data }));
  } catch (e) {
    return Promise.reject(e);
  }
}

Page({
  data: {
    bestsellers: [],
    recentReleases: [],
    keyword: '',
    isLoading: false,
    loadFailed: false,
    loadError: '',

    // 轮播：后台运营位 + 固定追加一页「购买说明」
    slides: [],
    bannerIndex: 0,
    showBuyGuide: false,
    buyGuideSteps: [
      '浏览教材，找到想要的书',
      '点击「确认购买」',
      '系统锁定该教材（不会扣款）',
      '卖家收到购买通知',
      '双方联系确认交易方式',
      '完成线下交付',
      '交易完成'
    ],

    // 专业年级荐书（华农本土化核心检索维度）
    majorLabels: ['专业不限'],
    gradeLabels: ['年级不限'],
    selectedMajorIndex: 0,
    selectedGradeIndex: 0,
    matchBooks: [],
    matchRequests: [],
    matchMessage: '选好专业和年级，看看同门师兄弟都在流转什么书',
    isMatching: false,
    hasRecommended: false
  },

  onLoad: function () {
    this.selectedMajor = '';
    this.selectedGrade = '';
    this.homepageBooks = [];
    this.allRequests = [];
    this.fetchHomepageBooks();
    this.fetchBanners();
  },

  onShow: function () {
    // 从发布页返回时刷新，保证新上架的书立刻出现在首页
    if (this.needRefreshOnShow) {
      this.needRefreshOnShow = false;
      this.fetchHomepageBooks(false);
    }
  },

  onUnload: function () {
    if (this.bannerTimer) clearInterval(this.bannerTimer);
  },

  onHide: function () {
    if (this.bannerTimer) { clearInterval(this.bannerTimer); this.bannerTimer = null; }
  },

  onPullDownRefresh: function () {
    this.fetchHomepageBooks(false).then(() => {
      wx.stopPullDownRefresh();
      if (!this.data.loadFailed) wx.showToast({ title: '刷新成功', icon: 'success', duration: 1000 });
    }).catch(() => wx.stopPullDownRefresh());
  },

  /* ---------------- 轮播 ---------------- */

  fetchBanners: function () {
    wx.cloud.callFunction({ name: 'getBanners' })
      .then(res => {
        const result = (res && res.result) || {};
        const banners = (result.success && Array.isArray(result.data)) ? result.data : [];
        // 运营位 + 固定「购买说明」页
        const slides = banners.map(b => ({ ...b, kind: 'banner' })).concat([{ id: '__buy_guide__', kind: 'guide' }]);
        this.setData({ slides, bannerIndex: 0 }, () => this.startBannerTimer());
      })
      .catch(() => {
        // 运营位加载失败不阻塞首页，至少保留购买说明页
        this.setData({ slides: [{ id: '__buy_guide__', kind: 'guide' }] });
      });
  },

  // 定时翻页：按 slides 总数取模，避免运营位刷新后下标越界
  startBannerTimer: function () {
    if (this.bannerTimer) { clearInterval(this.bannerTimer); this.bannerTimer = null; }
    if (this.data.slides.length <= 1) return;
    this.bannerTimer = setInterval(() => {
      const total = this.data.slides.length || 1;
      this.setData({ bannerIndex: (this.data.bannerIndex + 1) % total });
    }, 4000);
  },

  setBannerIndex: function (event) {
    const index = Number(event.currentTarget.dataset.index) || 0;
    this.setData({ bannerIndex: index });
  },

  // 点击当前页：购买说明页打开弹窗，运营位页走各自配置的链接
  onHeroClick: function () {
    const slide = this.data.slides[this.data.bannerIndex];
    if (!slide) return;
    if (slide.kind === 'guide') {
      this.setData({ showBuyGuide: true });
      return;
    }
    const link = String(slide.linkUrl || '').trim();
    if (!link) return;
    // 小程序内不能直接打开外链，站内路径走 navigateTo，外部链接复制给用户
    if (/^https?:\/\//.test(link)) {
      wx.setClipboardData({
        data: link,
        success: () => wx.showToast({ title: '链接已复制', icon: 'none' })
      });
      return;
    }
    wx.navigateTo({ url: link });
  },

  closeBuyGuide: function () {
    this.setData({ showBuyGuide: false });
  },

  noop: function () {},

  /* ---------------- 三入口 ---------------- */

  goPublish: function () {
    this.needRefreshOnShow = true;
    wx.navigateTo({ url: '/pages/publish/publish' });
  },

  goPublishRequest: function () {
    this.needRefreshOnShow = true;
    wx.navigateTo({ url: '/pages/publishRequest/publishRequest' });
  },

  // 「我要买书」不跳第二个页，而是停在当前首页往下划到书籍板块
  scrollToBrowse: function () {
    wx.pageScrollTo({
      selector: '#homeBrowseSection',
      duration: 300,
      fail: () => wx.pageScrollTo({ scrollTop: 720, duration: 300 })
    });
  },

  /* ---------------- 首页数据 ---------------- */

  fetchHomepageBooks: function (showLoading = true) {
    if (this.data.isLoading) return Promise.resolve();
    this.setData({ isLoading: true, loadFailed: false });
    if (showLoading) wx.showLoading({ title: '加载中...', mask: true });

    return callCloud('getBooksForHomepage')
      .then(res => {
        const result = (res && res.result) || {};
        if (!result.success || !result.data) {
          throw new Error(result.message || '加载首页数据失败');
        }
        const bestsellers = result.data.bestsellers || [];
        const recentReleases = result.data.recentReleases || [];
        // 求购列表失败不影响书籍板块展示
        return callCloud('getSeekingPosts', { page: 1, pageSize: 30 })
          .then(seekRes => {
            const seekResult = (seekRes && seekRes.result) || {};
            return (seekResult.success && Array.isArray(seekResult.data)) ? seekResult.data : [];
          })
          .catch(() => [])
          .then(requests => {
            this.setData({
              bestsellers: bestsellers.filter(isTextbook).map(this.decorateBook),
              recentReleases: recentReleases.filter(isTextbook).map(this.decorateBook),
              loadFailed: false,
              loadError: ''
            });
            this.prepareRecommendMatcher(bestsellers, recentReleases, requests);
          });
      })
      .catch(err => {
        const msg = (err && (err.message || err.errMsg)) || '网络请求失败，请稍后重试';
        console.error('[Homepage] load failed:', err);
        wx.showToast({ title: msg, icon: 'none', duration: 3000 });
        // 把真实错误留在页面上，方便截图定位（不再只显示一句笼统的「加载失败」）
        this.setData({ loadFailed: true, loadError: msg });
      })
      .then(() => {
        if (showLoading) wx.hideLoading();
        this.setData({ isLoading: false });
      });
  },

  // 列表项补充展示文案（专业/年级/课程号拼一行）
  decorateBook: function (book) {
    const metaLine = [book.major, book.grade, book.courseCode].filter(Boolean).join(' · ') || '在售';
    return Object.assign({}, book, { metaLine });
  },

  retryLoad: function () {
    this.fetchHomepageBooks();
  },

  navigateToBookDetail: function (event) {
    const bookId = event.currentTarget.dataset.id;
    if (!bookId) {
      wx.showToast({ title: '无法打开书籍详情', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/bookDetail/bookDetail?id=' + bookId });
  },

  handleKeywordInput: function (event) {
    this.setData({ keyword: event.detail.value });
  },

  submitSearch: function () {
    const keyword = String(this.data.keyword || '').trim();
    if (!keyword) {
      wx.showToast({ title: '请输入书名、课程号或作者', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: `/pages/search/search?keyword=${encodeURIComponent(keyword)}` });
  },

  goToCollection: function (event) {
    const collection = event.currentTarget.dataset.collection;
    if (['hot', 'recent'].indexOf(collection) < 0) return;
    wx.navigateTo({ url: `/pages/search/search?collection=${collection}` });
  },

  /* ---------------- 专业年级荐书 ---------------- */

  // 汇总首页在售书，并把专业/年级目录与现有数据合并（用户实际填写的值一并可选）
  prepareRecommendMatcher: function (bestsellers, recentReleases, requests = []) {
    const allBooks = [];
    const seenBookIds = new Set();
    [...bestsellers, ...recentReleases].forEach(book => {
      if (book && book.id && !seenBookIds.has(book.id)) {
        seenBookIds.add(book.id);
        allBooks.push(book);
      }
    });
    this.homepageBooks = allBooks;
    this.allRequests = requests || [];

    const majorSet = new Set(MAJORS);
    const gradeSet = new Set(GRADES);
    // 只吸收「白名单内」的专业/年级。早期版本会把真实数据里的任意字符串也并进选项，
    // 结果一条乱挂的商品就能污染整个下拉列表（曾出现 53 项被撑到 64 项）。
    const absorb = item => {
      const major = String((item && item.major) || '').trim();
      if (major && MAJORS.includes(major)) majorSet.add(major);
      const grade = String((item && item.grade) || '').trim();
      if (grade && GRADES.includes(grade)) gradeSet.add(grade);
    };
    allBooks.forEach(absorb);
    this.allRequests.forEach(absorb);

    const majorLabels = ['专业不限'].concat(Array.from(majorSet));
    const gradeLabels = ['年级不限'].concat(Array.from(gradeSet));
    const selectedMajorIndex = Math.max(majorLabels.indexOf(this.selectedMajor), 0);
    const selectedGradeIndex = Math.max(gradeLabels.indexOf(this.selectedGrade), 0);

    this.setData({
      majorLabels,
      gradeLabels,
      selectedMajorIndex,
      selectedGradeIndex,
      matchBooks: [],
      matchRequests: [],
      hasRecommended: false
    });
  },

  handleMajorChange: function (event) {
    const index = Number(event.detail.value) || 0;
    this.selectedMajor = index === 0 ? '' : (this.data.majorLabels[index] || '');
    this.setData({ selectedMajorIndex: index });
  },

  handleGradeChange: function (event) {
    const index = Number(event.detail.value) || 0;
    this.selectedGrade = index === 0 ? '' : (this.data.gradeLabels[index] || '');
    this.setData({ selectedGradeIndex: index });
  },

  // 逐级放宽：专业+年级 → 专业 → 年级
  localMatchBooks: function (major, grade) {
    const pick = (m, g) => (this.homepageBooks || []).filter(book =>
      (!m || String(book.major || '') === m) && (!g || String(book.grade || '') === g));
    if (major && grade) { const r = pick(major, grade); if (r.length) return r; }
    if (major) { const r = pick(major, ''); if (r.length) return r; }
    if (grade) { const r = pick('', grade); if (r.length) return r; }
    return [];
  },

  localMatchRequests: function (major, grade) {
    const pick = (m, g) => (this.allRequests || []).filter(item =>
      (!m || String(item.major || '') === m) && (!g || String(item.grade || '') === g));
    if (major && grade) { const r = pick(major, grade); if (r.length) return r; }
    if (major) { const r = pick(major, ''); if (r.length) return r; }
    if (grade) { const r = pick('', grade); if (r.length) return r; }
    return [];
  },

  runRecommend: function () {
    if (this.data.isMatching) return;
    const major = this.selectedMajor || '';
    const grade = this.selectedGrade || '';
    if (!major && !grade) {
      wx.showToast({ title: '请先选择专业或年级', icon: 'none' });
      return;
    }
    this.setData({ isMatching: true, hasRecommended: true, matchBooks: [], matchRequests: [], matchMessage: '正在为你精选教材…' });

    const attempts = [];
    if (major && grade) attempts.push({ major, grade });
    if (major) attempts.push({ major, grade: '' });
    if (grade) attempts.push({ major: '', grade });

    const tryNext = index => {
      if (index >= attempts.length) {
        // 全部落空 → 用首页已加载的数据本地兜底
        const local = this.localMatchBooks(major, grade);
        this.finishRecommend(local, local.length ? { major, grade } : null, local.length);
        return;
      }
      const query = attempts[index];
      wx.cloud.callFunction({
        name: 'getBooks',
        data: { type: 'recent', major: query.major, grade: query.grade, page: 1, pageSize: 3 }
      }).then(res => {
        const result = (res && res.result) || {};
        if (!result.success) throw new Error('荐书服务未返回结果');
        const list = result.data || [];
        if (list.length) {
          const total = Number(result.pagination && result.pagination.totalItems) || list.length;
          this.finishRecommend(list, query, total);
        } else {
          tryNext(index + 1);
        }
      }).catch(() => {
        const local = this.localMatchBooks(major, grade);
        this.finishRecommend(local, local.length ? { major, grade } : null, local.length);
      });
    };
    tryNext(0);
  },

  finishRecommend: function (matches, used, total) {
    const books = (matches || []).slice(0, 3).map(book => {
      const decorated = this.decorateBook(book);
      return Object.assign({}, decorated, {
        metaText: [book.major, book.grade, book.condition || '在售'].filter(Boolean).join(' · ')
      });
    });
    const requests = this.localMatchRequests(this.selectedMajor || '', this.selectedGrade || '')
      .slice(0, 2)
      .map(item => Object.assign({}, item, {
        metaText: '期望 ¥' + (item.seekingPrice || item.expectedPrice || '面议') +
          ' · ' + ([item.major, item.grade].filter(Boolean).join(' · ') || '校内面交')
      }));

    let message;
    if (!books.length) {
      message = '暂时没有匹配的在售教材，换个专业或年级试试';
    } else if (used && used.major && used.grade) {
      message = `已为「${used.major} · ${used.grade}」推荐 ${total} 本在售教材`;
    } else if (used && used.major) {
      message = `同年级暂无在售，先推荐「${used.major}」的 ${total} 本教材`;
    } else {
      message = `已为「${used.grade}」推荐 ${total} 本在售教材`;
    }

    this.setData({
      isMatching: false,
      matchBooks: books,
      matchRequests: requests,
      matchMessage: message
    });
  },

  respondToRequest: function (event) {
    const id = event.currentTarget.dataset.id;
    const item = (this.allRequests || []).find(req => String(req.id) === String(id)) || {};
    const title = item.title || '';
    const major = item.major || this.selectedMajor || '';
    const grade = item.grade || this.selectedGrade || '';
    wx.showModal({
      title: '回应同学求购',
      content: `发布一本教材，系统会自动带入${major || '专业'}${grade ? ' · ' + grade : ''}的信息。`,
      confirmText: '去发布',
      success: result => {
        if (!result.confirm) return;
        const params = [];
        if (title) params.push('title=' + encodeURIComponent(title));
        if (major) params.push('major=' + encodeURIComponent(major));
        if (grade) params.push('grade=' + encodeURIComponent(grade));
        params.push('fromRequest=1');
        this.needRefreshOnShow = true;
        wx.navigateTo({ url: `/pages/publish/publish?${params.join('&')}` });
      }
    });
  }
});
