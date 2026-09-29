// 管理员联系方式（华农书循环）。
// 认证材料有问题、或审核长时间未通过时，用户可通过这里联系管理员。
// 注：留空则不显示联系入口，避免出现无效信息。
const ADMIN_WECHAT = '';
const ADMIN_QQ = '';

function hasContact() {
  return Boolean(ADMIN_WECHAT || ADMIN_QQ);
}

// 复制管理员微信到剪贴板，成功/失败都给用户明确反馈
function copyAdminWechat() {
  if (!ADMIN_WECHAT) {
    wx.showToast({ title: '管理员微信暂未配置', icon: 'none' });
    return;
  }
  wx.setClipboardData({
    data: ADMIN_WECHAT,
    success: () => wx.showToast({ title: '已复制管理员微信', icon: 'success' }),
    fail: () => wx.showToast({ title: '复制失败，请手动记录', icon: 'none' })
  });
}

module.exports = { ADMIN_WECHAT, ADMIN_QQ, hasContact, copyAdminWechat };
