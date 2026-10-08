// 新增统一启动入口（与 ForOrganizationDo 等函数约定一致）：
// - 云函数平台固定从 index.js 进入，业务代码在 dev_index.js（开发）/ true_index.js（发布）；
// - 开发时请编辑 dev_index.js；需要发布时，先执行 sync-dev-to-true.js 把 dev_index.js 同步到 true_index.js；
// - HTTP 云函数模式下 scf_bootstrap 执行 `node index.js`，此时 require.main === module，
//   需要显式启动 9000 端口服务（callFunction 模式平台只 require 本文件并调用 exports.main，不会启动端口）。
// 调整（2026-09-05）：改为与 NEW_DL_fun 其他函数一致的 envVersion 请求级分流（用户确认后实施）。
// - callFunction 路径：按 event.envVersion 分流，develop（或未传）→ dev_index.js，其他（release/trial）→ true_index.js；
//   true_index.js 尚未由同步脚本生成时兜底用 dev，保证启动不报错（与旧版 try-true-catch-dev 行为一致）。
// - HTTP 路径：HTTP 请求的环境在请求体里、服务器启动时未知，因此 9000 端口服务固定由 dev 模块启动
//   （开发期上传 dev 即生效，不再有「改 dev 必须先同步才生效」的陷阱）；
//   请求级分流在 dev 的 HTTP 处理器内完成：解析出 envVersion 后，非 develop 请求转发给 true 模块处理
//   （转发逻辑详见 dev_index.js 的 TRUE_HTTP_ENTRY 与 http.event.parsed 之后的分流代码）。
const DEV_ENTRY = require('./dev_index.js');
let TRUE_ENTRY = null;
try {
  TRUE_ENTRY = require('./true_index.js');
} catch (error) {
  // 开发态兜底：true_index.js 尚未由同步脚本生成时，直接使用 dev_index.js，保证本地/联调可运行。
  TRUE_ENTRY = DEV_ENTRY;
}

module.exports = {
  // callFunction 统一入口：按请求携带的 envVersion 选择 dev（开发）或 true（真实）版本代码执行
  main: async function (event = {}, context) {
    const envVersion = String((event && event.envVersion) || 'develop');
    if (envVersion === 'develop') {
      return DEV_ENTRY.main(event, context);
    }
    return TRUE_ENTRY.main(event, context);
  },
  // HTTP 服务启动句柄：scf_bootstrap 以 `node index.js` 启动时调用。
  // 固定用 dev 模块起服务；非 develop 的 HTTP 请求由 dev 处理器内转发给 true（见 dev_index.js 分流逻辑）。
  startHttpServer: function () {
    return DEV_ENTRY.startHttpServer();
  }
};

if (require.main === module && typeof module.exports.startHttpServer === 'function') {
  module.exports.startHttpServer();
}
