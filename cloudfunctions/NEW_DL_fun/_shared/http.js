/**
 * _shared/http.js —— L1 出向 HTTP 封装
 *
 * 治的病（现状实测）：
 *   1. 出向 URL 散落在业务文件里硬编码：ForOrganizationDo/dev_index.js:272 是自环境二维码服务，
 *      NEWDL_execution_order/dev_index.js:31 是 B 侧 twowaybinding，同一域名写两遍。
 *   2. 两处各自手搓 https 请求（一个 https.request POST、一个 https.get GET），
 *      响应体拼接 / JSON 解析 / 成功判定各写一套。
 *   3. GET 那条（requestBHttpApi）**没有设置超时**，对端不响应会让云函数一直挂到平台超时。
 *
 * 硬约束（见 _shared/README.md 第 3 条）：本文件内不允许出现 dev/true 判断。
 *   出向地址不区分 develop / release —— 同一个云环境同一个函数，
 *   请求体里的 envVersion 决定对端函数内部怎么分流。
 *
 * 用法：
 *   const { ENDPOINTS, postJson, getJson } = require('./_shared/http')
 *   const r = await postJson(ENDPOINTS.selfQrcode, { action: 'syncOrgShow', ... })
 */

const https = require('https');

/**
 * 出向地址登记表（唯一出处）
 * 三个地址来源：
 *   - selfQrcode       原 ForOrganizationDo/dev_index.js:272 A_SELF_QRCODE_HTTP_BASE_URL
 *   - bTwowaybinding   原 NEWDL_execution_order/dev_index.js:31 B_HTTP_BASE_URL
 *   - bQrcodeEntry     原 NEWDL_ResponseQRCode/dev_index.js:73 B_QRCODE_HTTP_BASE_URL
 * 前两者同域，抽 TENCLOUD_BASE 避免域名改一处漏一处；第三个是 B 侧独立云环境，单独登记。
 * 更正（2026-10-09）：上面"前两者同域"的假设不成立 —— twowaybinding_1_DLforP 只部署在 B 侧
 * 独立环境（cloud1-d7g77k8il914e5b12）且写 B 库 dev_ForP，A 环境无此函数、A 库无此集合。
 * bTwowaybinding 已单独登记 B 侧域名（对齐 bQrcodeEntry 的登记方式），TENCLOUD_BASE 仅剩 selfQrcode 使用。
 */
const TENCLOUD_BASE = 'https://cloud1-6gh7jgl8c5b16a83-1398046944.ap-shanghai.app.tcloudbase.com';

// B 侧独立云环境域名（2026-10-09 抽出：bTwowaybinding 修正后与 bQrcodeEntry 同域，避免域名改一处漏一处）
const B_TENCLOUD_BASE = 'https://cloud1-d7g77k8il914e5b12-1476831641.ap-shanghai.app.tcloudbase.com';

const ENDPOINTS = {
  // A 侧本环境（cloud1-6gh7jgl8c5b16a83）—— 拆双函数后按 D_/T_ 前缀区分，
  // 调用方（ForOrganizationDo）用 currentIsDev() 选择，本文件不判断环境（遵守硬约束）。
  selfQrcodeD: `${TENCLOUD_BASE}/D_NEWDL_ResponseQRCode`,
  selfQrcodeT: `${TENCLOUD_BASE}/T_NEWDL_ResponseQRCode`,
  // B 侧独立云环境（cloud1-d7g77k8il914e5b12）
  // 调整（2026-10-09）：原 `${TENCLOUD_BASE}/twowaybinding_1_DLforP` 打到了 A 自己环境，
  // 但该函数只部署在 B 仓库（写 B 库 dev_ForP），指向 A 环境必然 404 静默失败。
  // 现改为 B 侧域名，函数路径不变；调用方（NEWDL_execution_order 的 requestBHttpApi）无需改动。
  bTwowaybinding: `${B_TENCLOUD_BASE}/twowaybinding_1_DLforP`,
  // B 侧独立云环境（cloud1-d7g77k8il914e5b12）—— 原 NEWDL_ResponseQRCode/dev_index.js:73
  bQrcodeEntry: `${B_TENCLOUD_BASE}/DLforP_entry_qrcode`
};

/** 默认超时（毫秒）：沿用 ForOrganizationDo 的 SYNC_SHOW_HTTP_TIMEOUT_MS = 20000 */
const DEFAULT_TIMEOUT_MS = 20000;

/**
 * 把 payload 拼成 querystring。
 * 逐行迁移自 NEWDL_execution_order/dev_index.js:435（原 buildQueryString）：
 *   undefined 跳过 / null → 空串 / 对象 → JSON.stringify / 其余 → String()
 * 注意：对象必须 JSON.stringify，若退化成 String(obj) 会变成 '[object Object]'，B 侧解析不到。
 */
function buildQueryString(payload = {}) {
  const query = new URLSearchParams();

  Object.keys(payload || {}).forEach((key) => {
    const value = payload[key];

    if (typeof value === 'undefined') {
      return;
    }

    if (value === null) {
      query.append(key, '');
      return;
    }

    if (typeof value === 'object') {
      query.append(key, JSON.stringify(value));
      return;
    }

    query.append(key, String(value));
  });

  return query.toString();
}

/** 安全解析响应体；解析失败返回 invalidPayload 提供的兜底体 */
function parseBody(rawText, invalidPayload) {
  try {
    return rawText ? JSON.parse(rawText) : {};
  } catch (error) {
    return typeof invalidPayload === 'function' ? invalidPayload(rawText) : {};
  }
}

/**
 * 底层发起一次 HTTPS 请求。
 *
 * @param {Object} options
 * @param {string} options.url          完整 URL
 * @param {string} [options.method]     GET / POST
 * @param {Object} [options.query]      追加到 URL 的 query 参数
 * @param {Object} [options.body]       POST 请求体（对象，序列化为 JSON）
 * @param {number} [options.timeoutMs]  超时（毫秒），默认 20000
 * @param {Function} [options.invalidPayload] 响应体不是 JSON 时的兜底体生成函数
 * @param {Function} options.isSuccess  (statusCode, parsed) => boolean 成功判定
 * @param {string} [options.timeoutMessage] 超时错误文案
 * @param {Function} [options.onResponse] 响应观测钩子 (statusCode, rawText) => void
 * @returns {Promise<{success:boolean, requestUrl:string, statusCode:number, data:any}>}
 */
function request(options = {}) {
  const {
    url,
    method = 'GET',
    query = null,
    body = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    invalidPayload = null,
    isSuccess = (statusCode, parsed) => (statusCode || 0) < 400 && (!parsed || parsed.success !== false),
    timeoutMessage = '出向 HTTP 请求超时',
    // 响应观测钩子：把原始报文交给调用方打日志。NEWDL_ResponseQRCode 靠它排查 B 侧 502 / access_token，
    // 收编后不能把这些日志弄丢，所以在解析前先回调一次。
    onResponse = null
  } = options;

  const queryString = buildQueryString(query || {});
  const requestUrl = queryString ? `${url}?${queryString}` : url;
  const rawBody = body ? JSON.stringify(body) : '';

  return new Promise((resolve, reject) => {
    let urlObj;
    try {
      urlObj = new URL(requestUrl);
    } catch (err) {
      reject(new Error(`出向 HTTP 地址格式非法: ${url}`));
      return;
    }

    const req = https.request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port || undefined,
        path: `${urlObj.pathname}${urlObj.search}`,
        method,
        headers: rawBody
          ? {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': Buffer.byteLength(rawBody)
          }
          : {}
      },
      (response) => {
        let rawText = '';
        response.on('data', (chunk) => {
          rawText += chunk;
        });
        response.on('end', () => {
          if (typeof onResponse === 'function') {
            try {
              onResponse(response.statusCode || 0, rawText);
            } catch (e) {
              /* 观测钩子失败不能影响主流程 */
            }
          }
          const parsed = parseBody(rawText, invalidPayload);
          resolve({
            success: isSuccess(response.statusCode || 0, parsed),
            requestUrl,
            statusCode: response.statusCode || 0,
            data: parsed
          });
        });
      }
    );

    req.on('error', reject);
    if (timeoutMs > 0) {
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(timeoutMessage));
      });
    }
    if (rawBody) req.write(rawBody);
    req.end();
  });
}

/**
 * POST JSON：调 HTTP 云函数。
 * 默认成功判定沿用 ForOrganizationDo 口径：HTTP < 400 且业务体 status === 'success'。
 * B 侧二维码服务用的是 success !== false 口径，调用时需显式传 isSuccess。
 *
 * @returns {Promise<{success:boolean, requestUrl:string, statusCode:number, data:any}>}
 */
function postJson(url, payload = {}, options = {}) {
  const action = String((payload && payload.action) || options.action || '').trim();
  return request({
    url,
    method: 'POST',
    body: payload,
    query: action ? { action } : null,
    timeoutMessage: options.timeoutMessage || '调用出向 HTTP 服务超时',
    invalidPayload:
      options.invalidPayload
      || (() => ({ status: 'fail', message: '出向 HTTP 函数返回的不是 JSON' })),
    isSuccess:
      options.isSuccess
      || ((statusCode, parsed) => (statusCode || 0) < 400 && !!parsed && parsed.status === 'success'),
    ...options
  });
}

/**
 * GET JSON：带 querystring 调对端。
 * 成功判定沿用 execution_order 口径：HTTP < 400 且业务体 success !== false。
 *
 * @returns {Promise<{success:boolean, requestUrl:string, statusCode:number, data:any}>}
 */
function getJson(url, query = {}, options = {}) {
  return request({
    url,
    method: 'GET',
    query,
    timeoutMessage: options.timeoutMessage || '调用出向 HTTP 服务超时',
    invalidPayload:
      options.invalidPayload
      || ((rawText) => ({ success: false, message: '对端返回的不是 JSON', rawText })),
    isSuccess:
      options.isSuccess
      || ((statusCode, parsed) => (statusCode || 0) < 400 && (!parsed || parsed.success !== false)),
    ...options
  });
}

module.exports = {
  TENCLOUD_BASE,
  ENDPOINTS,
  DEFAULT_TIMEOUT_MS,
  buildQueryString,
  request,
  postJson,
  getJson
};
