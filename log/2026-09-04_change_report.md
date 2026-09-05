# 2026-09-04 改动说明

> 本次为一次集中提交，覆盖自上次提交（2026-08-21 `e1ec5c9 update profile review and share flow`）之后到 2026-09-04 的全部累积改动，共四条主线。

## 1. 本次改动目标

1. **课程协作与接取体系**：统一 A/B 两侧 M 码规则，新增 12 位接取码接单机制，建立课程生命周期（fulfill_state）与权限矩阵。
2. **云函数 dev/true 分流**：把 `NEW_DL_fun` 下云函数入口改为按 `envVersion` 请求级分流，解决"线上长期跑旧代码"的隐患。
3. **机构管理端（团队协作）**：新增机构 tab、机构创建/编辑分区表单、业务角色体系（bizRole）、认证页。
4. **二维码链路**：A 侧 `NEWDL_ResponseQRCode` 改造为 HTTP 云函数并支持中间 Logo 合成，修复 DIY 二维码合成失败。

---

## 2. 先遇到了什么问题

### 2.1 课程码与协作单

- A 侧教练直接建课（fromA）与 B 侧家长预约（fromB）生成的 M 码口径不一致，教练按课程码查课时经常查不到，根因是 A 侧查询候选字段里没有 `parent_course_code`。
- 中途做过一版独立的 8 位"课程码"，与 M 码职责重叠、两套码并存造成混乱，09-01 已整体撤回，保留 M 码单轨。
- 协作单按码回填表单时，把教练侧字段（课程标题、教练私人备注、价格档、允许转派其他教练）也一并覆盖了，属于越权回填。
- 输入课程码后**首次**进入必报"未知操作"，第二次才正常：云函数冷启动时平台可能还挂着旧版本代码，旧代码没有新 action 也没有 buildId/debug 字段，前端无法定位。

### 2.2 接单与权限

- 课程管理页任何角色进来都能改课程结构，缺少生命周期门禁。
- 家长桥接课程初始化为 `fulfill_state='pending'`，导致 progress 列表当它可编辑、publish 详情页却把它锁死，两处表现互相矛盾。
- 机构外教练没有安全的接单凭据，需要一个可重置、可失效的接单码机制。

### 2.3 云端代码版本

- 线上 `true_index.js` 长期未同步，云端仍是旧 switch-case（没有 `get_order_by_course_code`、`assign_coach_by_pickup_code`、`confirm_generate_pickup_code`、`reset_pickup_confirm_code`、`mark_course_info_ready`、`syncParentBookingToA` 等一整套 action），前端调用直接 404，且 `collaboration-fetch-btn` 一直转圈。

### 2.4 机构与二维码

- 二维码归属错误：最初用 A 侧环境生成 B 侧小程序码，码的归属 AppID 不对，必须用 B 侧云环境生成。
- scene 参数直接放业务 ID 有未来兼容隐患，需要 entryId 间接层。
- HTTP 云函数（scf_bootstrap + 监听 9000 端口）不能用 `wx.cloud.callFunction` 调用，报 `-501001 FunctionType parameter is invalid`。
- HTTP 调用缺少微信身份上下文，未显式传 `organizationId` 时报"HTTP 调用必须传 organizationId"。
- DIY 二维码合成失败：前端把 PNG/GIF/WEBP 等非 JPEG 格式图片**写死 .jpg 后缀**上传，后端按文件魔数识别解码时失败。
- 中间 Logo 合成若引入 jimp 依赖会超出云函数包体限制。

---

## 3. 是怎么调整的

### 3.1 M 码统一与 12 位接取码

- **M 码规则统一**：8 位长度，首字符 `A`(fromA)/`B`(fromB) + 7 位字符集（去 0/O/1/I/L 歧义字符）；查重覆盖 `joinCode / courseCode / parent_course_code` 三字段，最多 10 次重试；B 侧预约三个字段写入同一个 M 码；A 侧 `getOrderByCourseCode` 候选字段加入 `parent_course_code` 并增加 8 位格式校验。
- **12 位接取码** = 8 位 M 码 + 4 位确认码。`NEWDL_execution_order/dev_index.js` 新增 `buildPickupConfirmCode / normalizePickupFullCode / splitPickupFullCode / buildPickupFullCode / assign_coach_by_pickup_code / reset_pickup_confirm_code`：
  - 任何教练（不限机构归属）可凭 12 位码接单；已关闭/取消课程拒绝接取；已被接取返回 409 并带当前教练姓名。
  - `reset_pickup_confirm_code` 立即失效旧码、默认清空已分配教练（`keepCoach=true` 可保留教练只换码）、仅课程创建者可调用。
- **发布改两步**：先"完成课程信息编辑，允许教练接单"（`mark_course_info_ready`）→ 再"确认生成 12 位接取码"（`confirm_generate_pickup_code`）；发布页新增接取码展示卡片（复制/重置）。
- **首页新增课程接取入口**：输入校验 + 提交逻辑。

### 3.2 生命周期与权限矩阵

- fulfill_state 严格按 `editing → awaiting → in_progress` 流转；创建时初始化为 `editing`、`course_info_ready_at=null`。
- 权限矩阵：仅 `editing` 态 + 课程创建者可管理；其余状态/角色一律只读；教练对已接课程只能写每日总结，不能改结构。
- `progress.js buildOrderLifecycleMeta` 用 `currentUser(openid, userId)` 计算 `canManageClass`；为 false 时隐藏"进入管理"、显示"查看详情"。
- 自由教练（`BIZ_ROLE_FREE_COACH`）在课程管理列表只看自己创建/接取的课程；列表展示"执行教练：xx(我)"或"待接取教练"。
- **冷启动 404 兜底**：dev_index.js 使用显式路由表 + buildId（`DEV_NDL_20260902_1`）+ action 诊断日志；`publish.js` 首次 404 自动延迟 500ms 重试一次，Toast"云端预热中，重试一次"。
- `applyCollaborativeOrderToForm` 不再覆盖教练侧字段（title、coach_private_note、price_interval、allow_transfer_to_other_coach），仅回填家长侧协作信息。

### 3.3 dev/true 请求级分流

- `NEW_DL_fun` 下 8 个函数（ForOrganizationDo、NEWDL_execution_order、NEWDL_first_page_req、NEWDL_login_fun、NEWDL_mine_user、NEWDL_security_center、NEWDL_security_check、timer_check_orders）的 `index.js` 改为统一 dispatcher：`develop → dev_index.js`（上传即生效，无需同步），其他值 `→ true_index.js`；未传 envVersion 默认按 develop；timer_check_orders 定时触发无 envVersion，固定走 dev 分支。
- 各函数 `package.json` 增加 `sync:index / sync:all` 脚本；`uploadCloudFunction.sh` 发布前先执行 `sync-dev-to-true.js`。
- `NEWDL_ResponseQRCode` 为 HTTP 特殊入口、无 true 文件，维持 try-true-catch-dev 现状，不在分流改造范围。
- 21 个旧函数归档至 `cloudfunctions/_legacy_disabled/`；清理 `pdd_chat_massage` 残留的 node_modules。
- 按约定：历史注释原样保留不删除；AI 不操作 true_index.js、不执行迁移（唯一途径 `sync-dev-to-true.js`，由用户手动执行）。

### 3.4 机构管理端与角色体系

- 新增"团队协作"底部 tab（`pages/organization/organization`、`pages/organization/organization_create`）与 `pages/index/do_certification` 认证页；新增 `utils/bizRole.js`（`BIZ_ROLE_VISITOR / BIZ_ROLE_FREE_COACH`、`getBizRoleLabel`、机构资料工具函数）；`app.js` 提供全局业务身份（bizRole + organizationProfile）。
- **创建表单分区**：区块一 `Oncegenerated_cannotbemodified`（机构名称、邀请码前缀、DIY 二维码图片，必填且生成后不可修改）；区块二 `PendingSupplement`（联系人/电话/城市/地址/简介/轮播图）门控解锁——必须等区块一提交成功且拿到 A 侧 `qrcodeFileId` 后才可编辑；编辑态（机构已创建）进页直接可编辑。
- `createOrganization` 阶段联系电话改选填（填了才校验）；`updateOrganization` 保持手机号强制校验；更新白名单不含 `diy_qrcode_image / invitation_prefix / invitation_code`（生成后不可修改）。
- 机构码复制功能（organizationview 结果卡）；首页"低费认证"入口与核心功能卡位置对调。

### 3.5 二维码链路

- `NEWDL_ResponseQRCode` 改造为 HTTP 云函数（scf_bootstrap + 监听 9000 端口）：HTTP 调用显式传 `organizationId`（organization_create.js 三处调用补参 + 空值兜底）；前端全部改用 `wx.cloud.callHTTPFunction`（基础库要求 ≥ 3.15.1，返回体在 `res.data`），`project.config.json` libVersion 3.12.1 → 3.15.1。
- **中间 Logo 合成**：pngjs + jpeg-js 纯 JS 实现（避免 jimp 超包体）；Logo 宽 = 码宽 20%、白色衬底 pad 8%、双线性缩放、alpha 混合；合成失败退化为普通码不阻断主流程。
- **DIY 二维码修复（09-04）**：前端 `organization_create.js` 上传前校验文件魔数——PNG（89 50 4E 47）→ `.png`；JPEG（FF D8）→ `.jpg`；其他格式（WEBP/RIFF、GIF8、BM、HEIC…）拦截并 Toast"请上传PNG或JPG格式图片"；后端补充 DIY 全链路诊断日志（DB 字段状态、下载文件魔数、解码结果、合成参数）。

---

## 4. 改动清单

### 云函数（cloudfunctions/NEW_DL_fun/）

| 文件 | 改动 |
| --- | --- |
| 8 个函数的 `index.js` | 改为 envVersion 请求级分流 dispatcher |
| 7 个函数的 `dev_index.js` / `true_index.js` | 新增；业务逻辑迁移至 dev，true 由 sync 脚本维护 |
| `NEWDL_execution_order/dev_index.js` | M 码统一规则、get_order_by_course_code、12 位接取码全套 action、mark_course_info_ready、路由表 + buildId |
| `ForOrganizationDo/` | 新函数：机构创建/编辑（分区字段、白名单控制） |
| `NEWDL_ResponseQRCode/` | 新函数：HTTP 云函数、二维码生成转存、Logo 合成、DIY 诊断日志 |
| `sync-dev-to-true.js` | 新增 dev→true 同步脚本（用户手动执行） |
| 各 `package.json` | 增加 sync:index / sync:all 脚本 |
| `_legacy_disabled/` | 21 个旧函数归档 |
| `pdd_chat_massage/node_modules` | 清理删除 |

### 小程序（miniprogram/）

| 文件 | 改动 |
| --- | --- |
| `app.js` | 全局默认分享（Page 包装 onShareAppMessage + showShareMenu）、全局业务身份 |
| `app.json` | 注册 do_certification、organization、organization_create；新增"团队协作" tab |
| `pages/index/index.*` | 课程接取入口、认证入口换位 |
| `pages/index/do_certification/` | 新认证页 |
| `pages/organization/` | 新机构页 + 创建/编辑分区表单、DIY 二维码魔数校验、二维码生成调用 |
| `utils/bizRole.js` | 新角色体系工具 |
| `pages/task/publish/*` | 两步发布、接取码卡片、协作单回填保护、404 重试 |
| `pages/task/progress/*` | canManageClass 权限矩阵、自由教练列表过滤、状态标签 |
| `pages/mine/*`、`pages/login/login.js`、`pages/index/profile/*` | 角色展示、位置授权提示、认证入口适配 |
| `project.config.json` | libVersion 3.15.1（callHTTPFunction） |
| `uploadCloudFunction.sh` | 发布前先执行 sync-dev-to-true.js |

---

## 5. 遗留关注点

- `sync-dev-to-true.js` 需用户手动执行后才发布 true 版代码（AI 不执行迁移）。
- DIY 二维码修复需重新上传 A 侧云函数并重新预览开发版才能生效。
- release 环境下 `wxacode.getUnlimited` 要求落地页路径已发布，扫码全链路待线上验证。
- forP_class 读写视图分离、entry_landing 落地页等属 B 侧仓库（代码_ToP）改动，不在本仓库本次提交范围。
