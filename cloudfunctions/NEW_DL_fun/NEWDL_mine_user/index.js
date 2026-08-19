// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env:'cloud1-6gh7jgl8c5b16a83' }) // 使用当前云环境
const db = cloud.database()

// 新增集合前缀规则：develop 使用 NDLdev_，trial/release 使用 NDLreal_
let CURRENT_ENV_VERSION = 'develop'

function getCollectionPrefix() {
  return CURRENT_ENV_VERSION === 'develop' ? 'NDLdev_' : 'NDLreal_'
}

function getCollectionName(baseName) {
  return `${getCollectionPrefix()}${baseName}`
}

// 新增手机号标准化：资料页联系电话统一收口成 11 位纯数字，避免历史分隔符或空格混入
function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '').slice(0, 11)
}

// 新增手机号格式校验：资料页联系电话必须是中国大陆 11 位手机号
function isValidPhone(phone) {
  return /^1[3-9]\d{9}$/.test(normalizePhone(phone))
}

// 新增资料文本标准化：统一去掉输入前后空格，避免昵称等字段被空白字符卡住保存
function normalizeProfile(profile = {}) {
  return {
    avatarUrl: typeof profile.avatarUrl === 'string' ? profile.avatarUrl.trim() : '',
    nickname: typeof profile.nickname === 'string' ? profile.nickname.trim() : '',
    phone: normalizePhone(profile.phone),
    experienceLevel: typeof profile.experienceLevel === 'string' ? profile.experienceLevel.trim() : '',
    studentCountLevel: typeof profile.studentCountLevel === 'string' ? profile.studentCountLevel.trim() : '',
    city: typeof profile.city === 'string' ? profile.city.trim() : '',
    address: typeof profile.address === 'string' ? profile.address.trim() : '',
    basicPhotoProof: typeof profile.basicPhotoProof === 'string' ? profile.basicPhotoProof.trim() : '',
    aboutMe: typeof profile.aboutMe === 'string' ? profile.aboutMe.trim() : '',
    workExperience: typeof profile.workExperience === 'string' ? profile.workExperience.trim() : '',
    education: typeof profile.education === 'string' ? profile.education.trim() : '',
    educationPhotoProof: typeof profile.educationPhotoProof === 'string' ? profile.educationPhotoProof.trim() : '',
    skills: typeof profile.skills === 'string' ? profile.skills.trim() : '',
    languages: typeof profile.languages === 'string' ? profile.languages.trim() : '',
    honors: typeof profile.honors === 'string' ? profile.honors.trim() : '',
    relatedCertificates: typeof profile.relatedCertificates === 'string' ? profile.relatedCertificates.trim() : '',
    honorShowcase: typeof profile.honorShowcase === 'string' ? profile.honorShowcase.trim() : ''
  }
}

// 新增用户资料提取：把数据库里的用户文档整理成前端页面直接可用的资料结构
function buildProfile(userDoc = {}) {
  const profileDetail = userDoc.profile_detail || {}
  return {
    avatarUrl: userDoc.avatarUrl || '',
    nickname: userDoc.nickname || '',
    phone: userDoc.phone || '',
    experienceLevel: userDoc.experienceLevel || '',
    studentCountLevel: userDoc.studentCountLevel || '',
    city: userDoc.city || '',
    address: userDoc.address || '',
    basicPhotoProof: profileDetail.basicPhotoProof || '',
    aboutMe: profileDetail.aboutMe || '',
    workExperience: profileDetail.workExperience || '',
    education: profileDetail.education || '',
    educationPhotoProof: profileDetail.educationPhotoProof || '',
    skills: profileDetail.skills || '',
    languages: profileDetail.languages || '',
    honors: profileDetail.honors || '',
    relatedCertificates: profileDetail.relatedCertificates || '',
    honorShowcase: profileDetail.honorShowcase || ''
  }
}

// 新增当前用户选档：优先命中 _id=openid 的标准档案，兼容旧数据继续按 openid 字段回查
function pickUserDoc(userDocs = [], openid = '') {
  const validDocs = userDocs.filter(item => !!item)
  if (!validDocs.length) {
    return null
  }

  const standardDoc = validDocs.find(item => item._id === openid)
  if (standardDoc) {
    return standardDoc
  }

  return validDocs.sort((a, b) => {
    const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime()
    const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime()
    return bTime - aTime
  })[0]
}

// 新增用户读取兜底：兼容一人一档新结构和历史 openid 查询结构
async function getCurrentUserDoc(usersCollection, openid) {
  let standardDoc = null
  try {
    const standardRes = await db.collection(usersCollection).doc(openid).get()
    standardDoc = standardRes && standardRes.data ? standardRes.data : null
  } catch (error) {
    standardDoc = null
  }

  const queryRes = await db.collection(usersCollection).where({ openid }).get()
  return pickUserDoc([standardDoc].concat(queryRes.data || []), openid)
}

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { OPENID, APPID, UNIONID } = wxContext
  const { action = 'getStats', profile = {}, shareLog = {}, envVersion = 'develop' } = event || {}
  CURRENT_ENV_VERSION = envVersion
  const usersCollection = getCollectionName('users')
  const shareVisitLogsCollection = getCollectionName('profile_share_visit_logs')

  if (!OPENID) {
    return {
      status: 'fail',
      message: '未获取到 openid'
    }
  }

  try {
    // 新增统一查当前用户：优先读取 _id=openid 的标准档案，同时兼容旧结构
    const userDoc = await getCurrentUserDoc(usersCollection, OPENID)

    if (action === 'getProfile') {
      return {
        status: 'success',
        profile: buildProfile(userDoc || {})
      }
    }

    if (action === 'logSharedProfileView') {
      // 新增分享访问入库：记录从分享页进入的 APPID 和访问时间
      await db.collection(shareVisitLogsCollection).add({
        data: {
          openid: OPENID,
          appid: APPID || '',
          clientAppId: typeof shareLog.clientAppId === 'string' ? shareLog.clientAppId.trim() : '',
          pagePath: typeof shareLog.pagePath === 'string' ? shareLog.pagePath.trim() : '/pages/profile/edit/edit',
          enteredAt: typeof shareLog.enteredAt === 'string' ? shareLog.enteredAt.trim() : '',
          createdAt: new Date()
        }
      })

      return {
        status: 'success',
        message: '分享访问日志记录成功'
      }
    }

    if (action === 'updateProfile') {
      const normalizedProfile = normalizeProfile(profile)
      if (!normalizedProfile.nickname) {
        return {
          status: 'fail',
          message: '请填写昵称'
        }
      }
      if (!isValidPhone(normalizedProfile.phone)) {
        return {
          status: 'fail',
          message: '请填写正确的11位手机号'
        }
      }

      const updateData = {
        updatedAt: new Date(),
        openid: OPENID,
        avatarUrl: normalizedProfile.avatarUrl || '',
        nickname: normalizedProfile.nickname || '',
        phone: normalizedProfile.phone || '',
        experienceLevel: normalizedProfile.experienceLevel || '',
        studentCountLevel: normalizedProfile.studentCountLevel || '',
        city: normalizedProfile.city || '',
        address: normalizedProfile.address || '',
        profile_detail: {
          basicPhotoProof: normalizedProfile.basicPhotoProof || '',
          aboutMe: normalizedProfile.aboutMe || '',
          workExperience: normalizedProfile.workExperience || '',
          education: normalizedProfile.education || '',
          educationPhotoProof: normalizedProfile.educationPhotoProof || '',
          skills: normalizedProfile.skills || '',
          languages: normalizedProfile.languages || '',
          honors: normalizedProfile.honors || '',
          relatedCertificates: normalizedProfile.relatedCertificates || '',
          honorShowcase: normalizedProfile.honorShowcase || ''
        }
      }

      if (userDoc) {
        await db.collection(usersCollection).doc(userDoc._id || OPENID).update({
          data: updateData
        })
      } else {
        // 新增一人一档建档：新用户直接使用 openid 作为 _id，避免重复资料导致提交看起来没生效
        await db.collection(usersCollection).doc(OPENID).set({
          data: {
            openid: OPENID,
            nickname: normalizedProfile.nickname || '微信用户',
            phone: normalizedProfile.phone || '',
            experienceLevel: normalizedProfile.experienceLevel || '',
            studentCountLevel: normalizedProfile.studentCountLevel || '',
            role: 'C',
            city: normalizedProfile.city || '',
            address: normalizedProfile.address || '',
            avatarUrl: normalizedProfile.avatarUrl || '',
            createdAt: new Date(),
            updatedAt: new Date(),
            isFirstLogin: false,
            profile_detail: {
              basicPhotoProof: normalizedProfile.basicPhotoProof || '',
              aboutMe: normalizedProfile.aboutMe || '',
              workExperience: normalizedProfile.workExperience || '',
              education: normalizedProfile.education || '',
              educationPhotoProof: normalizedProfile.educationPhotoProof || '',
              skills: normalizedProfile.skills || '',
              languages: normalizedProfile.languages || '',
              honors: normalizedProfile.honors || '',
              relatedCertificates: normalizedProfile.relatedCertificates || '',
              honorShowcase: normalizedProfile.honorShowcase || ''
            }
          }
        })
      }

      const latestDoc = await getCurrentUserDoc(usersCollection, OPENID)
      return {
        status: 'success',
        message: '保存成功',
        profile: buildProfile(latestDoc || {})
      }
    }

    // 保留 mine 页原调用：没有统计数据时先返回最小可用零值
    return {
      status: 'success',
      stats: {
        posts: 0,
        parttime: 0,
        followers: 0
      },
      openid: OPENID,
      appid: APPID,
      unionid: UNIONID
    }
  } catch (error) {
    console.error('NEWDL_mine_user 执行失败', error)
    return {
      status: 'fail',
      message: '用户信息处理失败',
      error
    }
  }
}
