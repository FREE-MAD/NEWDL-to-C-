# 表单提交积木 (form-submit) · 容器目录

> 业务积木库
> 本目录是所有「表单提交」组件的**容器**，每个「页面 + 功能」独立一级子文件夹

## 目录规范（2026-09-20 起）

**命名规则 = 页面路径 + 功能**，每个功能表单在本目录下建一级子文件夹，子文件夹内是一个独立完整、**自包含**的微信小程序 Component：完整还原原页面的固定 UI 结构（wxml）、样式（wxss）与全部业务逻辑（js），不依赖外部 config 动态渲染。

```
miniprogram/components/form-submit/
├── README.md                       # 本说明（容器级）
└── <页面>_<功能>/                   # 每个「页面 + 功能」一个子文件夹
    ├── <页面>_<功能>.js              # 组件全部业务逻辑（Component 形态，methods 内聚）
    ├── <页面>_<功能>.wxml            # 完整页面结构（还原原页面）
    ├── <页面>_<功能>.wxss            # 完整页面样式（仅作用于组件内部）
    └── <页面>_<功能>.json            # { "component": true, "usingComponents": {} }
```

## 已落地模块

| 归属页面 | 子文件夹 | 功能 | 提交链路 |
|---|---|---|---|
| `pages/index/profile/profile` | [`profile_coachbaseinformation/`](./profile_coachbaseinformation) | 教练基础资料填写（性别/默认头像/照片/昵称/联系方式/工作经验/带过学员/教育背景/相关证书/荣誉展示/擅长领域/关于我） | NEWDL_mine_user（getProfile / updateProfile / submitProfileSecurityReview） |

## 组件行为（profile_coachbaseinformation）

- 组件 `attached` 时自动调用云函数 `getProfile` 加载并回填资料，宿主无需手动触发。
- 字段输入、图片上传（含云存储分目录）、多块资料增删、擅长领域多选、性别与官方默认头像联动、`saveProfile` 提交校验、保存成功后异步触发安全审核（审核专用最小图压缩）、全局 nickname/avatarUrl 身份同步，全部在组件内部完成。
- 组件同时上抛自定义事件，宿主有额外需求时可监听：
  - `loaded`：资料加载回填完成，`detail = { profile }`
  - `submitted`：保存成功，`detail = { profile }`
  - `error`：保存请求失败，`detail = { stage }`

## 接入方式（宿主页面）

页面 `.json` 局部注册，key 与组件同名，路径指向具体子文件夹：

```json
{
  "usingComponents": {
    "profile-coachbaseinformation": "/components/form-submit/profile_coachbaseinformation/profile_coachbaseinformation"
  }
}
```

页面 `.wxml` 直接放置组件即可，外壳无需其他结构：

```xml
<profile-coachbaseinformation></profile-coachbaseinformation>
```

## 规划中的模块（按「页面 + 功能」继续建子文件夹）

| 归属页面 | 建议子文件夹 | 说明 |
|---|---|---|
| `pages/task/publish/publish` | `publish_courseinfo` | 课程信息发布表单 |
| `pages/organization/organization_create` | `organization_create_step1` | 创建机构第一步 |
| `pages/organization/organization_create` | `organization_create_step2` | 创建机构第二步 |

## 原则

- 业务方加功能 = 新建「页面_功能」子文件夹，在该目录内实现完整自包含 Component
- 组件默认样式隔离，wxss 只作用于组件内部，不污染宿主页面
- 不允许删除注释；新增功能需添加注释
