# 华农书循环

华中农业大学二手教材流转小程序。按**专业 + 年级**找书，买书 / 卖书 / 求购三端联动，校内线下交付。

## 功能

| 模块 | 说明 |
| --- | --- |
| 荐书 | 首页按 63 个专业 + 6 个年级匹配教材 |
| 买书 | 搜索或浏览 → 详情 → 购物车 → 下单 |
| 卖书 | 填书籍信息、价格、成色 → 发布（需认证） |
| 求购 | 发求购帖，有人可「我有这本书」直接响应 |
| 订单 | 下单 → 待交付 → 交付中 → 已完成，线下交付 |
| 认证 | 未提交 / 审核中 / 已通过 / 已驳回，通过后才能发布 |

## 技术

| 层级 | 方案 |
| --- | --- |
| 前端 | 微信小程序原生（WXML / WXSS / JS） |
| 后端 | Node.js + SQLite，与 H5 端共用 |
| 通信 | `utils/demoService.js` 转发层，把 `wx.cloud.callFunction` 映射成 REST 请求 |
| 鉴权 | 免密登录，`openid` 即账号，token 走 query 参数 |

### 云函数中转

托管网关会拦 `User-Agent` 含 `MicroMessenger` 的请求（403），而微信禁止小程序自定义 UA，所以小程序无法直连后端。

`cloudfunctions/api` 作为中转：小程序调它 → 它在腾讯服务器上用普通 UA 转发到后端。业务代码不用改。

```text
页面 → callFunction({ name: 'getBooks' })
     → 转发层 → callFunction({ name: 'api', data: { m, p, b, t } })
     → 云函数普通 UA 请求后端 /api/*
```

## 目录

```text
├── app.js / app.json / app.wxss     入口与全局样式
├── cloudfunctions/api/              中转通道
├── pages/                           15 个页面（index / sell / request / cart /
│                                    profile / publish / publishRequest / bookDetail /
│                                    checkout / orderList / soldOrders / verify / search）
├── utils/
│   ├── demoService.js               转发层 + 路由映射
│   ├── catalog.js                   63 专业 / 6 年级
│   └── contact.js / util.js
└── images/                          书籍封面
```

## 运行

1. 微信开发者工具导入本目录
2. 点击**编译**

数据来自线上后端，需后端可访问。发布 / 求购要先通过身份认证。

## 部署

云函数需先上传才能用：

1. 开发者工具点**云开发**，关联环境
2. 右键 `cloudfunctions/api` → **上传并部署：云端安装依赖**
3. `Ctrl+B` 编译

## 说明

- 联系方式不在列表页公开，仅订单达成后可见
- 认证材料仅管理员可见
- 校园公益项目，不做商业支付

## 参考

派生自 [bnbu-second-hand-book-platform](https://github.com/taoyun0303-star/bnbu-second-hand-book-platform)（作者 Yun Tao）。
