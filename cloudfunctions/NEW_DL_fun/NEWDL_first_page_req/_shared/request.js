/**
 * _shared/request.js —— L0 底座：入参归一化
 *
 * 从 NEWDL_execution_order/dev_index.js:1198 的 normalizeRequestEvent 原样迁出
 * （该函数已被 :1287 调用；true_index.js:964 是它的同步副本）。
 *
 * 背景：本函数既会被 wx.cloud.callFunction 直调（action 挂 event 顶层），
 * 也会走 HTTP 云函数 / SCF 网关 / HTTP 访问服务（action 在 queryStringParameters
 * 或 body 字符串 / body JSON 里）。经验 ID 1883158 已踩过坑：只读 event.action
 * 会让 HTTP 路径全部落进 default「未知操作」。
 *
 * 用法：
 *   const { normalizeRequestEvent } = require('./_shared/request')
 *   const { event: ev, debug } = normalizeRequestEvent(event)
 *   const action = ev.action
 */

/**
 * HTTP 查询字符串兼容：B 侧经 GET 中转时，数组和对象会先变成 JSON 字符串，这里统一回收成对象。
 * 原实现位于 NEWDL_execution_order/dev_index.js:56。
 */
function parseJsonLike(value, fallbackValue) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return fallbackValue;
  }
  if (typeof value === 'object') {
    return value;
  }
  const text = String(value || '').trim();
  if (!text) {
    return fallbackValue;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    return fallbackValue;
  }
}

function normalizeRequestEvent(rawEvent) {
  const event = rawEvent && typeof rawEvent === 'object' ? rawEvent : {};

  // 兼容 HTTP body：body 可能是 JSON 字符串，也可能是对象
  let bodyObj = null;
  if (typeof event.body === 'string' && event.body.length > 0) {
    try {
      const firstChar = event.body.trim().charAt(0);
      if (firstChar === '{' || firstChar === '[') {
        bodyObj = JSON.parse(event.body);
      }
    } catch (err) {
      bodyObj = null;
    }
  } else if (event.body && typeof event.body === 'object' && !Array.isArray(event.body)) {
    bodyObj = event.body;
  }

  const query = (event.queryStringParameters && typeof event.queryStringParameters === 'object')
    ? event.queryStringParameters
    : {};

  const candidates = [
    { name: 'event', payload: event },
    { name: 'event.data', payload: event && event.data },
    { name: 'event.queryStringParameters', payload: query },
    { name: 'event.body', payload: bodyObj },
    { name: 'event.body.data', payload: bodyObj && bodyObj.data }
  ];

  function pickFirstString(...keys) {
    for (let i = 0; i < candidates.length; i += 1) {
      const item = candidates[i];
      if (!item.payload || typeof item.payload !== 'object') continue;
      for (let j = 0; j < keys.length; j += 1) {
        const key = keys[j];
        const value = item.payload[key];
        if (typeof value === 'string') {
          return { value: value.trim(), source: `${item.name}.${key}` };
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
          return { value: String(value).trim(), source: `${item.name}.${key}` };
        }
      }
    }
    return { value: '', source: '' };
  }

  function pickPayload(sourceName) {
    for (let i = 0; i < candidates.length; i += 1) {
      const item = candidates[i];
      if (item.name === sourceName && item.payload && typeof item.payload === 'object') {
        return item.payload;
      }
    }
    return null;
  }

  const actionPick = pickFirstString('action', 'ACTION', 'op', 'operation');
  const orderIdPick = pickFirstString('orderId', 'order_id', 'id');

  // 入参对象合并优先级：找到 action 的那一层作为主 payload，再叠加 event 顶层字段；
  // 这样 HTTP/SCF 调过来时，业务里取 courseCode / inviteCode 都能取到。
  const sourcePayload = actionPick.source ? pickPayload(actionPick.source.split('.').slice(0, -1).join('.')) : null;
  const normalizedEvent = {
    ...event,
    ...(sourcePayload && typeof sourcePayload === 'object' ? sourcePayload : {}),
    action: actionPick.value,
    orderId: orderIdPick.value
  };

  return {
    event: normalizedEvent,
    debug: {
      topLevelKeys: Object.keys(event || {}),
      actionSource: actionPick.source,
      actionValue: actionPick.value,
      orderIdSource: orderIdPick.source,
      orderIdValue: orderIdPick.value,
      hasEventBody: Boolean(event.body),
      hasQueryStringParameters: Boolean(event.queryStringParameters),
      httpMethod: typeof event.httpMethod === 'string' ? event.httpMethod : '',
      path: typeof event.path === 'string' ? event.path : ''
    }
  };
}

module.exports = { normalizeRequestEvent, parseJsonLike };
