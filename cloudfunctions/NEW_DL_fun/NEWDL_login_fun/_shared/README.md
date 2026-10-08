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

## 待补（下一轮，按需）

- `http.js`：3 条出向 URL 收编（ResponseQRCode:71 / execution_order:26 / ForOrganizationDo:281）
- `security.js`：内容安全 3 份合一（login_fun:189 / mine_user:274/316/369）
- `storage.js`：`NEWDL_list_storage` 下沉
- `domain/courseState.js`：L2 状态机 owner（fulfill_state 22 处写入 → 1）

## 迁移期注意

本轮**没有改动任何业务文件**（`index.js` / `dev_index.js` / `true_index.js` 全未触碰）。
各函数接入 `_shared` 时要逐个替换、逐个验证，因为现有返回口径有 3 种、前端依赖 `.msg` 21 处。
`errors.ok()` 支持 `options.code` 覆盖，就是为了接入时能做到「前端零改动」。
