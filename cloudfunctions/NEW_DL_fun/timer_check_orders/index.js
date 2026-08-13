const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async () => {
  // MVP: 当前任务链路不再依赖自动锁班和拼团提醒
  return {
    msg: 'timer_check_orders skipped in MVP mode',
    processed: 0
  }
}
