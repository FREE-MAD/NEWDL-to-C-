// 新增统一启动入口（与 ForOrganizationDo 等函数约定一致）：
// - 云函数平台固定从 index.js 进入，业务代码在 dev_index.js（开发）/ true_index.js（发布）；
// - 开发时请编辑 dev_index.js；需要发布时，先执行 sync-dev-to-true.js 把 dev_index.js 同步到 true_index.js；
// - HTTP 云函数模式下 scf_bootstrap 执行 `node index.js`，此时 require.main === module，
//   需要显式启动 9000 端口服务（callFunction 模式平台只 require 本文件并调用 exports.main，不会启动端口）。
let entry
try {
  entry = require('./true_index.js')
} catch (error) {
  // 开发态兜底：true_index.js 尚未由同步脚本生成时，直接加载 dev_index.js，保证本地/联调可运行。
  entry = require('./dev_index.js')
}

module.exports = entry

if (require.main === module && typeof entry.startHttpServer === 'function') {
  entry.startHttpServer()
}
