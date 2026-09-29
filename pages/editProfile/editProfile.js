// pages/editProfile/editProfile.js
const app = getApp();
Page({
  data: {
    avatarUrl: '',
    nickName: ''
  },
  onLoad: function () {
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.setData({
        avatarUrl: userInfo.avatar_url || userInfo.avatarUrl || '',
        nickName: userInfo.nick_name || userInfo.nickName || ''
      });
    }
  },
  goBack() { wx.navigateBack(); },
  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    // 这里通常需要将 avatarUrl 上传到你的服务器，获取一个永久的URL
    // wx.uploadFile({ url: 'YOUR_UPLOAD_API', filePath: avatarUrl, name: 'file', ...})
    // 假设上传成功后，服务器返回 newAvatarServerUrl
    this.setData({ avatarUrl }); // 临时显示选择的，实际应为上传后的URL
    console.log("Choosen avatar (temp path):", avatarUrl);
  },
  onNicknameInput(e) {
    this.setData({ nickName: e.detail.value });
  },
  saveProfile: async function() {
    if (!this.data.nickName.trim()) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '保存中...' });
    try {
      let avatarUrl = this.data.avatarUrl;
      if (avatarUrl && !avatarUrl.startsWith('cloud://') && !avatarUrl.startsWith('http')) {
        const extension = (avatarUrl.match(/\.([a-zA-Z0-9]+)(?:\?|$)/) || [])[1] || 'png';
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath: `avatars/${Date.now()}-${Math.floor(Math.random() * 100000)}.${extension}`,
          filePath: avatarUrl
        });
        avatarUrl = uploadRes.fileID;
      }
      const res = await wx.cloud.callFunction({
        name: 'updateUserProfile',
        data: { updatedProfileData: { nickName: this.data.nickName.trim(), avatarUrl } }
      });
      if (!res.result || !res.result.success) {
        throw new Error((res.result && res.result.message) || '保存失败');
      }
      wx.hideLoading();
      const newUserInfo = {
        ...wx.getStorageSync('userInfo'),
        avatar_url: avatarUrl,
        avatarUrl,
        nick_name: this.data.nickName.trim(),
        nickName: this.data.nickName.trim()
      };
      app.globalData.userInfo = newUserInfo;
      wx.setStorageSync('userInfo', newUserInfo);
      app.notifyPagesLoginStateChanged(true, newUserInfo);
      wx.showToast({ title: '保存成功', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 800);
    } catch (error) {
      wx.hideLoading();
      console.error('[EditProfile] saveProfile failed:', error);
      wx.showToast({ title: error.message || '保存失败', icon: 'none' });
    }
  }
})
