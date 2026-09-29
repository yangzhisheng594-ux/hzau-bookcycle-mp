// 云函数 api —— 华农书循环通用 HTTP 中转通道。
// 小程序端不能直连 WorkBuddy 托管后端（网关拦微信 UA，403「请在浏览器中打开」），
// 由本函数在腾讯服务器上用普通 UA 转发请求，后端与 H5 共用同一套数据。
//
// 入参两种形态：
// 1) { m, p, b, t }  → 普通转发：method / path(可含query) / JSON body / token
// 2) { up: { name, b64, t } } → 文件中转：base64 还原成 multipart 转给 /api/upload
//
// 返回统一为 { status, body }；body 尽量为 JSON 对象，非 JSON 时是原始字符串。
// 只用 Node 内置模块，无需安装任何第三方依赖，部署即生效。

const cloud = require('wx-server-sdk');
const https = require('https');
const { URL } = require('url');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const API_BASE = 'https://hzau-bookcycle.app.workbuddy.host';
const UPSTREAM_TIMEOUT_MS = 25000;

function httpRequest(method, fullPath, headers, bodyBuf) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(API_BASE + fullPath);
    } catch (e) {
      return reject(new Error('URL 不合法: ' + fullPath));
    }
    const req = https.request(
      {
        hostname: u.hostname,
        port: 443,
        path: u.pathname + u.search,
        method,
        headers
      },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed = raw;
          try { parsed = JSON.parse(raw); } catch (e) { /* 保留原始字符串 */ }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(UPSTREAM_TIMEOUT_MS, () => req.destroy(new Error('上游请求超时')));
    if (bodyBuf && bodyBuf.length) req.write(bodyBuf);
    req.end();
  });
}

exports.main = async event => {
  try {
    // ── 文件中转：base64 → multipart → POST /api/upload ──
    if (event && event.up) {
      const { name, b64, t } = event.up;
      if (!b64) return { status: 400, body: { success: false, message: '缺少文件内容' } };
      const buf = Buffer.from(b64, 'base64');
      const boundary = '----bookcycle' + Date.now();
      const safeName = String(name || 'file.jpg').replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
      // 后端 multer fileFilter 只放行 image/*，必须按扩展名给出正确的图片 MIME
      const ext = (safeName.match(/\.(\w+)$/) || [])[1] || 'jpg';
      const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
      const mime = MIME[ext.toLowerCase()] || 'image/jpeg';
      const pre = Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${safeName}"\r\n` +
        `Content-Type: ${mime}\r\n\r\n`
      );
      const post = Buffer.from(`\r\n--${boundary}--\r\n`);
      const body = Buffer.concat([pre, buf, post]);
      const fullPath = '/api/upload' + (t ? `?token=${encodeURIComponent(t)}` : '');
      return await httpRequest('POST', fullPath, {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }, body);
    }

    // ── 普通 JSON 转发 ──
    const { m, p, b, t } = event || {};
    if (!m || !p) return { status: 400, body: { success: false, message: '中转参数缺失' } };
    const fullPath = p + (t ? (p.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(t) : '');
    const data = b === undefined || b === null ? null : JSON.stringify(b);
    const headers = { 'Content-Type': 'application/json' };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    return await httpRequest(String(m).toUpperCase(), fullPath, headers, data ? Buffer.from(data) : null);
  } catch (e) {
    console.error('[api] 中转异常：', e);
    return { status: 0, body: { success: false, message: '中转异常：' + ((e && e.message) || '未知错误') } };
  }
};
