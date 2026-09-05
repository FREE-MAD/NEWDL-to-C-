const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const CURRENT_RUNTIME_SOURCE = 'dev_index.js'
let CURRENT_ENV_VERSION = 'develop'

function getCollectionPrefix() {
  return CURRENT_ENV_VERSION === 'develop' ? 'NDLdev_' : 'NDLreal_'
}

// 新增运行环境日志：用于快速判断当前定时云函数这次按什么环境、什么源码文件在执行
function logRuntimeEnvInfo(extra = {}) {
  console.log('[runtime_env]', {
    functionName: 'timer_check_orders',
    runtimeSource: CURRENT_RUNTIME_SOURCE,
    envVersion: CURRENT_ENV_VERSION,
    collectionPrefix: getCollectionPrefix(),
    ...extra
  })
}

exports.main = async (event = {}, context) => {
  CURRENT_ENV_VERSION = event.envVersion || 'develop'
  logRuntimeEnvInfo({
    triggerType: 'timer'
  })
  // MVP: 当前任务链路不再依赖自动锁班和拼团提醒
  return {
    msg: 'timer_check_orders skipped in MVP mode',
    processed: 0
  }
}
