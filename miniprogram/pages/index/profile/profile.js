// ============================================================
// 教练资料编辑页 - 外壳（完整表单 UI 与逻辑已下沉到组件）
// 组件位置：components/form-submit/profile_coachbaseinformation/profile_coachbaseinformation
// 本页面仅作为路由页面承载组件：
//   - 组件 attached 时自动加载资料；
//   - 字段输入、图片上传、多块资料、擅长领域多选、默认头像联动、
//     saveProfile 提交、异步审核触发、全局 nickname/avatarUrl 同步
//     均在组件内部完成，外壳无需任何处理。
// 组件同时会上抛 loaded / submitted / error 事件，宿主后续若有额外需求可直接监听扩展。
// ============================================================

Page({})
