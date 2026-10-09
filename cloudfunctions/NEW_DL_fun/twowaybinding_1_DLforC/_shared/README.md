# _shared —— 云函数公共层（唯一编辑点）

## 为什么是「复制」而不是「引用」

微信云函数**每个目录是独立部署单元**，`require('../_shared/x')` 在上传后路径不存在。
所以 `_shared` 必须被**复制进每一个函数目录**，函数内部统一写 `require('./_shared/xxx')`。

```
NEW_DL_fun/
├── _shared/          ← 源，唯一编辑点，不部署
└── sync_shared.js    ← 把源复制进各函数目录
```

## 四条纪律（缺一条就等于没抽）

1. **副本只读**：`NEWDL_execution_order/_shared/runtime.js` 这类文件**永远不手工编辑**。
   改公共逻辑 = 改 `NEW_DL_fun/_shared/` → 跑 `node sync_shared.js`。
   脚本以源为准无脑覆盖，手改副本下次同步必丢。
2. **require 路径统一写 `./_shared/xxx`**，不要写 `'../_shared/...'`。
   路径统一是将来换 Layer / npm 包时唯一需要改的地方。
3. **上传前先跑一次同步**：`node sync_shared.js && node sync_shared.js --check`（第二条应输出「一致」）。
4. **`_shared` 里不许有 envVersion 分支 / dev-true 判断**。
   脚本把同一份副本喂给 `dev_index.js` 和 `true_index.js`，
   `_shared` 内部不做环境判断，所以它**不会引入新的 dev/true 分裂**。

## 已落地模块

| 文件 | 层 | 收编了什么 | 现状出处 |
|---|---|---|---|
| `runtime.js` | L0 | cloud.init 单例、请求级 env 解析、db/_、openid、traceId | 8 处 cloud.init；6 处模块级 `CURRENT_ENV_VERSION` |
| `collections.js` | L0 | 集合名唯一登记表 + 前缀规则 | 6 份 getCollectionName + DLforC 一份 |
| `request.js` | L0 | 入参归一化（callFunction / SCF HTTP / HTTP 访问服务） | execution_order:1198 |
| `errors.js` | L1 | 统一错误码 AppError / fail / ok / toResponse | 3 种返回口径并存 |
| `logger.js` | L1 | 统一前缀 + traceId + runtime_env | 6 份 logRuntimeEnvInfo |
| `http.js` | L1 | 出向 HTTPS 封装 + `ENDPOINTS` 地址登记表 | 3 条硬编码 URL + 两套手写 https 请求 |
| `security.js` | L1 | 内容安全判定 + 结果封装 + msg/imgSecCheck 云调用 | login_fun 与 mine_user 逐字重复的 3 个判定函数 |
| `courseState.js` | L2 | fulfill_state 状态值 + 终态判定 + state_history 后缀映射/去重 push + B 侧入参归一化 | execution_order 66 处 fulfill_state（写入 22 处）|

## 请求上下文：环境不许存模块级变量（2026-10-08）

**问题**：8 个业务函数把 envVersion 存成模块级 `let CURRENT_ENV_VERSION`，云函数实例复用时
上一次请求的环境会串到下一次。HTTP 访问服务 / HTTP 云函数下同一实例**可以并发处理多个请求**，
一个 develop 请求与一个 release 请求交错时，后者的集合前缀会覆盖前者 —— 正式流量会写进 `NDLdev_` 集合。

**解法**：`runtime.js` 提供请求级上下文，业务侧在入口包裹一次即可，深层 helper 零改动。

```js
// dev_index.js / true_index.js 的入口
const ctx = initRuntime(event)
return await runInContext(ctx, async () => {
  ...原逻辑（含 try/catch 整体）...
})

// 任意深度
function getCollectionName(baseName) {
  return normalizeCollectionName(baseName, currentIsDev())
}
```

| API | 用途 |
|---|---|
| `runInContext(ctx, fn)` | 把 fn 的整条 await 链绑定到本次请求的 ctx |
| `currentContext()` | 取本次请求的 ctx（拿不到返回 null）|
| `currentIsDev()` | 本次请求是否 develop（兜底 true，与历史默认值一致）|
| `currentEnvVersion()` | 本次请求的 envVersion（兜底 `'develop'`）|
| `ensureAls()` | 探测 AsyncLocalStorage 是否可用（并发隔离是否生效）|

**两条运行路径（自适应，代码只有一份）**：

| 运行时 | 行为 |
|---|---|
| Node 12.17+ / 13.10+（`AsyncLocalStorage` 可用） | 按异步链隔离，**并发彻底根治** |
| 腾讯云 SCF Node 12.16 档位（`AsyncLocalStorage` 缺失） | 退化为模块级单点 —— 与改造前**逐字等价**，不比现状更差，并打一条 WARN |

也就是说：现在改代码不会引入新的失败模式；把云函数运行时切到 Node 16.13+，
**同一份代码无需再改**即可自动获得并发隔离。

**包裹位置的两条硬要求**（踩过坑）：

1. 包裹必须**包住整个 `try/catch`**，不能插在 `try {` 里面 —— 否则 `catch` 会变成包裹的语法错误。
   `initRuntime()` 要提到 `try` 之前。
2. 包裹块内的缩进**沿用包裹前的层次、不整体重排** —— 为的是把 diff 压到最小便于逐行核对
   （`execution_order` 的 main 有 150 行，重排就没法 review 了）。

**已接入**：`execution_order` / `ResponseQRCode`（含 HTTP 9000 路径，它也走 `handleMain`）/ `login_fun`
/ `mine_user` / `ForOrganizationDo`，共 5 个 dev_index.js，`CURRENT_ENV_VERSION` 代码内归零。
`twowaybinding_1_DLforC` 本来就是显式传参（`getCollectionName(base, envVersion)`），无此问题，未动。

## 关于 http.js 的两条口径（不要混用）

出向调用存在**两种成功判定**，收编时按调用方原样保留：

| 调用方 | 判定 | 超时 |
|---|---|---|
| `ForOrganizationDo` → 自环境二维码 | `statusCode<400 && data.status === 'success'` | 20s |
| `NEWDL_execution_order` → B 侧 twowaybinding | `statusCode<400 && data.success !== false` | 20s（原无超时，本轮补上） |
| `NEWDL_ResponseQRCode` → B 侧二维码入口 | `statusCode<400 && data.success !== false` | 15s |

`postJson` 默认是第一种口径，用第二种时必须显式传 `isSuccess`。
`query` 里的对象会走 `JSON.stringify`——若退化成 `String(obj)` 会变成 `[object Object]`，B 侧解析不到。

## 关于 courseState.js 的两条口径（不要混用）

课程生命周期存在**两套「已结束」判定**，收编时按调用方原样保留：

| 调用方 | 判定 | 挡哪些状态 |
|---|---|---|
| `assignCoachByPickupCode`（接取） | `isClosedState()` | closed / cancelled（**不挡 completed**）|
| `requestCoachBinding` / `confirmCoachBinding` / `confirmGeneratePickupCode` / `markCourseInfoReady` | `isTerminalState()` | closed / cancelled / completed |

这两处口径本来就不一致（一个 2 个状态、一个 3 个状态），本轮**只收编不改判定**，
要不要统一需单独一轮确认——统一后「已完成但没结课」的课程会突然不能接取。

`TRANSITIONS` 是把现状抄下来的流转表，**当前没有启用任何强校验**：
现状存在 `awaiting → awaiting`（重置接取码）和 `in_progress → awaiting`（重置且不保留教练）
这类同态与回退，一旦拿它做门禁会把正在跑的业务拦死。

## 待补（下一轮，按需）

- 启用 `courseState.TRANSITIONS` 强校验（先把上面两条同态/回退的业务含义确认清楚）
- `ResponseQRCode.downloadBufferFromUrl` 有自定义 3xx 跟随逻辑，暂不收编
- **不做了**：`storage.js`（`NEWDL_list_storage` 下沉）—— 已评估过，该函数仅 60 行、
  是 `@cloudbase/manager-node` 的唯一调用点，没有任何重复实现，下沉只是「为分层而分层」，收益为 0。

## 迁移期注意

各函数接入 `_shared` 时要逐个替换、逐个验证，因为现有返回口径有 3 种、前端依赖 `.msg` 21 处。
`errors.ok()` 支持 `options.code` 覆盖，就是为了接入时能做到「前端零改动」。

**红线（用户明确约定）**：AI 只改 `dev_index.js`，**不碰 `true_index.js`、不执行 `sync-dev-to-true.js`**。
dev → true 只能由用户手动跑同步脚本。因此 `true_index.js` 里的 `CURRENT_ENV_VERSION` 等旧写法
会一直保留到用户同步为止 —— 这是预期状态，不是漏改。
