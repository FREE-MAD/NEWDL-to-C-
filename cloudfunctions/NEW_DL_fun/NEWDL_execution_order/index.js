// 新增统一启动入口：云函数平台仍然固定从 index.js 进入，避免改动 package.json 的 main 配置。
// 开发时请编辑 dev_index.js；需要发布时，先执行同步脚本把 dev_index.js 覆盖到 true_index.js。
// 修复：历史上 true_index.js 长期未同步到最新，导致云端仍然走旧 switch-case（没有 get_order_by_course_code、
// assign_coach_by_pickup_code、confirm_generate_pickup_code、reset_pickup_confirm_code、mark_course_info_ready、
// syncParentBookingToA 等一整套 action），前端调用 NEWDL_execution_order 就会返回 404 未知操作，
// 且 old true_index.default 没有 debug/buildId 字段，使得前端无法定位，用户在 publish.js 里看到
// collaboration-fetch-btn 一直 loading「一致转圈」。
// 临时绕过：入口直接改挂 dev_index.js（当前开发版功能是齐全的）。
// 后续仍然可以执行 NEW_DL_fun/sync-dev-to-true.js 再改回 true_index；本注释保留，不删除。
// ai不可以操作true_index.js只可以操作dev_index.js'
// 唯一操作途径是通过这个文件C:\Users\32614\Desktop\sport_yun\代码_8月中进行重构cloudfunctions\NEW_DL_fun\sync-dev-to-true.js迁移
// ai不允许执行迁移
// 这个注释绝对不允许删除
// 说明（2026-09-04）：经用户一次性授权，本入口由「固定挂 dev_index.js」改为按 envVersion 请求级分流
// （develop→dev_index.js，其他→true_index.js），并已将 dev_index.js 同步到 true_index.js（dev=true）；
// 上方全部历史注释按约定原样保留、不删除。
const DEV_ENTRY = require('./dev_index.js');
const TRUE_ENTRY = require('./true_index.js');

module.exports = {
  // 云函数统一入口：按请求携带的 envVersion 选择 dev（开发）或 true（真实）版本代码执行
  main: async function (event = {}, context) {
    const envVersion = String((event && event.envVersion) || 'develop');
    if (envVersion === 'develop') {
      return DEV_ENTRY.main(event, context);
    }
    return TRUE_ENTRY.main(event, context);
  }
};
