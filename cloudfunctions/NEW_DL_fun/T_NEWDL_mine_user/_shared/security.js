/**
 * _shared/security.js —— L1 内容安全（微信 openapi 云调用）
 *
 * 治的病（现状实测）：
 *   isSecurityCheckPassed / isSecurityViolationError / isOpenAPIPermissionError 三个判定函数
 *   在 NEWDL_login_fun/dev_index.js:143/158/169 与 NEWDL_mine_user/dev_index.js:176/191/202
 *   各写一份，逐字重复；一旦微信改错误码要改两个文件。
 *   另有 isImageSizeLimitError / buildSafeResult / buildBlockedResult / buildImageTooLargeResult
 *   只在 mine_user 里，随安全链路一起下沉，保证结果结构只有一处定义。
 *
 * 硬约束（见 _shared/README.md 第 3 条）：本文件内不允许出现 dev/true 判断。
 *
 * 用法：
 *   const { callMsgSecCheck, isSecurityCheckPassed, isSecurityViolationError } = require('./_shared/security')
 */

const { initCloud } = require('./runtime');

/**
 * 内容安全结果判断：兼容 openapi 新旧返回结构，统一按 suggest 是否为 pass 判断。
 * （原 login_fun:143 / mine_user:176，两份实现逐字一致）
 */
function isSecurityCheckPassed(checkResult) {
  const errorCode = Number(checkResult && (checkResult.errCode || checkResult.errcode || 0));
  if (errorCode === 0) {
    return true;
  }

  const suggest = checkResult && checkResult.result && checkResult.result.suggest
    ? checkResult.result.suggest
    : checkResult && checkResult.suggest;
  return suggest === 'pass';
}

/** 内容违规错误识别：微信安全接口命中违规内容（errCode 87014） */
function isSecurityViolationError(error) {
  if (!error) {
    return false;
  }

  const errorCode = Number(error.errCode || error.errcode || error.code || 0);
  const errorMessage = String(error.errMsg || error.errmsg || error.message || '');
  return errorCode === 87014 || /risky|block|违规|违法|敏感/.test(errorMessage);
}

/** 云调用权限缺失识别：errCode -604101，需要重新上传云函数并确认 config.json */
function isOpenAPIPermissionError(error) {
  if (!error) {
    return false;
  }

  const errorCode = Number(error.errCode || error.errcode || error.code || 0);
  const errorMessage = String(error.errMsg || error.errmsg || error.message || '');
  return errorCode === -604101 || /has no permission to call this api/i.test(errorMessage);
}

/** 图片超限识别：errCode 45002，转成用户能看懂的「请压缩后再上传」 */
function isImageSizeLimitError(error) {
  if (!error) {
    return false;
  }

  const errorCode = Number(error.errCode || error.errcode || error.code || 0);
  const errorMessage = String(error.errMsg || error.errmsg || error.message || '');
  return errorCode === 45002 || /content size out of limit/i.test(errorMessage);
}

/** 统一的权限缺失报错文案（各函数只差函数名） */
function permissionError(functionName = '') {
  return new Error(`${functionName} 缺少 OpenAPI 权限，请重新上传云函数并确认 config.json 已生效`);
}

/** 结果封装：通过 / 违规 / 图片过大（原 mine_user:235/244/254） */
function buildSafeResult(extra = {}) {
  return { safe: true, message: '内容检查通过', ...extra };
}

function buildBlockedResult(extra = {}) {
  return { safe: false, message: '您发布的内容含违规信息', reason: 'security_blocked', ...extra };
}

function buildImageTooLargeResult(extra = {}) {
  return { safe: false, message: '图片过大，请压缩后再上传', reason: 'image_too_large', ...extra };
}

/**
 * 图片类型识别：按文件后缀推断 MIME（原 mine_user:90）
 * 不在后缀白名单里的一律按 image/jpeg 处理，与原有兜底一致。
 */
function guessImageContentType(fileID = '') {
  const lowerFileId = String(fileID || '').toLowerCase();
  if (lowerFileId.endsWith('.png')) return 'image/png';
  if (lowerFileId.endsWith('.webp')) return 'image/webp';
  if (lowerFileId.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

/**
 * 文本安全检测（msgSecCheck 直接云调用，不经二次云函数转发）。
 * 注意：本函数**不吞错误**，由调用方按 isSecurityViolationError / isOpenAPIPermissionError 分支处理，
 * 保持与各业务函数现有行为一致。
 *
 * @param {Object} options { content, openid, version = 2, scene = 1 }
 */
async function callMsgSecCheck(options = {}) {
  const {
    content = '',
    openid = '',
    version = 2,
    scene = 1
  } = options;

  const cloud = initCloud();
  return cloud.openapi.security.msgSecCheck({ content, version, scene, openid });
}

/**
 * 图片安全检测（imgSecCheck 直接云调用）。
 * 内部完成 downloadFile → 推断 contentType → imgSecCheck，调用方只需给 fileID。
 *
 * @param {Object} options { fileID }
 */
async function callImgSecCheck(options = {}) {
  const fileID = String((options && options.fileID) || '').trim();
  const cloud = initCloud();

  const downloadResult = await cloud.downloadFile({ fileID });
  return cloud.openapi.security.imgSecCheck({
    media: {
      contentType: guessImageContentType(fileID),
      value: downloadResult.fileContent
    }
  });
}

module.exports = {
  isSecurityCheckPassed,
  isSecurityViolationError,
  isOpenAPIPermissionError,
  isImageSizeLimitError,
  permissionError,
  buildSafeResult,
  buildBlockedResult,
  buildImageTooLargeResult,
  guessImageContentType,
  callMsgSecCheck,
  callImgSecCheck
};
