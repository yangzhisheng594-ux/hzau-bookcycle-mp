// pages/publishRequest/publishRequest.js
const app = getApp(); // 如果需要用到全局变量或方法
const { majorOptions, gradeOptions } = require('../../utils/catalog');

Page({
  data: {
    requestId: null, // 如果是编辑，则有值
    formData: {
      coverImageUrl: '', // 存储的是云存储的 FileID 或 HTTPS 临时链接
      expectedPrice: '',
      courseCode: '',
      major: '',
      grade: '',
      title: '',
      author: '',
      description: ''
    },
    // 华农本土化：专业 / 年级（与首页荐书、发布表单共用同一份目录）
    majorLabels: [],
    gradeLabels: [],
    majorIndex: 0,
    gradeIndex: 0,
    tempFileForUpload: null, // 临时存储用户选择的图片本地路径
    submitting: false,
    // 模拟的待编辑求购数据源 (实际应从云函数 getPurchaseRequestDetail 获取)
    // existingRequestData: { ... } // 这部分可以移除，或仅作本地测试用
  },

  // 认证门槛：返回 true 表示可继续发布，false 表示已引导去认证页（本页应中止）
  ensureVerified: async function () {
    let status = 'none';
    try {
      const res = await wx.cloud.callFunction({ name: 'getUserProfile' });
      const result = (res && res.result) || {};
      if (result.success && result.data) status = result.data.verifyStatus || 'none';
    } catch (e) {
      console.warn('[PublishRequest] 认证状态查询失败，放行交给后端判定:', e);
      return true;
    }

    if (status === 'approved') return true;

    const msg = status === 'pending'
      ? '身份审核中，审核通过后才能发布求购'
      : '发布求购前需先完成身份认证，是否现在去认证？';
    wx.showModal({
      title: '需要身份认证',
      content: msg,
      confirmText: status === 'pending' ? '知道了' : '去认证',
      showCancel: status !== 'pending',
      success: r => { if (r.confirm && status !== 'pending') wx.navigateTo({ url: '/pages/verify/verify' }); }
    });
    return false;
  },

  onLoad: async function (options) { // 改为 async 以便使用 await
    this.initCatalog();

    // 先过认证门槛：未认证时不让用户白填一整张表，直接引导去认证。
    const ok = await this.ensureVerified();
    if (!ok) return;

    if (options.id) {
      this.setData({ requestId: options.id });
      wx.setNavigationBarTitle({ title: '编辑求购' });
      await this.loadRequestDataFromServer(options.id); // 从服务器加载数据
    } else {
      wx.setNavigationBarTitle({ title: '发布求购' });
      this.setData({
        formData: { coverImageUrl: '', expectedPrice: '', courseCode: '', major: '', grade: '', title: '', author: '', description: '' },
        tempFileForUpload: null,
        requestId: null
      });
      // 从首页荐书带参进来：预填专业/年级
      const preset = {};
      if (options.major) preset.major = decodeURIComponent(options.major);
      if (options.grade) preset.grade = decodeURIComponent(options.grade);
      if (Object.keys(preset).length) this.applyCatalogSelection(preset);
      if (options.title) {
        this.setData({ 'formData.title': decodeURIComponent(options.title) });
      }
    }
  },

  goBack: function() { wx.navigateBack(); },

  /* ---------------- 专业 / 年级 ---------------- */

  initCatalog: function (extra = {}) {
    this.setData({
      majorLabels: majorOptions(extra.major || []),
      gradeLabels: gradeOptions(extra.grade || [])
    });
  },

  applyCatalogSelection: function ({ major = '', grade = '' } = {}) {
    const majorLabels = this.data.majorLabels.length ? this.data.majorLabels : majorOptions();
    const gradeLabels = this.data.gradeLabels.length ? this.data.gradeLabels : gradeOptions();
    const majorIndex = Math.max(majorLabels.indexOf(major), 0);
    const gradeIndex = Math.max(gradeLabels.indexOf(grade), 0);
    this.setData({
      majorLabels,
      gradeLabels,
      majorIndex,
      gradeIndex,
      'formData.major': major || majorLabels[majorIndex] || '',
      'formData.grade': grade || gradeLabels[gradeIndex] || ''
    });
  },

  onMajorChange: function (event) {
    const index = Number(event.detail.value) || 0;
    this.setData({ majorIndex: index, 'formData.major': this.data.majorLabels[index] || '' });
  },

  onGradeChange: function (event) {
    const index = Number(event.detail.value) || 0;
    this.setData({ gradeIndex: index, 'formData.grade': this.data.gradeLabels[index] || '' });
  },

  // 从服务器加载求购数据 (用于编辑)
  loadRequestDataFromServer: async function(requestId) {
    if (!requestId) return;
    wx.showLoading({ title: '加载中...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'getPurchaseRequestDetail', // 假设你有这个云函数
        data: { requestId: requestId }
      });
      wx.hideLoading();
      if (res.result && res.result.success && res.result.data) {
        const data = res.result.data;
        this.setData({
          formData: { // 假设云函数返回的数据结构与 formData 匹配
            coverImageUrl: data.coverImageUrl || '',
            expectedPrice: data.expectedPrice || '',
            courseCode: data.courseCode || '',
            major: data.major || '',
            grade: data.grade || '',
            title: data.title || '',
            author: data.author || '',
            description: data.description || ''
          },
          // 注意：如果 coverImageUrl 是 fileID，前端直接显示可能需要特殊处理或获取临时链接
          // 这里我们假设它已经是可直接显示的URL或fileID能在image标签中直接用
        });
        // 编辑时回填专业/年级（老数据不在目录里就并入选项）
        this.initCatalog({ major: [data.major].filter(Boolean), grade: [data.grade].filter(Boolean) });
        this.applyCatalogSelection({ major: data.major || '', grade: data.grade || '' });
      } else {
        wx.showToast({ title: (res.result && res.result.message) || '加载求购信息失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      console.error('加载求购信息失败:', err);
      wx.showToast({ title: '加载失败，请重试', icon: 'none' });
    }
  },

  handleInputChange: function(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    this.setData({
      [`formData.${field}`]: value
    });
  },

  // 选择封面图片
  chooseCoverImage: function () {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        // 预览并暂存，不立即上传
        this.setData({
          'formData.coverImageUrl': tempFilePath, // 临时显示本地路径供预览
          tempFileForUpload: tempFilePath // 存储真实本地路径用于后续上传
        });
      },
      fail: (err) => {
        if (err.errMsg !== "chooseMedia:fail cancel") {
          wx.showToast({ title: '选择图片失败', icon: 'none' });
        }
      }
    });
  },

  // 上传图片到云存储 (在提交表单时调用)
  uploadImageToCloudStorage: async function (filePath) {
    if (!filePath || !filePath.startsWith('wxfile://') && !filePath.startsWith('http://tmp/')) { // 简单判断是否是本地临时文件
      // 如果 filePath 已经是云存储的 FileID 或 HTTPS 链接 (编辑模式下未修改图片)，则直接返回
      if (this.data.formData.coverImageUrl === filePath) {
        return filePath;
      }
      // 如果是空或者无效路径，返回 null 或空字符串
      return null;
    }

    const cloudPath = `purchase_request_covers/${Date.now()}-${Math.floor(Math.random() * 100000)}.jpg`; // 自定义云端路径
    try {
      const uploadResult = await wx.cloud.uploadFile({
        cloudPath: cloudPath,
        filePath: filePath,
      });
      console.log('Upload success, fileID:', uploadResult.fileID);
      return uploadResult.fileID; // 返回云存储的 FileID
    } catch (err) {
      console.error('上传图片到云存储失败:', err);
      wx.showToast({ title: '封面上传失败', icon: 'none' });
      throw err; // 抛出错误，让 submitRequestForm 知道上传失败
    }
  },

  removeCoverImage: function () {
    this.setData({
      'formData.coverImageUrl': '',
      tempFileForUpload: null
    });
  },

  previewUploadedImage: function() {
    const previewUrl = this.data.formData.coverImageUrl;
    if (previewUrl) {
      // 如果是 FileID，可能需要先换取临时链接才能预览，但通常 image 标签能直接用 FileID
      wx.previewImage({
        current: previewUrl,
        urls: [previewUrl]
      });
    }
  },

  submitRequestForm: async function() { // 改为 async
    const values = this.data.formData;
    console.log('Request form data to submit:', values);

    if (!values.title.trim()) {
      wx.showToast({ title: '请输入书名', icon: 'none' });
      return;
    }
    if (!values.expectedPrice.trim() || isNaN(parseFloat(values.expectedPrice)) || parseFloat(values.expectedPrice) <= 0) {
      wx.showToast({ title: '请输入有效的期望价格', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: this.data.requestId ? '修改中...' : '发布中...', mask: true });

    let uploadedCoverFileID = values.coverImageUrl; // 默认为当前 formData 中的值 (可能是已有的 fileID 或空)

    // 如果用户新选择了图片 (tempFileForUpload 有值)
    if (this.data.tempFileForUpload) {
      try {
        uploadedCoverFileID = await this.uploadImageToCloudStorage(this.data.tempFileForUpload);
        if (!uploadedCoverFileID) { // 上传失败或返回空
            // uploadImageToCloudStorage 内部已提示，这里可以不再重复提示或给出更具体的
            wx.hideLoading();
            this.setData({ submitting: false });
            return; // 阻止后续提交
        }
      } catch (uploadError) {
        // uploadImageToCloudStorage 内部已提示
        wx.hideLoading();
        this.setData({ submitting: false });
        return; // 阻止后续提交
      }
    } else if (!values.coverImageUrl && this.data.requestId) {
      // 编辑模式下，如果用户移除了原有图片，则 coverImageUrl 为空
      uploadedCoverFileID = '';
    }


    const requestPayload = {
      requestId: this.data.requestId || null,
      requestData: {
        ...values, // 展开 formData 中的所有字段
        coverImageUrl: uploadedCoverFileID // 使用上传后的 FileID 或已有的/清空的
      }
    };

    try {
      const res = await wx.cloud.callFunction({
        name: 'publishOrUpdateRequest', // 确保你有这个云函数
        data: requestPayload
      });
      wx.hideLoading();
      if (res.result && res.result.success) {
        wx.showToast({ title: res.result.message || (this.data.requestId ? '修改成功' : '发布成功'), icon: 'success' });
        app.globalData.requestListNeedRefresh = true;
        // 触发前一个页面的刷新 (如果“我的求购”列表页需要更新)
        const pages = getCurrentPages();
        if (pages.length > 1) {
          const prevPage = pages[pages.length - 2];
          // 假设求购列表页是 'pages/requestList/requestList' 或 'pages/request/request'
          if ((prevPage.route === 'pages/requestList/requestList' || prevPage.route === 'pages/request/request') && typeof prevPage.onPullDownRefresh === 'function') {
            prevPage.onPullDownRefresh();
          }
        }
        setTimeout(() => {
          wx.navigateBack();
        }, 1500);
      } else {
        wx.showToast({ title: (res.result && res.result.message) || '操作失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      console.error('调用 publishOrUpdateRequest 云函数失败:', err);
      wx.showToast({ title: '请求失败，请重试', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  deleteRequest: function() {
    if (!this.data.requestId) return;
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这条求购信息吗？',
      confirmColor: '#e64340',
      success: async (res) => { // 改为 async
        if (res.confirm) {
          this.setData({ submitting: true });
          wx.showLoading({ title: '删除中...', mask: true });
          try {
            const delRes = await wx.cloud.callFunction({
              name: 'deletePurchaseRequest', // 确保你有这个云函数
              data: { requestId: this.data.requestId }
            });
            wx.hideLoading();
            if (delRes.result && delRes.result.success) {
              wx.showToast({ title: '删除成功', icon: 'success' });
              app.globalData.requestListNeedRefresh = true;
              const pages = getCurrentPages();
              if (pages.length > 1) {
                const prevPage = pages[pages.length - 2];
                if ((prevPage.route === 'pages/requestList/requestList' || prevPage.route === 'pages/request/request') && typeof prevPage.onPullDownRefresh === 'function') {
                  prevPage.onPullDownRefresh();
                }
              }
              setTimeout(() => {
                wx.navigateBack();
              }, 1500);
            } else {
              wx.showToast({ title: (delRes.result && delRes.result.message) || '删除失败', icon: 'none' });
            }
          } catch (err) {
            wx.hideLoading();
            console.error('调用 deletePurchaseRequest 云函数失败:', err);
            wx.showToast({ title: '删除请求失败', icon: 'none' });
          } finally {
            this.setData({ submitting: false });
          }
        }
      }
    });
  }
});
