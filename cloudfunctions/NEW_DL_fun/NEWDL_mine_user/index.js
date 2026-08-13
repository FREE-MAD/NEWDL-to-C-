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

// 新增用户资料提取：把数据库里的用户文档整理成前端页面直接可用的资料结构
function buildProfile(userDoc = {}) {
  const profileDetail = userDoc.profile_detail || {}
  return {
    nickname: userDoc.nickname || '',
    phone: userDoc.phone || '',
    city: userDoc.city || '',
    address: userDoc.address || '',
    aboutMe: profileDetail.aboutMe || '',
    workExperience: profileDetail.workExperience || '',
    education: profileDetail.education || '',
    skills: profileDetail.skills || '',
    languages: profileDetail.languages || '',
    honors: profileDetail.honors || ''
  }
}

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { OPENID, APPID, UNIONID } = wxContext
  const { action = 'getStats', profile = {}, envVersion = 'develop' } = event || {}
  CURRENT_ENV_VERSION = envVersion
  const usersCollection = getCollectionName('users')

  if (!OPENID) {
    return {
      status: 'fail',
      message: '未获取到 openid'
    }
  }

  try {
    // 新增统一查当前用户：所有资料编辑都只操作当前微信用户自己的记录
    const userRes = await db.collection(usersCollection).where({ openid: OPENID }).get()
    const userDoc = userRes.data[0] || null

    if (action === 'getProfile') {
      return {
        status: 'success',
        profile: buildProfile(userDoc || {})
      }
    }

    if (action === 'updateProfile') {
      const updateData = {
        updatedAt: new Date(),
        nickname: profile.nickname || '',
        phone: profile.phone || '',
        city: profile.city || '',
        address: profile.address || '',
        profile_detail: {
          aboutMe: profile.aboutMe || '',
          workExperience: profile.workExperience || '',
          education: profile.education || '',
          skills: profile.skills || '',
          languages: profile.languages || '',
          honors: profile.honors || ''
        }
      }

      if (userDoc) {
        await db.collection(usersCollection).doc(userDoc._id).update({
          data: updateData
        })
      } else {
        // 新增兜底建档：如果当前用户记录不存在，则直接补一份最小用户文档
        await db.collection(usersCollection).add({
          data: {
            openid: OPENID,
            nickname: profile.nickname || '微信用户',
            phone: profile.phone || '',
            role: 'C',
            city: profile.city || '',
            address: profile.address || '',
            avatarUrl: '',
            createdAt: new Date(),
            updatedAt: new Date(),
            isFirstLogin: false,
            profile_detail: {
              aboutMe: profile.aboutMe || '',
              workExperience: profile.workExperience || '',
              education: profile.education || '',
              skills: profile.skills || '',
              languages: profile.languages || '',
              honors: profile.honors || ''
            }
          }
        })
      }

      const latestRes = await db.collection(usersCollection).where({ openid: OPENID }).get()
      return {
        status: 'success',
        message: '保存成功',
        profile: buildProfile(latestRes.data[0] || {})
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
