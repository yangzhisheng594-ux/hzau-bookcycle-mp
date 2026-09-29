// 云函数调用 → 自建后端转发层。
// 上游项目跑在微信云开发（wx.cloud.callFunction），这里把调用接管到华农书循环的
// 自建后端上，页面代码无需改动。只需保证 API_BASE 指向你的服务端即可。
//
// ── 两种工作模式 ─────────────────────────────────────────────
// 1) 直连模式（CLOUD_ENV_ID 为空）：wx.request 直接打 API_BASE。
//    ⚠️ WorkBuddy 托管网关会拦微信 UA（403「请在浏览器中打开」），此模式在
//    开发者工具 / 真机小程序里注定全 403，仅保留作兜底。
// 2) 中转模式（CLOUD_ENV_ID 已填）：wx.cloud.callFunction('api') 走微信原生
//    通道到云函数，云函数在腾讯服务器上用普通 UA 转发到 API_BASE —— 绕开
//    UA 封锁，且与 H5 共用同一套后端数据。
// ────────────────────────────────────────────────────────────

// 华农书循环后端地址（与 H5 端同一套服务）
const API_BASE = 'https://hzau-bookcycle.app.workbuddy.host';

// 微信云开发环境 ID。留空 = 直连模式（小程序端会被网关 403）；
// 填入后 = 中转模式，需先在开发者工具里部署 cloudfunctions/api 云函数。
// 注：本机编译器缓存里有 cloud1-5ggo2ebwa1032c7f，说明该 AppID 已开通云开发。
const CLOUD_ENV_ID = 'cloud1-5ggo2ebwa1032c7f';

// 云函数名 → 自建后端 HTTP 路由 的映射。
// 值格式：[method, path, pathParamKey]；pathParamKey 用于把 data 里的 id 填进 /:id 占位。
const CLOUD_TO_API = {
  login:                 ['POST', '/api/auth/login'],
  getUserProfile:        ['GET',  '/api/auth/me'],
  updateUserProfile:     ['PUT',  '/api/users/me'],
  getBanners:            ['GET',  '/api/banners'],
  getCategories:         ['GET',  '/api/categories'],
  getBooksForHomepage:   ['GET',  '/api/books/homepage'],
  getBooks:              ['GET',  '/api/books'],
  getBookDetail:         ['GET',  '/api/books/:id', 'bookId'],
  addToCart:             ['POST', '/api/cart'],
  getCartItems:          ['GET',  '/api/cart'],
  deleteCartItems:       ['POST', '/api/cart/delete'],
  updateCartItem:        ['POST', '/api/cart'],
  createAndPayOrder:     ['POST', '/api/orders'],
  getOrders:             ['GET',  '/api/orders/mine'],
  confirmReceipt:        ['POST', '/api/orders/:id/complete', 'orderId'],
  getOrderCounts:        ['GET',  '/api/orders/counts'],
  getSellerOrders:       ['GET',  '/api/orders/mine'],
  shipOrderItem:         ['POST', '/api/orders/:id/trading', 'orderId'],
  getUserSellingBooks:   ['GET',  '/api/books/mine'],
  publishBook:           ['POST', '/api/books'],
  deletePublishedBook:   ['POST', '/api/books/:id/remove', 'bookId'],
  getSeekingPosts:       ['GET',  '/api/requests'],
  getPurchaseRequestDetail: ['GET', '/api/requests/:id', 'requestId'],
  publishOrUpdateRequest:['POST', '/api/requests'],
  deletePurchaseRequest: ['DELETE', '/api/requests/:id', 'requestId'],
  // 身份认证（发布/求购的前置门槛）
  submitVerification:    ['POST', '/api/verification'],
  getMyVerification:     ['GET',  '/api/verification/mine'],
  resendVerification:    ['POST', '/api/auth/resend-verification']
};

let installed = false;
let originalCallFunction = null;

// GET 请求把 data 拍平成 query string；带 :id 的路径用 idKey 从 data 里取值填充。
function buildRequest(name, data) {
  const entry = CLOUD_TO_API[name];
  if (!entry) return null;
  const [method, rawPath, idKey] = entry;
  let path = rawPath;
  const payload = { ...(data || {}) };
  if (idKey && payload[idKey] !== undefined) {
    path = path.replace(':id', encodeURIComponent(payload[idKey]));
    delete payload[idKey];
  }
  let query = '';
  if (method === 'GET') {
    const pairs = Object.keys(payload)
      .filter(key => payload[key] !== undefined && payload[key] !== null && payload[key] !== '')
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(payload[key])}`);
    if (pairs.length) query = `?${pairs.join('&')}`;
  }
  return { method, path: path + query, body: method === 'GET' ? undefined : payload };
}

// 从 filePath 里抠文件名（兼容 / 和 \），兜底 jpg
function fileNameOf(filePath) {
  const s = String(filePath || '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return (i >= 0 ? s.slice(i + 1) : s) || 'file.jpg';
}

// 中转模式：通过 api 云函数转发，返回 { result } 形态，签名与原 callFunction 一致
function relayCall(plan, token, name) {
  return Promise.resolve()
    .then(() => originalCallFunction({
      name: 'api',
      data: { m: plan.method, p: plan.path, b: plan.body, t: token || undefined }
    }))
    .then(res => {
      const r = (res && res.result) || {};
      const status = r.status || 0;
      let body = r.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) { body = null; }
      }
      const isObj = body && typeof body === 'object';
      if (isObj && typeof body.success === 'boolean') return { result: absolutize(body) };

      const raw = isObj ? (body.message || '') : String(r.body || '').slice(0, 120);
      console.warn('[BookCycle]', name, 'HTTP', status, '| 原始响应:', raw);
      return {
        result: {
          success: false,
          message: raw || `请求失败（HTTP ${status}）`,
          httpStatus: status
        }
      };
    })
    .catch(err => {
      console.error('[BookCycle]', name, '云函数中转失败：', err);
      const msg = (err && (err.errMsg || err.message)) || '';
      return {
        result: {
          success: false,
          message: msg.includes('FunctionName')
            ? '云函数 api 未部署：请在开发者工具 cloudfunctions/api 上右键「上传并部署」'
            : `云调用异常：${msg || '未知错误'}`
        }
      };
    });
}

// 后端存的图片/私有文件都是相对路径（H5 同源能直接用），
// 小程序 <image> 需要完整 URL，这里把响应体里这两类路径统一补成绝对地址。
const FILE_PREFIXES = ['/uploads/', '/api/files/'];
function absolutize(value) {
  if (typeof value === 'string') {
    return FILE_PREFIXES.some(p => value.startsWith(p)) ? API_BASE + value : value;
  }
  if (Array.isArray(value)) return value.map(absolutize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = absolutize(value[k]);
    return out;
  }
  return value;
}

function install() {
  if (installed) return;
  installed = true;

  // 关键：不能依赖 wx.cloud 存在。未开通云开发的环境里 wx.cloud 可能是 undefined，
  // 早期版本如果在此 return，整个转发层就装不上，页面会一直"加载失败"。
  // 这里先补齐 wx.cloud 对象，再覆盖 callFunction。
  if (!wx.cloud) wx.cloud = {};
  // 注意：中转模式下 app.js 会先 wx.cloud.init 再 install()，
  // 这里捕获到的就是 init 之后"真实的" callFunction。
  originalCallFunction = wx.cloud.callFunction;

  const relayMode = !!CLOUD_ENV_ID;

  // 用保持云函数调用签名不变，所有页面里的 wx.cloud.callFunction({ name, data }) 一行都不用改。
  wx.cloud.callFunction = options => {
    const name = (options && options.name) || '';

    // 中转模式：api 云函数本身就是通道，直接放行
    if (relayMode && name === 'api') return originalCallFunction(options);

    const plan = buildRequest(name, options && options.data);
    if (!plan) {
      console.warn('[BookCycle] 未映射的云函数：', name);
      return Promise.resolve({ result: { success: false, message: `暂不支持的功能：${name}` } });
    }
    const token = (wx.getStorageSync('token') || '').trim();

    if (relayMode) return relayCall(plan, token, name);

    // 直连模式（兜底）：wx.request 直打后端。
    // 托管网关会剥离所有鉴权 header，与 H5 端保持一致：把 token 放进 query 透传。
    const url = token
      ? `${API_BASE}${plan.path}${plan.path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
      : `${API_BASE}${plan.path}`;
    return new Promise(resolve => {
      wx.request({
        url,
        method: plan.method,
        data: plan.body,
        header: { 'content-type': 'application/json' },
        success: res => {
          let body = res.data;
          // wx.request 有时不会自动 JSON.parse（返回字符串），这里兜一层
          if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) { body = null; }
          }
          const isObj = body && typeof body === 'object';
          if (isObj && typeof body.success === 'boolean') return resolve({ result: absolutize(body) });

          // 拿不到标准响应体时，把 HTTP 状态码和原始内容一并暴露，方便定位
          const raw = isObj ? (body.message || '') : String(res.data || '').slice(0, 120);
          console.warn('[BookCycle]', name, 'HTTP', res.statusCode, '| 原始响应:', raw);
          resolve({
            result: {
              success: false,
              message: raw || `请求失败（HTTP ${res.statusCode}）`,
              httpStatus: res.statusCode
            }
          });
        },
        fail: err => {
          console.error('[BookCycle]', name, '请求失败：', err);
          resolve({ result: { success: false, message: `网络异常：${(err && err.errMsg) || '请检查后端是否可访问'}` } });
        }
      });
    });
  };

  wx.cloud.uploadFile = options => {
    const filePath = (options && options.filePath) || '';
    const token = (wx.getStorageSync('token') || '').trim();

    // 中转模式：读成 base64 交给 api 云函数，由它在腾讯服务器上组 multipart 转发
    if (relayMode) {
      return new Promise(resolve => {
        const fs = wx.getFileSystemManager();
        fs.readFile({
          filePath,
          encoding: 'base64',
          success: r => {
            originalCallFunction({
              name: 'api',
              data: { up: { name: fileNameOf(filePath), b64: r.data, t: token || undefined } }
            }).then(res => {
              const r2 = (res && res.result) || {};
              let body = r2.body;
              if (typeof body === 'string') {
                try { body = JSON.parse(body); } catch (e) { body = {}; }
              }
              body = body || {};
              const url = (body.data && (body.data.url || body.data.fileID)) || body.url || '';
              resolve(url ? { fileID: url } : { errMsg: body.message || '上传失败' });
            }).catch(err => resolve({ errMsg: (err && err.errMsg) || '上传失败' }));
          },
          fail: e => resolve({ errMsg: (e && e.errMsg) || '读取文件失败' })
        });
      });
    }

    // 直连模式（兜底）
    return new Promise(resolve => {
      wx.uploadFile({
        url: token
          ? `${API_BASE}/api/upload?token=${encodeURIComponent(token)}`
          : `${API_BASE}/api/upload`,
        filePath,
        name: 'file',
        header: {},
        success: res => {
          let body = {};
          try {
            body = JSON.parse(res.data || '{}');
          } catch (e) {
            body = {};
          }
          const url = (body.data && (body.data.url || body.data.fileID)) || body.url || '';
          resolve(url ? { fileID: url } : { errMsg: body.message || '上传失败' });
        },
        fail: err => resolve({ errMsg: (err && err.errMsg) || '上传失败' })
      });
    });
  };

  // 打个标记，方便启动时自检「转发层是否真的生效」
  wx.cloud.callFunction.__isForwarder = true;

  console.log('[BookCycle] 转发层已接管，模式：', relayMode ? `云函数中转（env=${CLOUD_ENV_ID}）` : '直连后端', '→', API_BASE);
}

module.exports = { isEnabled: () => false, CLOUD_ENV_ID, install };
