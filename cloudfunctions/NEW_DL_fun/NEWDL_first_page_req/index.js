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

function formatTime(createTime) {
  const now = Date.now();
  const time = new Date(createTime).getTime();
  const diff = now - time;
  
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return '刚刚';
  if (diff < hour) return Math.floor(diff / minute) + '分钟前';
  if (diff < day) return Math.floor(diff / hour) + '小时前';
  if (diff < 7 * day) return Math.floor(diff / day) + '天前';

  const date = new Date(createTime);
  return `${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()}`;
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  // 新增环境版本识别：由前端透传 develop/trial/release
  CURRENT_ENV_VERSION = event.envVersion || 'develop';
  try {
    // 首页MVP只保留健康问卷模块
    const hotRes = await db.collection(getCollectionName('hot')).get();

    const sections = [
      { 
        id: 'Questionnaire', 
        title: '健康问卷', 
        posts: hotRes.data.map(post => ({ ...post, displayTime: formatTime(post.createTime) })) 
      }
    ];

    return { sections, openid: wxContext.OPENID };

  } catch (err) {
    return { error: err.message };
  }
};
