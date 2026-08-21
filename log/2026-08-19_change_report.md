# 2026-08-19 改动说明

## 1. 本次改动目标

这次提交主要围绕两个方向展开：

1. 把小程序主流程进一步收口成“创建课程 -> 课程管理 -> 班级展示 -> 资料展示”的 MVP 路径。
2. 把课程、课节、资料页、云函数的数据结构和展示逻辑继续对齐，减少前端能看到、后端却没正确落库的情况。

---

## 2. 首页与主入口调整

涉及文件：

- `miniprogram/pages/index/index.js`
- `miniprogram/pages/index/index.wxml`
- `miniprogram/pages/index/index.wxss`
- `miniprogram/app.json`
- `miniprogram/pages/index/publish/publish.js`

本次首页不再做“很多功能并列入口”的表达，而是改成更强引导的主入口布局：

- 首页主卡片改为“创建课程”。
- 新增“已有班级？去课程管理”的快捷跳转。
- 把原来的资料相关入口重新整理为：
  - `资料填写`
  - `简历预览`
- `tabBar` 中原“任务进程”统一改名为“课程管理”。
- `pages/profile/profile` 被加入页面注册列表，补齐标准资料页入口。

这部分的目的很直接：让用户进入首页后一眼知道第一步做什么，创建后下一步去哪里。

---

## 3. 登录与基础跳转修正

涉及文件：

- `miniprogram/pages/login/login.js`
- `miniprogram/pages/login/login.wxml`
- `miniprogram/pages/mine/mine.js`

本次对基础入口做了两类修正：

- 登录页手填联系方式统一改为 11 位手机号输入和校验。
- “我的”页面编辑资料入口改到真实存在的 `pages/profile/edit/edit`，避免跳旧路径。

对应的云函数 `NEWDL_login_fun` 也同步补了手机号标准化和登录历史记录能力，前后端口径保持一致。

---

## 4. 发布页与课程创建链路调整

涉及文件：

- `miniprogram/pages/task/publish/publish.js`
- `miniprogram/pages/task/publish/publish.wxml`
- `miniprogram/pages/task/publish/publish.wxss`
- `cloudfunctions/NEW_DL_fun/NEWDL_execution_order/index.js`

这一块是本次改动量最大的部分，核心变化如下：

### 4.1 发布页交互与表单能力

- 顶部说明卡支持 5 秒自动收起，并可点击标题重新展开。
- 默认总课时统一为 `10`。
- 课程标题继续保留显示，但由选项自动生成。
- “课程介绍”区域按要求改为注释保留，不直接物理删除。
- 新增 `sub_plan_name`、`course_plan` 等课程重点字段。
- 联系方式统一按 11 位手机号收口。
- 新增多孩子表单收集结构，支持同一课程下连续录入多个孩子资料。
- 发布页中的说明文案整体改成更白话、更强引导的表达。

### 4.2 课节与每日总结链路

- 课节状态不再依赖旧的握手式状态流转。
- 一节课是否“已完成”，统一按：
  - 有总结内容
  - 且有总结日期 / 上课日期
- 新增课节评分能力：
  - 综合评分
  - 标签反馈
  - 多维评分
- 结课时可一并保存结语和教练备注。

### 4.3 课表与半途接入规则

- 半途接入仍保留。
- 但接入后累计记录满 3 节课后，锁定课表，不再允许反复修改总课时或重新半途接入。
- 旧的“单独追加课节”入口被下线，避免课表被绕乱。

### 4.4 云函数落库修正

- 联系方式、评分、课节日期等字段都在云端做了标准化。
- `sync_lesson_progress` 改为使用 `_.set` 整体覆盖 `course_flow_info`，修复 `history_sync` 为 `null` 时的更新报错问题。
- 发布和更新课程时，云端统一兜底校验手机号格式。

---

## 5. 课程管理页与班级展示页调整

涉及文件：

- `miniprogram/pages/task/progress/progress.js`
- `miniprogram/pages/task/progress/progress.wxml`
- `miniprogram/pages/task/progress/progress.wxss`
- `miniprogram/pages/task/progress/progress_specialOperation/progress_specialOperation.js`
- `miniprogram/pages/task/progress/progress_specialOperation/progress_specialOperation.wxml`
- `miniprogram/pages/task/progress/progress_specialOperation/progress_specialOperation.wxss`

### 5.1 课程管理列表页

- 顶部说明卡支持 5 秒自动收起，再点标题可展开。
- 页面按钮文案改为：
  - `班级展示`
  - `班级管理`
- 列表进度不再直接吃旧 `progress_done`，改成按真实课节记录重新计算。
- 页面表达从“任务”彻底收口到“课程 / 班级管理”。

### 5.2 班级展示页

- 增加“班级展示说明”折叠卡，进入时默认展开 5 秒，之后自动收起。
- 明确家长查看模式与教练管理模式的边界。
- 新增孩子信息卡片，支持多孩子展示。
- 课程信息卡片中补回锻炼时间、创建时间等核心信息。
- `subPlans` / `course_plan` 改为放进课程信息卡片底部折叠区。
- 课节进度表头改成展示：
  - 已完成
  - 待记录
  - 总课时
- 历史补录课节继续通过“历史汇总框”表达。

这部分改完后，展示页的职责更明确了：它负责给家长看，不负责做教练操作。

---

## 6. 课节详情页重做

涉及文件：

- `miniprogram/pages/task/progress/progress_specialOperation/progress_classdetailed/progress_classdetailed.js`
- `miniprogram/pages/task/progress/progress_specialOperation/progress_classdetailed/progress_classdetailed.wxml`
- `miniprogram/pages/task/progress/progress_specialOperation/progress_classdetailed/progress_classdetailed.wxss`

本次课节详情页从“状态页”改成了“总结展示页”：

- 顶部先展示基本信息：
  - 学员
  - 课程名
  - 训练时间
  - 记录日期
  - 训练时长
  - 完成状态
- 页面中段改成“第 X 节课课程总结”的展示头图。
- 教练评价区支持：
  - 教练信息
  - 星级评分
  - 总结正文
  - 具体评分
  - 多维评分
  - 标签反馈
- 详情刷新逻辑改为优先按 `lessonNo` 查找，不再单纯依赖数组下标。

这样做的好处是：即使课表顺序、半途接入、历史汇总发生调整，详情页也更稳。

---

## 7. 资料编辑页与资料展示页重构

涉及文件：

- `miniprogram/pages/index/profile/profile.js`
- `miniprogram/pages/index/profile/profile.wxml`
- `miniprogram/pages/index/profile/profile.wxss`
- `miniprogram/pages/profile/edit/edit.js`
- `miniprogram/pages/profile/edit/edit.wxml`
- `miniprogram/pages/profile/edit/edit.wxss`
- `miniprogram/pages/profile/profile.js`
- `miniprogram/pages/profile/profile.wxml`
- `miniprogram/pages/profile/profile.wxss`
- `cloudfunctions/NEW_DL_fun/NEWDL_mine_user/index.js`

### 7.1 资料编辑页

- 基础信息区新增：
  - 头像上传
  - 昵称
  - 联系方式
  - 工作经验量级
  - 带过学员量级
- 资料卡片重新整理为：
  - 教育背景
  - 相关证书
  - 荣誉展示
  - 擅长领域
  - 关于我
- `擅长领域` 改成多选标签式收集，文案参考课程方向。
- `相关证书`、`荣誉展示` 支持多块录入，每块都要求“内容 + 佐证图”。
- 编辑过程中会实时缓存预览草稿，进入预览页时优先展示最新未保存内容。
- 图片上传统一走云存储。
- 联系方式统一校验为 11 位手机号。

### 7.2 资料预览页

- 预览页整体改成大卡片展示。
- 顶部显示：
  - 头像
  - 昵称
  - 完整 `openid`
  - 品牌 Slogan：`悦动邻：让教练更专注教学`
- 头部统计项调整为：
  - 工作经验
  - 带过学员
- 主体资料区改为统一横向信息行展示。
- 多块证书 / 荣誉在预览页按多行展开展示。
- 页面支持分享给家长查看。
- 分享进入时会隐藏底部操作区，并记录访问日志。

### 7.3 标准资料页

- `pages/profile/profile` 不再是空页面。
- 现在可以直接加载并展示用户资料，作为标准资料展示入口使用。

### 7.4 资料云函数

- `NEWDL_mine_user` 统一支持新资料结构：
  - 顶层基础字段
  - `profile_detail` 详情字段
- 继续保留双层存储方式，方便数据库后台直接查看。
- 新增分享访问日志能力。
- 用户档案优先使用 `openid` 作为单档主键读取，兼容历史按 `openid` 查询的旧结构。

---

## 8. 云函数与依赖补充

涉及文件：

- `cloudfunctions/NEW_DL_fun/NEWDL_login_fun/index.js`
- `cloudfunctions/NEW_DL_fun/NEWDL_mine_user/index.js`
- `cloudfunctions/NEW_DL_fun/NEWDL_mine_user/package.json`
- `cloudfunctions/NEW_DL_fun/NEWDL_mine_user/package-lock.json`
- `cloudfunctions/NEW_DL_fun/NEWDL_execution_order/package-lock.json`
- `cloudfunctions/NEW_DL_fun/NEWDL_execution_order/node_modules/.package-lock.json`

本次云函数侧补充的核心内容：

- 登录云函数：
  - 手机号标准化
  - 手机号校验
  - 登录历史记录
- 用户资料云函数：
  - 新资料结构支持
  - 单档读取兜底
  - 分享日志记录
- 课程云函数：
  - 联系方式校验
  - 课节评分字段入库
  - 半途接入锁定逻辑
  - 结课补充说明字段

依赖方面：

- `NEWDL_mine_user` 的 `wx-server-sdk` 由 `latest` 固定为 `^4.0.2`。
- 同步补充了新的 `package-lock.json`。

---

## 9. 本次提交边界

本次提交**包含**：

- 小程序页面代码改动
- 云函数逻辑改动
- 必要的 `package-lock.json`
- 本说明文档

本次提交**不包含**：

- `.pai/`
- `.snapshots/`
- `cloudfunctions/NEW_DL_fun/NEWDL_mine_user/node_modules/`

以上内容属于本地产物或依赖目录，不进入仓库。

---

## 10. 提交后需要注意的事

这次代码推上去以后，建议重点关注下面几项：

1. 重新上传并部署涉及的云函数，至少包括：
   - `NEWDL_execution_order`
   - `NEWDL_login_fun`
   - `NEWDL_mine_user`
2. 真机走一遍以下链路：
   - 登录
   - 创建课程
   - 班级展示
   - 班级管理
   - 课节总结查看
   - 资料填写
   - 资料预览与分享
3. 核对数据库中以下字段是否按预期落库：
   - 用户资料顶层字段
   - `profile_detail`
   - `child_profiles`
   - `course_plan`
   - `sub_plan_name`
   - `history_sync`
   - 课节评分字段

---

## 11. 一句话总结

这次提交本质上是把项目继续往“教练端课程管理 MVP”收口，同时把资料展示、家长查看、课节记录、课程数据落库这几条线尽量拉平，减少页面能点、数据却对不上的问题。
