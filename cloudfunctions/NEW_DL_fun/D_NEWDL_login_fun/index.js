// 调整（2026-10-08）：cloud.init / 集合名 / 运行日志 / 内容安全统一走公共层 _shared（源在 NEW_DL_fun/_shared/，副本只读）。
const { initRuntime, dbHandle, runInContext, currentIsDev } = require('./_shared/runtime');
const { normalizeCollectionName, prefix } = require('./_shared/collections');
const { make: makeLogger } = require('./_shared/logger');
const {
  isSecurityCheckPassed,
  isSecurityViolationError,
  isOpenAPIPermissionError,
  permissionError,
  callMsgSecCheck
} = require('./_shared/security');
// 调整（2026-10-09）：users 集合写入口收口到 userRepo。
const userRepo = require('./_shared/repos/userRepo');
const db = dbHandle();
const _ = db.command;
const ORDER_COLLECTION_BASE = 'execution_orders';
const FUNCTION_NAME = 'NEWDL_login_fun';
// 集合前缀规则已下沉到 _shared/collections.js（develop → NDLdev_，trial/release → NDLreal_）。
// 调整（2026-10-08）：环境不再存模块级变量 —— 改由 _shared/runtime.js 的请求上下文提供。
// main 里用 runInContext(ctx, ...) 包裹后，任意深度的调用都能通过 currentIsDev() 读到本次请求的
// envVersion，并发请求互不干扰（AsyncLocalStorage 可用时；不可用则退化为现状，见 runtime.js 注释）。
function getCollectionPrefix() {
  return prefix(currentIsDev());
}

function getCollectionName(baseName) {
  return normalizeCollectionName(baseName, currentIsDev());
}

// 新增教练资料痕迹判断：有自己的展示资料，就自动归入 C
function hasCoachProfile(userDoc = {}) {
  const profileDetail = userDoc.profile_detail || {};
  const profileValueList = [
    userDoc.avatarUrl,
    userDoc.phone,
    userDoc.experienceLevel,
    userDoc.studentCountLevel,
    userDoc.city,
    userDoc.address,
    profileDetail.basicPhotoProof,
    profileDetail.aboutMe,
    profileDetail.workExperience,
    profileDetail.education,
    profileDetail.educationPhotoProof,
    profileDetail.skills,
    profileDetail.languages,
    profileDetail.honors,
    profileDetail.relatedCertificates,
    profileDetail.honorShowcase
  ];

  return profileValueList.some(item => String(item || '').trim());
}

// 新增发布痕迹判断：只要当前用户发过课，就自动归入 C
async function hasPublishedCourse(openid = '', userId = '') {
  const executionOrdersCollection = getCollectionName(ORDER_COLLECTION_BASE);
  const publishQueryList = [
    { 'order_base_info.publisher_openid': openid },
    { publisher_openid: openid }
  ];

  if (userId) {
    publishQueryList.push({ 'order_base_info.publisher_Id': userId });
    publishQueryList.push({ publisher_Id: userId });
  }

  try {
    const publishRes = await db.collection(executionOrdersCollection).where(_.or(publishQueryList)).limit(1).get();
    return Array.isArray(publishRes.data) && publishRes.data.length > 0;
  } catch (error) {
    console.error('查询发课痕迹失败', error);
    return false;
  }
}

// 新增业务角色整理：资料痕迹或发课痕迹命中任一项即为 C，否则回落到 V
async function resolveBusinessRole(openid = '', userDoc = null, incomingRole = '') {
  const safeIncomingRole = String(incomingRole || '').trim();
  if (hasCoachProfile(userDoc || {})) {
    return 'C';
  }

  const userId = userDoc && userDoc._id ? userDoc._id : '';
  if (await hasPublishedCourse(openid, userId)) {
    return 'C';
  }

  if (safeIncomingRole === 'C' || safeIncomingRole === 'V') {
    return safeIncomingRole;
  }

  return 'V';
}

// 新增手机号标准化：登录链路里统一把手填手机号整理为 11 位纯数字
function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '').slice(0, 11);
}

// 新增手机号格式校验：手动登录/注册时只接受中国大陆 11 位手机号
function isValidPhone(phone) {
  return /^1[3-9]\d{9}$/.test(normalizePhone(phone));
}

// 新增登录历史标准化：兼容旧数据为对象/空值的情况，统一转成时间数组后再追加
function normalizeLoginHistory(loginHistory) {
  if (Array.isArray(loginHistory)) {
    return loginHistory.filter(item => !!item);
  }

  if (loginHistory && typeof loginHistory === 'object') {
    return Object.keys(loginHistory)
      .sort((a, b) => Number(a) - Number(b))
      .map(key => loginHistory[key])
      .filter(item => !!item);
  }

  return [];
}

// 新增静默补库识别：App 启动时的默认 V 补库走轻量登录链路，避免首屏被安全审核和业务痕迹查询拖慢
function isBootstrapLoginRequest(event = {}) {
  const safeNickname = String(event.nickname || '').trim();
  const safeRole = String(event.role || '').trim();
  const safeAvatarUrl = String(event.avatarUrl || '').trim();
  const safeAddress = String(event.address || '').trim();
  const hasManualPhone = !!normalizePhone(event.phone);
  const hasPhoneCode = !!String(event.phoneCode || '').trim();
  const isForcedNewUser = event.forceNewUser === true;

  return event.bootstrapLogin === true
    || (
      safeRole === 'V'
      && !hasManualPhone
      && !hasPhoneCode
      && !isForcedNewUser
      && !safeAvatarUrl
      && !safeAddress
      && (!safeNickname || safeNickname === '微信用户')
    );
}

// 新增角色兜底收口：登录链路里只接受当前已定义的 C / V，其他旧值统一回落到 V
function normalizeRole(role) {
  const safeRole = String(role || '').trim();
  return safeRole === 'C' || safeRole === 'V' ? safeRole : 'V';
}

// 注：isSecurityCheckPassed / isSecurityViolationError / isOpenAPIPermissionError 三个判定
// 已下沉到 _shared/security.js（本文件顶部 require），原实现与 NEWDL_mine_user 逐字重复。

// 新增登录文本安全检测：登录/补库写入昵称前，统一做资料场景文本审核
async function checkNicknameSecurity(content = '', openid = '') {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return true;
  }

  // 新增直接云调用：昵称审核改为在首层业务云函数内直接调用，避免二次云函数转发导致权限不生效
  try {
    const result = await callMsgSecCheck({
      content: text,
      version: 2,
      scene: 1,
      openid
    });
    return isSecurityCheckPassed(result);
  } catch (error) {
    if (isSecurityViolationError(error)) {
      return false;
    }
    if (isOpenAPIPermissionError(error)) {
      throw permissionError(FUNCTION_NAME);
    }
    throw error;
  }
}

exports.main = async (event, context) => {
  const { nickname, phone, role, forceNewUser, address, latitude, longitude, avatarUrl, phoneCode, firstLoginFrom } = event || {};
  // 公共层：一次 initRuntime 拿到本次请求的 env / db / openid / traceId
  const ctx = initRuntime(event || {});
  // 请求上下文包裹（2026-10-08）：把后续整条 await 链绑定到本次请求的 env，
  // 深层 helper 里的 getCollectionName 通过 currentIsDev() 读到的就是本次请求的环境。
  // 注：包裹块内的缩进沿用了包裹前的层次，未整体重排 —— 为的是把 diff 压到最小、便于逐行核对。
  return await runInContext(ctx, async () => {
  // 新增启动轻量登录标记：静默补库时跳过重操作，首屏先保证能快速建档
  const isBootstrapLogin = isBootstrapLoginRequest(event || {});
  const OPENID = ctx.openid;
  // 新增用户集合切换：开发版和正式版读取不同 users 集合
  const usersCollection = getCollectionName('users');

  if (!OPENID) return { status: 'fail', message: '未获取到 openid' };
  // MVP: P 侧身份已下线，云端兜底拒绝旧版本前端提交
  if (role === 'P') return { status: 'fail', message: 'P侧身份已下线，请使用教练端' };
  makeLogger(ctx).runtimeEnv({
    incomingRole: String(role || '').trim(),
    isBootstrapLogin,
    hasOpenid: !!OPENID
  });
  console.log('登录信息 - OPENID:', OPENID);
  console.log('传入参数:', { nickname, phone, role, forceNewUser, address, latitude, longitude, avatarUrl, phoneCode });
  // 新增本次打开时间：每次进入小程序都记录一条 ISO 时间，便于后续统计用户打开轨迹
  const currentLoginAt = new Date().toISOString();
  
  let finalPhone = normalizePhone(phone);
  if (!finalPhone && phoneCode) {
    try {
      // 用公共层已 init 的 cloud 实例（ctx.cloud），本文件不再直接 require('wx-server-sdk')
      const phoneRes = await ctx.cloud.openapi.phonenumber.getPhoneNumber({
        code: phoneCode
      });
      if (phoneRes && phoneRes.phone_info && phoneRes.phone_info.phoneNumber) {
        finalPhone = normalizePhone(phoneRes.phone_info.phoneNumber);
        console.log('解密得到手机号:', finalPhone);
      } else {
        console.log('未从 openapi 返回手机号信息');
      }
    } catch (e) {
      console.error('调用 openapi 解密手机号失败', e);
    }
  }
  // 新增手动登录兜底校验：未走微信手机号授权时，必须传入合法的 11 位大陆手机号
  if (!phoneCode && phone !== undefined && phone !== null && !isValidPhone(finalPhone)) {
    return { status: 'fail', message: '请填写正确的11位手机号' };
  }

  // 新增登录昵称内容安全：昵称属于资料发布内容，登录链路也必须做审核
  if (!isBootstrapLogin) {
    const nicknamePassed = await checkNicknameSecurity(nickname, OPENID);
    if (!nicknamePassed) {
      return { status: 'fail', message: '您发布的内容含违规信息' };
    }
  }
  
  try {
    const userRes = await db.collection(usersCollection).where({ openid: OPENID }).get();
    console.log('查询结果 - 找到用户数量:', userRes.data.length);

    if (userRes.data.length > 0) {
      const oldUser = userRes.data[0];
      console.log('找到已存在用户:', oldUser);
      // 新增静默补库轻量返回：启动阶段先沿用当前角色，完整业务角色后续由前端异步重算
      const resolvedRole = isBootstrapLogin
        ? normalizeRole(oldUser.role)
        : await resolveBusinessRole(OPENID, oldUser, role);
      
      // 检查是否真的是老用户（检查创建时间和完整性）
      const createdAt = new Date(oldUser.createdAt);
      const now = new Date();
      const timeDiff = now - createdAt;
      
      // 多重检查是否为新用户
      let isNewUserCheck = false;
      
      // 1. 时间检查：30秒内创建的算新用户
      if (timeDiff < 30000) {
        isNewUserCheck = true;
        console.log('时间检查：30秒内创建，判断为新用户');
      }
      
      // 2. 数据完整性检查：如果关键字段为空，可能是注册不完整
      if (!oldUser.nickname || !oldUser.role) {
        isNewUserCheck = true;
        console.log('数据完整性检查：关键字段缺失，判断为新用户');
      }
      
      // 3. 如果是刚刚设置角色，也算新用户
      if (role && oldUser.role !== role) {
        isNewUserCheck = true;
        console.log('角色变更检查：首次设置角色，判断为新用户');
      }
      
      // 4. 检查明确的首次登录标志
      if (oldUser.isFirstLogin === true) {
        isNewUserCheck = true;
        console.log('首次登录标志检查：isFirstLogin为true，判断为新用户');
      }
      
      console.log('用户创建时间:', createdAt);
      console.log('时间差(毫秒):', timeDiff);
      console.log('isFirstLogin标志:', oldUser.isFirstLogin);
      console.log('强制新用户标志:', forceNewUser);
      
      // 如果前端传入强制新用户标志，直接返回true
      if (forceNewUser === true) {
        isNewUserCheck = true;
        console.log('强制标记为新用户！');
      }
      
      console.log('最终是否为新用户:', isNewUserCheck);
      
      const updateData = {};
      // 新增登录历史写入：每次打开都往当前用户的登录时间列表尾部追加一条
      updateData.loginHistory = normalizeLoginHistory(oldUser.loginHistory).concat(currentLoginAt);
      // 新增静默补库保护：默认“微信用户”不覆盖用户已保存过的真实昵称
      if (nickname && (!isBootstrapLogin || !String(oldUser.nickname || '').trim())) updateData.nickname = nickname;
      if (finalPhone) updateData.phone = finalPhone;
      updateData.role = resolvedRole;
      if (address) updateData.address = address;
      if (latitude) updateData.latitude = latitude;
      if (longitude) updateData.longitude = longitude;
      // 新增静默补库保护：空头像或默认头像不覆盖已有头像
      if (avatarUrl && (!isBootstrapLogin || !String(oldUser.avatarUrl || '').trim())) updateData.avatarUrl = avatarUrl;
      updateData.updatedAt = new Date();
      
      // 如果不是新用户，清除首次登录标志
      if (!isNewUserCheck && oldUser.isFirstLogin) {
        updateData.isFirstLogin = false;
      }

      const updateRes = await userRepo.updateUserDoc(usersCollection, oldUser._id, updateData);
      console.log('更新用户成功', updateRes);
      
      const outLatitude = typeof updateData.latitude !== 'undefined' ? updateData.latitude : oldUser.latitude;
      const outLongitude = typeof updateData.longitude !== 'undefined' ? updateData.longitude : oldUser.longitude;
      const outAddress = typeof updateData.address !== 'undefined' ? updateData.address : oldUser.address;
      
      return {
        status: 'success',
        token: oldUser._id,
        openid: OPENID,
        nickname: nickname || oldUser.nickname,
        role: resolvedRole,
        avatarUrl: avatarUrl || oldUser.avatarUrl || '',
        isNewUser: isNewUserCheck,
        latitude: outLatitude || null,
        longitude: outLongitude || null,
        address: outAddress || ''
      };
    }

    const nextRole = isBootstrapLogin ? 'V' : await resolveBusinessRole(OPENID, null, role);

    const addRes = await userRepo.addUserDoc(usersCollection, {
      openid: OPENID,
      nickname: nickname || '微信用户',
      phone: finalPhone,
      role: nextRole,
      address: address || '',
      latitude: latitude || null,
      longitude: longitude || null,
      avatarUrl: avatarUrl || '',
      // 新增首次登录记录：新建档案时同步写入第一条打开时间
      loginHistory: [currentLoginAt],
      createdAt: new Date(),
      updatedAt: new Date(),
      isFirstLogin: true,
      // 新增首次进入来源：仅新建用户时写入，记录用户第一次进入小程序的来源页面/场景/参数，老用户不覆盖
      firstLoginFrom: firstLoginFrom && typeof firstLoginFrom === 'object' ? firstLoginFrom : null
    });
    console.log('创建用户成功', addRes);

    return {
      status: 'success',
      token: addRes._id,
      openid: OPENID,
      nickname: nickname || '微信用户',
      role: nextRole,
      avatarUrl: avatarUrl || '',
      isNewUser: true,
      latitude: latitude || null,
      longitude: longitude || null,
      address: address || ''
    };

  } catch (err) {
    console.error('数据库操作失败', err);
    return {
      status: 'fail',
      message: String((err && err.message) || '数据库写入失败'),
      err
    };
  }
  }); // ← runInContext 包裹结束
};
