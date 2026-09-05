// 新增统一启动入口：云函数平台仍然固定从 index.js 进入，避免改动 package.json 的 main 配置。
// 开发时请编辑 dev_index.js；需要发布时，先执行同步脚本把 dev_index.js 覆盖到 true_index.js。
// 调整（2026-09-04）：按用户设计实现「开发环境跑 dev_index.js、真实环境跑 true_index.js」的请求级分流。
// 分流依据与 dev_index.js 内部环境判断保持一致：envVersion 由前端每个请求传入，
// develop（开发环境）→ dev_index.js（最新开发版，上传部署即生效，无需执行同步脚本）；
// 其他值（真实环境 release 等）→ true_index.js（稳定发布版，仅由 sync-dev-to-true.js 同步更新）；
// 未传 envVersion 时默认按 develop 处理（与 dev_index.js 中 CURRENT_ENV_VERSION = event.envVersion || 'develop' 的默认一致）。
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
