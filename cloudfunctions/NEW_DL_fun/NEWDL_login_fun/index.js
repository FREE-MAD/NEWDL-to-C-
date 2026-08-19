const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-6gh7jgl8c5b16a83' });
const db = cloud.database();
// 新增集合前缀规则：develop 使用 NDLdev_，trial/release 使用 NDLreal_
let CURRENT_ENV_VERSION = 'develop';

function getCollectionPrefix() {
  return CURRENT_ENV_VERSION === 'develop' ? 'NDLdev_' : 'NDLreal_';
}

function getCollectionName(baseName) {
  return `${getCollectionPrefix()}${baseName}`;
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

exports.main = async (event, context) => {
  const { nickname, phone, role, forceNewUser, address, latitude, longitude, avatarUrl, phoneCode } = event || {};
  // 新增环境版本识别：由前端透传 develop/trial/release
  CURRENT_ENV_VERSION = event.envVersion || 'develop';
  const { OPENID } = cloud.getWXContext();
  // 新增用户集合切换：开发版和正式版读取不同 users 集合
  const usersCollection = getCollectionName('users');

  if (!OPENID) return { status: 'fail', message: '未获取到 openid' };
  // MVP: P 侧身份已下线，云端兜底拒绝旧版本前端提交
  if (role === 'P') return { status: 'fail', message: 'P侧身份已下线，请使用教练端' };
  console.log('登录信息 - OPENID:', OPENID);
  console.log('传入参数:', { nickname, phone, role, forceNewUser, address, latitude, longitude, avatarUrl, phoneCode });
  // 新增本次打开时间：每次进入小程序都记录一条 ISO 时间，便于后续统计用户打开轨迹
  const currentLoginAt = new Date().toISOString();
  
  let finalPhone = normalizePhone(phone);
  if (!finalPhone && phoneCode) {
    try {
      const phoneRes = await cloud.openapi.phonenumber.getPhoneNumber({
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
  
  try {
    const userRes = await db.collection(usersCollection).where({ openid: OPENID }).get();
    console.log('查询结果 - 找到用户数量:', userRes.data.length);

    if (userRes.data.length > 0) {
      const oldUser = userRes.data[0];
      console.log('找到已存在用户:', oldUser);
      
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
      if (nickname) updateData.nickname = nickname;
      if (finalPhone) updateData.phone = finalPhone;
      if (role) updateData.role = role;
      if (address) updateData.address = address;
      if (latitude) updateData.latitude = latitude;
      if (longitude) updateData.longitude = longitude;
      if (avatarUrl) updateData.avatarUrl = avatarUrl;
      updateData.updatedAt = new Date();
      
      // 如果不是新用户，清除首次登录标志
      if (!isNewUserCheck && oldUser.isFirstLogin) {
        updateData.isFirstLogin = false;
      }

      const updateRes = await db.collection(usersCollection).doc(oldUser._id).update({ data: updateData });
      console.log('更新用户成功', updateRes);
      
      const outLatitude = typeof updateData.latitude !== 'undefined' ? updateData.latitude : oldUser.latitude;
      const outLongitude = typeof updateData.longitude !== 'undefined' ? updateData.longitude : oldUser.longitude;
      const outAddress = typeof updateData.address !== 'undefined' ? updateData.address : oldUser.address;
      
      return {
        status: 'success',
        token: oldUser._id,
        nickname: nickname || oldUser.nickname,
        role: role || oldUser.role,
        avatarUrl: avatarUrl || oldUser.avatarUrl || '',
        isNewUser: isNewUserCheck,
        latitude: outLatitude || null,
        longitude: outLongitude || null,
        address: outAddress || ''
      };
    }

    if (!role) return { status: 'fail', message: '首次登录必须选择角色' };

    const addRes = await db.collection(usersCollection).add({
      data: {
        openid: OPENID,
        nickname: nickname || '微信用户',
        phone: finalPhone,
        role,
        address: address || '',
        latitude: latitude || null,
        longitude: longitude || null,
        avatarUrl: avatarUrl || '',
        // 新增首次登录记录：新建档案时同步写入第一条打开时间
        loginHistory: [currentLoginAt],
        createdAt: new Date(),
        updatedAt: new Date(),
        isFirstLogin: true
      }
    });
    console.log('创建用户成功', addRes);

    return {
      status: 'success',
      token: addRes._id,
      nickname: nickname || '微信用户',
      role,
      avatarUrl: avatarUrl || '',
      isNewUser: true,
      latitude: latitude || null,
      longitude: longitude || null,
      address: address || ''
    };

  } catch (err) {
    console.error('数据库操作失败', err);
    return { status: 'fail', message: '数据库写入失败', err };
  }
};
