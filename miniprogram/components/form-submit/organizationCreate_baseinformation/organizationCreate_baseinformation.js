// ============================================================
// 业务积木：表单提交 - organizationCreate_baseinformation 模块
// 所属页面：pages/organization/organization_create/organization_create（A 创建机构）
// 说明：本组件完整还原原 organization_create 页面 TAB_CREATE='create' 分支的
//       固定 UI 结构与全部业务逻辑，由原 Page 形态改造为 Component。
//       所有事件方法位于 methods 内，组件 attached 时自动加载数据。
// 拆分说明（2026-09-20）：原 organization_create 页面按 tab 拆为两个自包含组件，
//       本组件对应 A 创建机构（原 currentTab === 'create' 分支），
//       B 教练加入分支见 organizationCreate_coachaddorganization 组件。
// ============================================================

const {
  BIZ_ROLE_ORG_ADMIN,
  BIZ_ROLE_ORG_COACH
} = require('../../../utils/bizRole')
const { prepareImageForUpload } = require('../../../utils/imageUpload')

const TAB_CREATE = 'create'
const ORGANIZATION_RESULT_CARD_STORAGE_KEY = 'organizationEntryResultCard'
const BRAND_SWIPER_IMAGE_MAX_COUNT = 5

// 新增机构成员身份枚举（2026-09-05）：主教 / 副教练 / 指导 / 训练分析 / 自定义填写。
// 身份属于「机构」这一层：只入库 NDLdev_organization（成员项 staff_role），不写入 NDLdev_users。
// 调整（2026-09-05）：机构身份改为「固定文案选项 + 常驻输入框」——
// ① 选项不再用称呼（昵称）合成，一直就是主教 / 副教练 / 指导 / 训练分析这类固定文案；
// ② 「其他（自填）」从选项里移除（输入框常驻显示，本身就是自填入口）；
// ③ 点击选项只把文案回填到输入框，由用户再次编辑，最终落库值 = 输入框文本
// （统一按 staff_role='custom' + staff_role_custom=文本 提交，云函数 normalizeStaffRole 已支持，云函数零改动）
// 拆分说明（2026-09-20）：机构身份枚举与相关方法已下沉到 coachaddorganization 组件，本组件仅保留注释参考

// 新增（2026-09-05）：机构展示页区块二/三展示字段的编辑态默认值。
// 老机构文档里可能还没有这些字段（空串），回填时退到这里的默认（完整）值起步，
// 避免空表单 + 必填校验卡住保存。文案与 organization.js DEFAULT_INTRO_INFO_LIST 保持一致。
// 修正（2026-09-06）：编辑态回填已去掉这组默认值兜底（默认文案会被表单当真实值提交入库，
// 造成 org_1a0749 那样的默认值污染），常量仅作展示层参考文案保留，不再参与任何表单回填
const DEFAULT_SLOGAN = '用代码连接体育，让专业能力被看见'
const DEFAULT_CORE_SERVICES = '体育数字化工具、教练服务连接、机构展示'
const DEFAULT_SERVICE_AREA = '不只深圳南山，软件链接万物'
const DEFAULT_TARGET_AUDIENCE = '体育教练、体育机构及有运动服务需求的用户'
const DEFAULT_COACHING_PHILOSOPHY = '用代码提升体育服务效率，让专业更容易被看见'

Component({
  // 新增组件外部入参：initialMode 由宿主页面 onLoad 解析 mode=edit 后传入，
  // 标记本组件以编辑态进入（机构管理层修改机构资料）
  // 拆分说明（2026-09-20）：authReady 和 profile 由外壳 refreshCertificationState 加载后下传，
  // 组件不再自己调 getProfile；profile.nickname/phone 用于联系人/联系电话自动回填
  properties: {
    initialMode: { type: String, value: '' },
    authReady: { type: Boolean, value: false },
    profile: { type: Object, value: { avatarUrl: '', nickname: '', phone: '' } }
  },

  // 新增 profile 观察器：外壳加载教练资料后下传 profile，组件据此自动回填
  // 联系人（contact_name）和联系电话（contact_phone），逻辑与原 refreshCertificationState 一致：
  // 存在未保存编辑时不覆盖，空值时才走昵称/手机号兜底
  observers: {
    'profile': function(profile) {
      if (!profile || this._hasUnsavedFormEdits) {
        return
      }
      const updates = {}
      const nickname = String(profile.nickname || '').trim()
      const phone = String(profile.phone || '').trim()
      if (!String(this.data.createForm.contact_name || '').trim() && nickname) {
        updates['createForm.contact_name'] = nickname
      }
      if (!String(this.data.createForm.contact_phone || '').trim() && phone) {
        updates['createForm.contact_phone'] = phone
      }
      if (Object.keys(updates).length) {
        this.setData(updates)
      }
    }
  },

  /**
   * 组件的初始数据
   */
  data: {
    isEditMode: false,
    currentOrganizationId: '',
    currentInvitationCode: '',
    createForm: {
      organization_name: '',
      invite_prefix: '',
      // 新增 DIY 二维码图片：机构上传自己的图片（教练头像 / 品牌 Logo），生成入口二维码时合成到二维码中间；
      // 属于区块一（Oncegenerated_cannotbemodified）字段，创建时必填、生成后不可修改
      diy_qrcode_image: '',
      contact_name: '',
      contact_phone: '',
      // 调整（2026-09-06）：所在城市输入框已从区块二删除、不再收集；city 字段保留仅用于
      // 编辑态回填机构文档历史值并随保存原样带回，不主动清除旧数据，也不再做必填校验
      city: '',
      address: '',
      intro: '',
      // 新增（2026-09-05）：品牌副标题 slogan，展示在机构首页 Hero 区机构名称下方（os-hero-subtitle）；
      // 随区块二一起收集 / 校验 / 提交，同步推到 B 侧 dev_forPshowC.show_basic.brand_slogan
      slogan: '',
      // 新增（2026-09-05）：机构展示页区块三（基本信息）新增四项必填展示字段，
      // 随区块二（PendingSupplement）一起收集 / 校验 / 提交，并经机构展示同步推到 B 侧 dev_forPshowC
      core_services: '', // 核心服务
      service_area: '', // 服务区域
      target_audience: '', // 适合谁
      coaching_philosophy: '', // 教练理念
      brand_swiper_images: []
    },
    // 拆分说明（2026-09-20）：profileBrief 已移除——头像/称呼展示在 coachaddorganization 组件，
    // 本组件只需 profile.nickname/phone 做联系人/联系电话回填（通过 property 下传 + observer 自动填）
    inviteCodePreview: '',
    isSubmitting: false,
    submitResultCard: null,
    // 新增区块二（PendingSupplement）解锁门控：
    // 创建流程中必须等区块一提交成功并且机构入口二维码生成成功后才解锁填写；
    // 编辑态（机构已创建）进页直接解锁（refreshCurrentOrganizationCard 里处理）
    supplementUnlocked: false,
    // 新增创建流程二维码门控等待标记：创建成功后、二维码尚未生成成功期间为 true，
    // 期间下拉刷新等触发机构回查时不提前解锁第二区
    qrcodeGatePending: false,
    // 新增机构入口二维码卡片状态：二维码归属 B 侧（家长端）生成，A 侧云函数（NEWDL_ResponseQRCode）
    // 负责把图片转存到 A 侧云存储并入库（organization 文档 entry_qrcode 字段），前端只负责触发与展示返回结果
    qrcodeCard: {
      visible: false,
      isLoading: false,
      hasRecord: false,
      // 合成码（带 DIY Logo）A 侧 fileID：前端主展示码。
      qrcodeFileId: '',
      // 原始码（不带 Logo）A 侧 fileID：与合成码并列展示用于对照（新增 2026-09-04）。
      rawQrcodeFileId: '',
      entryId: '',
      scene: '',
      message: '',
      transferWarning: ''
    }
  },

  // 新增组件生命周期：原 Page 的 onLoad 逻辑迁移到 attached
  lifetimes: {
    attached() {
      // 新增（2026-09-06）未保存编辑标记：页面实例级标记（不进 data、不参与渲染），
      // 用户输入过内容 / 触发过图片选择上传后置 true；
      // 修复「上传图片（进相册会触发 onHide→选图返回 onShow）→ onShow 回查把区块二已填字段
      // 和刚上传未保存的轮播图整包覆盖回服务端旧值」的问题（覆盖的是轮播图项前面的填空）
      this._hasUnsavedFormEdits = false
      // 新增编辑态入参：宿主页面 onLoad 解析 mode=edit 后通过 initialMode 传入，
      // 机构管理层进入时直接以编辑态展示（区块一只读、区块二可改）
      if (String(this.data.initialMode || '').trim() === 'edit') {
        this.setData({ isEditMode: true })
      }
      // 拆分说明（2026-09-20）：refreshCertificationState 已上移到外壳，组件不再自己调 getProfile；
      // 联系人/联系电话回填改由 profile property observer 自动处理
      this.refreshCurrentOrganizationCard()
    }
  },

  // 新增页面级生命周期：组件作为页面直接子节点时，页面 onShow 会透传到此处
  pageLifetimes: {
    show() {
      // 拆分说明（2026-09-20）：认证状态由外壳 onShow → refreshCertificationState 统一刷新，
      // 组件只回查机构资料（createForm / qrcode）
      this.refreshCurrentOrganizationCard()
    }
  },

  methods: {
    // 拆分说明（2026-09-20）：onTabTap 和 refreshCertificationState 已上移到外壳，
    // tab-bar 不再由本组件渲染，认证状态通过 authReady property 下传

    // 新增进页机构回查：当前页仍保留机构资料回查，结果卡片展示改由机构首页承接
    // 拆分说明（2026-09-20）：本组件只回查 create 相关字段（isEditMode / createForm / qrcode），
    // hasJoinedOrganization 与 staffForm 已下沉到 coachaddorganization 组件
    refreshCurrentOrganizationCard() {
      const app = getApp()
      const currentIdentity = app.getBusinessIdentity ? app.getBusinessIdentity() : null
      const organizationProfile = (currentIdentity && currentIdentity.organizationProfile) || {}
      const orgId = String(organizationProfile.orgId || '').trim()
      const memberRole = String(organizationProfile.memberRole || '').trim()

      if (!orgId) {
        this.setData({
          submitResultCard: null
        })
        return Promise.resolve()
      }

      const db = wx.cloud.database({
        env: app.globalData.env
      })
      const organizationCollectionName = `${app.globalData.dataPrefix || 'NDLdev_'}organization`

      return db.collection(organizationCollectionName).where({
        'organization_basic.organization_id': orgId
      }).limit(1).get().then((res) => {
        const organizationDoc = Array.isArray(res.data) && res.data.length ? res.data[0] : null
        if (!organizationDoc) {
          this.setData({
            submitResultCard: null
          })
          return
        }

        const organizationBasic = organizationDoc.organization_basic || {}
        const isAdminRole = memberRole === 'admin'
        // 新增机构身份回查：身份存在机构成员项（organization_member.*.staff_role）里，
        // 按当前用户 openid 找出自己那一条，编辑态回填到身份选择区
        // 用户已经手动选过身份时保留当前选择，避免编辑中途返回页面被回查覆盖
        // 拆分说明（2026-09-20）：身份回查逻辑已下沉到 coachaddorganization 组件，本组件不再处理 staffForm

        this.setData({
          // 拆分说明（2026-09-20）：本组件即 create tab，isEditMode 直接取 isAdminRole
          // （原 isAdminRole && this.data.currentTab === TAB_CREATE 简化，因为本组件即 create tab）
          isEditMode: isAdminRole,
          // 新增已加入标记：能按 orgId 查到机构文档，说明当前用户已在机构内，
          // B 教练加入侧据此判断显示「加入」还是「保存我的机构身份」
          // 拆分说明（2026-09-20）：hasJoinedOrganization 已下沉到 coachaddorganization 组件
          currentOrganizationId: String(organizationBasic.organization_id || '').trim(),
          currentInvitationCode: String(organizationBasic.invitation_code || '').trim(),
          // 新增机构资料回填：管理层进入创建页时，直接把已有机构资料带到表单里，改完即可提交
          // 调整（2026-09-06）：存在未保存编辑（用户输入过 / 正在选择或上传图片）时禁止整包回填 createForm，
          // 否则上传图片返回（onShow 触发回查）会把区块二已填字段和刚上传未保存的轮播图
          // 整包覆盖回服务端旧值（即「上传图片覆盖掉轮播图项前面填空」的问题）；
          // 无未保存编辑时维持原回填逻辑（进页首次回填、下拉刷新后回填）
          createForm: (isAdminRole && !this._hasUnsavedFormEdits) ? {
            organization_name: String(organizationBasic.organization_name || '').trim(),
            invite_prefix: String(organizationBasic.invite_prefix || '').trim(),
            // 新增 DIY 二维码图片回填：编辑态只读展示（区块一生成后不可修改）
            diy_qrcode_image: String(organizationBasic.diy_qrcode_image || '').trim(),
            contact_name: String(organizationBasic.contact_name || '').trim(),
            contact_phone: String(organizationBasic.contact_phone || '').trim(),
            city: String(organizationBasic.city || '').trim(),
            address: String(organizationBasic.address || '').trim(),
            intro: String(organizationBasic.intro || '').trim(),
            // 新增（2026-09-05）：品牌副标题 slogan 编辑态回填；老机构库里没有该字段时回退到默认值起步，
            // 避免空表单 + 必填校验卡住保存
            // 修正（2026-09-06）：不再回填 DEFAULT_SLOGAN —— 实测默认文案会被表单当成真实值随保存写回数据库
            //（org_1a0749 创建时 slogan 等字段以默认文案入库）。空值保持空串，由必填校验引导填写真实值
            slogan: String(organizationBasic.slogan || '').trim(),
            // 新增（2026-09-05）：区块三四项展示字段编辑态回填；老机构库里还没有这些字段（空串）时
            // 回填默认（完整）值起步，避免空表单 + 必填校验卡住保存
            // 修正（2026-09-06）：同上，去掉 DEFAULT_* 兜底，空就是空，避免默认文案污染数据库
            core_services: String(organizationBasic.core_services || '').trim(),
            service_area: String(organizationBasic.service_area || '').trim(),
            target_audience: String(organizationBasic.target_audience || '').trim(),
            coaching_philosophy: String(organizationBasic.coaching_philosophy || '').trim(),
            brand_swiper_images: Array.isArray(organizationBasic.brand_swiper_images)
              ? organizationBasic.brand_swiper_images.filter(item => String(item || '').trim())
              : []
          } : this.data.createForm,
          submitResultCard: {
            title: '当前已加入机构',
            organizationName: String(organizationBasic.organization_name || '').trim(),
            invitationCode: String(organizationBasic.invitation_code || '').trim(),
            memberRoleLabel: isAdminRole ? '机构管理层' : '机构执行教练',
            message: isAdminRole
              ? '你当前已经在机构内，下面这张卡展示的是机构最新邀请码和基础信息。'
              : '你当前已经加入机构，下面这张卡展示的是机构最新邀请码和基础信息。'
          }
        })
        this.updateInviteCodePreview()
        // 新增编辑态二维码回查：机构管理层进入页面时，回查机构文档里已入库的入口二维码并就地展示
        if (isAdminRole) {
          // 新增区块二解锁（编辑态直接可编辑）：机构已创建完成提交，锁定门槛只约束新创建流程；
          // 创建流程门控等待期间（qrcodeGatePending）不提前解锁，必须等二维码生成成功
          if (!this.data.qrcodeGatePending) {
            this.setData({
              supplementUnlocked: true
            })
          }
          this.fetchOrganizationQrcodeForEdit()
        }
      }).catch(() => {
        // 新增查询失败兜底：进页拉取失败时不覆盖当前卡片，避免把已有结果清空
      })
    },

    // 新增创建机构输入收口：统一处理机构名称、邀请码前缀和联系方式输入
    onCreateInput(e) {
      const field = e.currentTarget.dataset.field
      if (!field) {
        return
      }

      let value = String((e.detail && e.detail.value) || '')
      if (field === 'invite_prefix') {
        // 调整（2026-09-05）：邀请码改为完全自定义，长度上限从 8 位放宽到 16 位；
        // 字符规则继承原前缀规则（仅英文或数字、自动大写），不再做任何位数补齐
        // 调整（2026-09-16）：机构码构建规则收紧为「仅英文」——输入过滤不再放行数字，自动大写与 16 位上限不变
        value = value.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 16)
      }
      if (field === 'contact_phone') {
        value = value.replace(/\D/g, '').slice(0, 11)
      }

      this.setData({
        [`createForm.${field}`]: value
      })

      if (field === 'invite_prefix') {
        this.updateInviteCodePreview()
      }
    },

    // 新增机构轮播图上传：创建机构页直接收集首页 swiper 图片，统一限制最多 5 张
    async chooseBrandSwiperImages() {
      if (this.data.isSubmitting) {
        return
      }

      const currentImageList = Array.isArray(this.data.createForm.brand_swiper_images)
        ? this.data.createForm.brand_swiper_images
        : []
      const remainCount = BRAND_SWIPER_IMAGE_MAX_COUNT - currentImageList.length

      if (remainCount <= 0) {
        wx.showToast({
          title: `最多上传${BRAND_SWIPER_IMAGE_MAX_COUNT}张`,
          icon: 'none'
        })
        return
      }

      // 新增（2026-09-06）：进入相册/相机会让页面短暂 onHide，选完图返回触发 onShow 回查；
      // 先标记存在未保存编辑，避免回查把区块二已填字段和刚上传未保存的轮播图整包覆盖回服务端旧值
      this._hasUnsavedFormEdits = true

      try {
        const chooseRes = await new Promise((resolve, reject) => {
          wx.chooseImage({
            count: remainCount,
            sizeType: ['compressed'],
            sourceType: ['album', 'camera'],
            success: resolve,
            fail: reject
          })
        })

        const tempFilePaths = Array.isArray(chooseRes.tempFilePaths) ? chooseRes.tempFilePaths : []
        if (!tempFilePaths.length) {
          return
        }

        wx.showLoading({
          title: '上传图片中...'
        })

        const uploadFileIdList = []
        for (let index = 0; index < tempFilePaths.length; index += 1) {
          const filePath = String(tempFilePaths[index] || '').trim()
          if (!filePath) {
            continue
          }

          const preparedImage = await prepareImageForUpload(filePath, {
            maxBytes: 500 * 1024
          })
          const uploadRes = await wx.cloud.uploadFile({
            cloudPath: `organization/swiper/${Date.now()}_${index}.jpg`,
            filePath: preparedImage.filePath || filePath
          })

          if (uploadRes && uploadRes.fileID) {
            uploadFileIdList.push(uploadRes.fileID)
          }
        }

        this.setData({
          'createForm.brand_swiper_images': currentImageList.concat(uploadFileIdList).slice(0, BRAND_SWIPER_IMAGE_MAX_COUNT)
        })
      } catch (error) {
        wx.showToast({
          title: '图片上传失败',
          icon: 'none'
        })
      } finally {
        wx.hideLoading()
      }
    },

    // 新增机构轮播图删除：允许在创建页直接删掉不想展示的 swiper 图片
    removeBrandSwiperImage(e) {
      const index = Number((((e || {}).currentTarget || {}).dataset || {}).index)
      const currentImageList = Array.isArray(this.data.createForm.brand_swiper_images)
        ? this.data.createForm.brand_swiper_images
        : []

      if (Number.isNaN(index) || index < 0 || index >= currentImageList.length) {
        return
      }

      const nextImageList = currentImageList.filter((_, itemIndex) => itemIndex !== index)
      this.setData({
        'createForm.brand_swiper_images': nextImageList
      })
    },

    // 新增轮播图预览：上传后可直接查看大图，避免裁切不对用户看不出来
    previewBrandSwiperImage(e) {
      const index = Number((((e || {}).currentTarget || {}).dataset || {}).index)
      const currentImageList = Array.isArray(this.data.createForm.brand_swiper_images)
        ? this.data.createForm.brand_swiper_images
        : []

      if (Number.isNaN(index) || index < 0 || index >= currentImageList.length) {
        return
      }

      wx.previewImage({
        current: currentImageList[index],
        urls: currentImageList
      })
    },

    // 新增 DIY 二维码图片上传（区块一 Oncegenerated_cannotbemodified 字段）：
    // 机构上传自己的图片（教练头像 / 品牌 Logo），生成入口二维码时由 NEWDL_ResponseQRCode
    // 下载后合成到二维码中间位置；创建时必填、生成后不可修改（编辑态禁止再上传）。
    // 新增（诊断日志 + 格式校验）：之前直接写死 cloudPath 后缀为 .jpg，但 prepareImageForUpload 的压缩结果
    // 在不同平台可能是 PNG / JPG / WEBP / GIF（尤其 wx.compressImage 在部分机型输出 WEBP，魔数既不是 PNG 也不是 JPEG），
    // 导致 NEWDL_ResponseQRCode.decodeImageToRgba 识别失败 → hasDiyLogo 永远 false、二维码合成空白。
    // 现在上传前先读文件首 4 字节做魔数识别，后缀与真实格式对齐；非 PNG/JPEG 直接提示用户重传，不入库。
    async chooseDiyQrcodeImage() {
      // 调整（2026-09-04）：编辑态拦截条件细化为「已有值才拦截」——
      // DIY 功能上线前创建的老机构文档里没有 diy_qrcode_image（回填为空），
      // 原先一刀切禁止导致老机构永远无法补传 Logo、入口二维码永远合成不了；
      // 现在编辑态且旧值为空时放行上传（空值一次性补传），已有值仍不可修改（与区块一约定一致）。
      if (this.data.isSubmitting) {
        return
      }
      if (this.data.isEditMode && String((this.data.createForm || {}).diy_qrcode_image || '').trim()) {
        return
      }

      // 新增（2026-09-06）：进入相册/相机会让页面短暂 onHide，选完图返回触发 onShow 回查；
      // 先标记存在未保存编辑，避免回查把已填字段整包覆盖回服务端旧值
      this._hasUnsavedFormEdits = true

      try {
        const chooseRes = await new Promise((resolve, reject) => {
          wx.chooseImage({
            count: 1,
            sizeType: ['compressed'],
            sourceType: ['album', 'camera'],
            success: resolve,
            fail: reject
          })
        })

        const tempFilePaths = Array.isArray(chooseRes.tempFilePaths) ? chooseRes.tempFilePaths : []
        const filePath = String(tempFilePaths[0] || '').trim()
        if (!filePath) {
          return
        }

        // 新增（诊断日志）：打印 chooseImage 选中的原始文件与基础信息。
        console.log('[organization_create][INFO] chooseDiyQrcodeImage.user_selected', {
          filePath,
          chooseResKeys: Object.keys(chooseRes || {}),
        })

        wx.showLoading({
          title: '上传图片中...'
        })

        // 复用统一图片预处理（压缩到 500KB 内），与轮播图上传保持同一套标准
        const preparedImage = await prepareImageForUpload(filePath, {
          maxBytes: 500 * 1024
        })
        const finalFilePath = preparedImage.filePath || filePath
        // 新增（诊断日志）：打印压缩结果——区分「小图直传 / 多档压缩后」、压缩前后字节数。
        console.log('[organization_create][INFO] chooseDiyQrcodeImage.prepared', {
          originalFilePath: filePath,
          finalFilePath,
          originalSize: preparedImage.originalSize,
          finalSize: preparedImage.finalSize,
          compressed: preparedImage.compressed,
          qualityUsed: preparedImage.qualityUsed,
        })

        // 新增：读取最终上传文件的首 4 字节魔数，识别真实图片格式。
        // 目的：1) 决定 cloudPath 后缀（.png / .jpg），与真实字节格式对齐；
        //       2) 非 PNG/JPEG 直接拦在上传前，避免入库无效 fileID 导致后端合成永远失败。
        let magicBytes = []
        let magicHex = ''
        try {
          const readRes = await new Promise((resolve, reject) => {
            wx.getFileSystemManager().readFile({
              filePath: finalFilePath,
              // 不指定 encoding → 返回 ArrayBuffer，方便逐字节取魔数
              success: (res) => resolve(res || {}),
              fail: reject,
            })
          })
          const buf = readRes && readRes.data ? readRes.data : null
          if (buf && buf.byteLength >= 4) {
            const view = new Uint8Array(buf, 0, 4)
            for (let i = 0; i < 4; i += 1) {
              magicBytes.push(view[i])
              magicHex += (view[i] < 16 ? '0' : '') + view[i].toString(16) + ' '
            }
            magicHex = magicHex.trim()
          }
        } catch (readErr) {
          console.warn('[organization_create][WARN] chooseDiyQrcodeImage.read_magic_fail', {
            finalFilePath,
            message: readErr && readErr.message ? readErr.message : String(readErr),
          })
        }

        let ext = 'jpg'
        let fmt = 'jpeg'
        const isPng = magicBytes.length >= 4 && magicBytes[0] === 0x89 && magicBytes[1] === 0x50 && magicBytes[2] === 0x4e && magicBytes[3] === 0x47
        const isJpeg = magicBytes.length >= 2 && magicBytes[0] === 0xff && magicBytes[1] === 0xd8
        if (isPng) {
          ext = 'png'
          fmt = 'png'
        } else if (isJpeg) {
          ext = 'jpg'
          fmt = 'jpeg'
        } else {
          // 魔数既不是 PNG 也不是 JPEG：最常见是 wx.compressImage 在某些机型输出 WEBP（RIFF...WEBP 魔数 52 49 46 46），
          // 或者用户直接上传了 GIF / BMP / HEIC。后端 pngjs / jpeg-js 都无法解码 → hasDiyLogo 永远 false 且 silent。
          // 这里提前拦在前端，明确告诉用户需要 PNG/JPG。
          console.error('[organization_create][ERROR] chooseDiyQrcodeImage.unsupported_format', {
            finalFilePath,
            magicHex,
            magicBytes,
            extra16Byte: '<无法提供（请在后端 decodeImageToRgba.unsupported_format 日志里查 extraMagic16）>',
            recommendation: '上传前必须保证图片为 PNG 或 JPEG/JPG 格式；若使用相机/相册选图，请先转格式。',
          })
          wx.showToast({
            title: '请上传PNG或JPG格式图片',
            icon: 'none',
            duration: 2500
          })
          wx.hideLoading()
          return
        }
        // 新增（诊断日志）：魔数识别 → 格式与后缀决定结果，便于对照后端 decode_image.png_ok / jpeg_ok 对账。
        console.log('[organization_create][INFO] chooseDiyQrcodeImage.magic_recognized', {
          finalFilePath,
          finalSize: preparedImage.finalSize,
          magicHex,
          format: fmt,
          ext,
          isPng,
          isJpeg,
        })

        const cloudPath = `organization/diy_qrcode/${Date.now()}_diy.${ext}`
        // 新增：上传前打印 cloudPath 与决定的后缀，之后可直查 A 侧云存储 organization/diy_qrcode/ 目录核对。
        console.log('[organization_create][INFO] chooseDiyQrcodeImage.upload.start', {
          cloudPath,
          finalFilePath,
          ext,
          format: fmt,
        })
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath,
          filePath: finalFilePath
        })

        if (uploadRes && uploadRes.fileID) {
          console.log('[organization_create][INFO] chooseDiyQrcodeImage.upload.ok', {
            cloudPath,
            fileID: uploadRes.fileID,
            statusCode: uploadRes && uploadRes.statusCode ? uploadRes.statusCode : '',
            format: fmt,
          })
          this.setData({
            'createForm.diy_qrcode_image': uploadRes.fileID
          })
        } else {
          console.error('[organization_create][ERROR] chooseDiyQrcodeImage.upload.empty_fileid', {
            cloudPath,
            uploadResKeys: Object.keys(uploadRes || {}),
          })
        }
      } catch (error) {
        console.error('[organization_create][ERROR] chooseDiyQrcodeImage.exception', {
          message: error && error.message ? error.message : String(error),
          stack: error && error.stack ? String(error.stack).slice(0, 500) : '',
        })
        wx.showToast({
          title: '图片上传失败',
          icon: 'none'
        })
      } finally {
        wx.hideLoading()
      }
    },

    // 新增 DIY 二维码图片删除：仅创建态可删（删空后二维码框继续以空框占位显示，不隐藏）
    removeDiyQrcodeImage() {
      if (this.data.isEditMode) {
        return
      }
      this.setData({
        'createForm.diy_qrcode_image': ''
      })
    },

    // 新增 DIY 二维码图片大图预览：确认合成效果前先看清楚图片内容
    previewDiyQrcodeImage() {
      const diyQrcodeImage = String((this.data.createForm || {}).diy_qrcode_image || '').trim()
      if (!diyQrcodeImage) {
        return
      }
      wx.previewImage({
        current: diyQrcodeImage,
        urls: [diyQrcodeImage]
      })
    },

    // 新增邀请码预览：前缀由用户决定，剩余位由系统补足 16 位
    // 调整（2026-09-05）：邀请码改为完全自定义，预览不再用 X 补齐 16 位，直接展示用户输入的邀请码原样
    updateInviteCodePreview() {
      if (this.data.isEditMode) {
        this.setData({
          inviteCodePreview: this.data.currentInvitationCode || ''
        })
        return
      }

      // 完全自定义预览：输入什么预览什么（onCreateInput 已统一大写并过滤非法字符）
      const preview = String((this.data.createForm && this.data.createForm.invite_prefix) || '').trim().toUpperCase()
      this.setData({
        inviteCodePreview: preview
      })
    },

    // 新增认证未通过引导：当前页统一把用户带去资料填写页，不让用户自己猜下一步去哪
    goToProfileCertification() {
      wx.navigateTo({
        url: '/pages/index/profile/profile'
      })
    },

    // 新增资料修改入口：头像 / 称呼属于教练个人资料，本页只读展示，
    // 点「去资料页修改」统一跳资料填写页（/pages/index/profile/profile）修改
    goToProfileEdit() {
      wx.navigateTo({
        url: '/pages/index/profile/profile'
      })
    },

    // 云函数统一调用封装（2026-10-10 由 callHTTPFunction 改回 callFunction）：
    // NEWDL_ResponseQRCode 现在是普通云函数（原先的 HTTP 云函数类型被一次「上传并部署」覆盖后降级，
    // 再走 callHTTPFunction 会得到 cloud.callHttpFunction:fail … code: 400 / INVALID_PATH，且云函数日志为空）。
    // 函数本身一直是双入口（index.js 的 exports.main = handleMain），callFunction 通道现成可用：
    // 带微信身份上下文 → 云函数按 openid 解析所属机构并校验管理层（organizationId 非必需，继续传也无害）。
    // 返回体从 HTTP 语义的 res.data 回到 callFunction 语义的 res.result。
    callResponseQrcodeCloud(action, extraData = {}) {
      return new Promise((resolve, reject) => {
        // 云能力缺失时返回可读错误，避免 undefined 调用直接崩。
        if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
          reject({ status: 'error', message: '当前微信版本过低，请升级微信后重试' })
          return
        }
        const requestAt = Date.now()
        // 新增（诊断日志 - DIY Logo 状态前后对账）：打印调用前的 action + organizationId，
        // 与 VConsole 里的上传/保存日志串起来，就能知道「这次生成/查询对应的机构到底有没有 DIY Logo」。
        const logOrgId = String((extraData && extraData.organizationId) || (this.data && this.data.currentOrganizationId) || '').trim()
        console.log('[organization_create][INFO] callResponseQrcodeCloud.request.start', {
          action,
          organizationId: logOrgId ? logOrgId.slice(0, 28) : '',
          extraDataKeys: extraData ? Object.keys(extraData) : [],
        })
        wx.cloud.callFunction({
          name: getApp().getFnName('NEWDL_ResponseQRCode'),
          // callFunction 语义：data 整体作为 event 传给 exports.main（action 与业务字段平铺）。
          data: { action, ...extraData },
          success: (res) => {
            const cost = Date.now() - requestAt
            // callFunction 语义：业务体在 res.result（HTTP 语义下曾是 res.data）。
            const payload = (res && res.result) ? res.result : {}
            // 新增：云函数返回的 diyLogoStatus 是 DIY Logo 的三档状态，前端必须据此提示用户，
            // 否则只会看到「生成成功」但不知道 Logo 为什么没合成。
            const diyLogoStatus = String(payload.diyLogoStatus || '').trim()
            console.log('[organization_create][INFO] callResponseQrcodeCloud.request.ok', {
              action,
              organizationId: logOrgId ? logOrgId.slice(0, 28) : '',
              costMs: cost,
              payloadStatus: payload.status || '',
              payloadMessage: String(payload.message || '').slice(0, 100),
              diyLogoStatus,
              transferWarning: String(payload.transferWarning || '').slice(0, 80),
            })
            resolve(res)
          },
          fail: (err) => {
            const cost = Date.now() - requestAt
            console.error('[organization_create][ERROR] callResponseQrcodeCloud.request.fail', {
              action,
              organizationId: logOrgId ? logOrgId.slice(0, 28) : '',
              costMs: cost,
              message: err && (err.message || err.errMsg) ? (err.message || err.errMsg) : String(err),
            })
            reject(err)
          }
        })
      })
    },

    // 新增机构入口二维码生成：调 A 侧 NEWDL_ResponseQRCode，由它经 HTTP 联动 B 侧
    // DLforP_entry_qrcode 生成归属 B 的小程序码，二维码记录入库到 organization 文档 entry_qrcode 字段，
    // 并把图片转存到 A 侧云存储后返回 A 侧 fileID（前端展示永久有效，不受 B 侧临时链接过期影响）
    generateOrganizationQrcode() {
      if (this.data.qrcodeCard.isLoading) {
        return
      }

      const app = getApp()
      // 虽然 callFunction 通道能按 openid 解析机构，这里仍显式传 organizationId：
      // 云函数收到 organizationId 时直接按 ID 直查机构文档，少一次用户/机构解析，日志也好对账。
      // 取值从 currentOrganizationId 取；机构刚创建成功时，stayForQrcode 分支已先回填过。
      const organizationId = String(this.data.currentOrganizationId || '').trim()
      if (!organizationId) {
        this.setData({
          qrcodeCard: {
            ...this.data.qrcodeCard,
            visible: true,
            isLoading: false,
            message: '未检测到机构 ID，请先创建机构或刷新页面后重试'
          }
        })
        return
      }

      this.setData({
        qrcodeCard: {
          ...this.data.qrcodeCard,
          visible: true,
          isLoading: true,
          message: '正在生成机构入口二维码...',
          transferWarning: ''
        }
      })

      return this.callResponseQrcodeCloud('generateOrganizationQrcode', {
        organizationId,
        envVersion: app.globalData.miniEnvVersion || 'develop'
      }).then((res) => {
        const result = res && res.result ? res.result : {}
        if (result.status !== 'success') {
          this.setData({
            qrcodeCard: {
              ...this.data.qrcodeCard,
              isLoading: false,
              message: result.message || '二维码生成失败，请稍后重试'
            }
          })
          return
        }

        // 新增二维码返回结果展示：qrcodeFileId 是 A 侧云存储地址，entryId / scene 是 B 侧中转表入口标识与扫码参数
        // 新增区块二解锁门控：创建流程等待期间，必须拿到可展示的 A 侧二维码 fileID 才解锁第二区（PendingSupplement）；
        // 仅 B 侧成功但转存失败（qrcodeFileId 为空）时保持门控等待，可通过再次点击生成重试
        const generatedQrcodeFileId = String(result.qrcodeFileId || '').trim()
        const generatedRawQrcodeFileId = String(result.rawQrcodeFileId || '').trim()
        const qrcodeGateSatisfied = this.data.qrcodeGatePending && !!generatedQrcodeFileId
        // 新增：根据云函数返回的 diyLogoStatus（三档枚举），把 Logo 合成状态展示给用户。
        // 三种提示分别覆盖：has_logo（成功，无需提示或仅在 console 记录）、missing（字段缺失，明确指引编辑页补传）、
        // download_or_decode_failed（有 fileID 但下载或解码失败，提示换 PNG/JPG 重试）。
        const diyLogoStatus = String(result.diyLogoStatus || '').trim()
        let diyToastMessage = ''
        let diyMessageLine = ''
        if (diyLogoStatus === 'missing') {
          diyMessageLine = '未合成 DIY Logo：请点击编辑页 DIY 二维码框上传 PNG/JPG 格式图片，保存补充信息后重新生成'
          diyToastMessage = '二维码已生成，但 DIY Logo 未合成。请补传 PNG/JPG 图片并重试'
        } else if (diyLogoStatus === 'download_or_decode_failed') {
          diyMessageLine = 'DIY Logo 下载或解码失败，请确认图片为 PNG/JPG 格式后重新上传，并再次生成二维码'
          diyToastMessage = '二维码已生成，但 DIY Logo 下载或解码失败，请更换 PNG/JPG 格式图片重试'
        } else if (diyLogoStatus === 'has_logo') {
          diyMessageLine = '' // Logo 成功合成，不需要额外文字说明，二维码中心本身就能看到
        }
        this.setData({
          qrcodeCard: {
            ...this.data.qrcodeCard,
            isLoading: false,
            hasRecord: true,
            qrcodeFileId: generatedQrcodeFileId,
            rawQrcodeFileId: generatedRawQrcodeFileId,
            entryId: String(result.entryId || '').trim(),
            scene: String(result.scene || '').trim(),
            diyLogoStatus,
            message: diyMessageLine, // 如果有 DIY 相关提示就显示；成功合成时置空让页面清爽
            transferWarning: String(result.transferWarning || '').trim()
          },
          supplementUnlocked: qrcodeGateSatisfied || this.data.supplementUnlocked,
          qrcodeGatePending: this.data.qrcodeGatePending && !qrcodeGateSatisfied
        })
        // 新增：只有 DIY 未成功合成才弹 Toast；成功合成就沿用区块二解锁 Toast，避免无意义打扰。
        if (diyToastMessage) {
          wx.showToast({
            title: diyToastMessage,
            icon: 'none',
            duration: 3000
          })
        }
      }).catch(() => {
        this.setData({
          qrcodeCard: {
            ...this.data.qrcodeCard,
            isLoading: false,
            message: '网络错误，二维码生成失败，请稍后重试'
          }
        })
      })
    },

    // 新增编辑态二维码回查：调 getOrganizationQrcode 读取机构文档里已入库的二维码记录
    // 未生成过时（NOT_GENERATED）留出空态卡片，管理层可手动点「生成机构入口二维码」补一次入库
    fetchOrganizationQrcodeForEdit() {
      const app = getApp()
      // 编辑态进页时 currentOrganizationId 已由 refreshCurrentOrganizationCard 从机构文档回填；
      // 显式传 organizationId 让云函数按 ID 直查（理由见 callResponseQrcodeCloud 注释）。
      const organizationId = String(this.data.currentOrganizationId || '').trim()
      if (!organizationId) {
        return Promise.resolve()
      }
      // 走 callResponseQrcodeCloud（wx.cloud.callFunction）调普通云函数，理由见其注释。
      return this.callResponseQrcodeCloud('getOrganizationQrcode', {
        organizationId,
        envVersion: app.globalData.miniEnvVersion || 'develop'
      }).then((res) => {
        const result = res && res.result ? res.result : {}
        if (result.status !== 'success') {
          if (result.code === 'NOT_GENERATED') {
            this.setData({
              qrcodeCard: {
                ...this.data.qrcodeCard,
                visible: true,
                isLoading: false,
                hasRecord: false,
                qrcodeFileId: '',
                rawQrcodeFileId: '',
                entryId: '',
                scene: '',
                message: '机构入口二维码尚未生成',
                transferWarning: ''
              }
            })
          }
          return
        }

        this.setData({
          qrcodeCard: {
            ...this.data.qrcodeCard,
            visible: true,
            isLoading: false,
            hasRecord: true,
            qrcodeFileId: String(result.qrcodeFileId || '').trim(),
            rawQrcodeFileId: String(result.rawQrcodeFileId || '').trim(),
            entryId: String(result.entryId || '').trim(),
            scene: String(result.scene || '').trim(),
            diyLogoStatus: String(result.diyLogoStatus || '').trim(),
            // 新增转存失败 + DIY Logo 状态合并提示：
            // 优先级：转存失败 > Logo 未合成 > Logo 解码失败 > 正常（空消息）
            // 转存失败提示：记录在库但 A 侧图片缺失时，引导管理层点按钮重新生成（云函数侧会自愈补转存）
            message: (function buildEditQrMessage() {
              const hasComposed = !!String(result.qrcodeFileId || '').trim()
              if (!hasComposed) return '二维码记录存在但图片转存失败，点击下方按钮重新生成'
              const status = String(result.diyLogoStatus || '').trim()
              if (status === 'missing') {
                return '未合成 DIY Logo：请点击上方 DIY 二维码框上传 PNG/JPG 格式图片，保存补充信息后点击生成二维码按钮重试'
              }
              if (status === 'download_or_decode_failed') {
                return 'DIY Logo 下载或解码失败，请确认图片为 PNG/JPG 格式后重新上传，再点击生成二维码按钮重试'
              }
              return '' // has_logo 或未上报：消息留空，页面清爽（Logo 成功合成本身就是视觉证据）
            })(),
            transferWarning: ''
          }
        })
      }).catch(() => {
        // 新增回查失败兜底：编辑态回查失败不打断页面，管理层可手动点生成按钮重试
      })
    },

    // 新增二维码大图预览：打印或张贴前先放大确认清晰度
    // 新增（2026-09-04）：合成码与原始码同时进入预览列表，点击哪张就以哪张为 current，便于对照确认 Logo 合成效果。
    previewQrcodeImage(e) {
      const card = this.data.qrcodeCard || {}
      const composedFileId = String(card.qrcodeFileId || '').trim()
      const rawFileId = String(card.rawQrcodeFileId || '').trim()
      if (!composedFileId && !rawFileId) {
        wx.showToast({
          title: '二维码尚未生成',
          icon: 'none'
        })
        return
      }
      // 点击的码类型（composed / raw）从 dataset 取；默认以合成码为 current。
      const tapType = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.type) || '').trim()
      const urls = [composedFileId, rawFileId].filter((id) => !!id)
      let current = composedFileId || urls[0]
      if (tapType === 'raw' && rawFileId) {
        current = rawFileId
      }
      wx.previewImage({ current, urls })
    },

    // 新增创建机构提交（区块一 Oncegenerated_cannotbemodified）：
    // 只收口区块一三项必填字段（机构名称 / 邀请码前缀 / DIY二维码图片），
    // 其余资料归区块二（PendingSupplement），在二维码生成后由 onSaveSupplement 补充保存。
    // 联系电话（contact_phone）已从区块二表单移除（2026-09-06），由教练资料自动回填提交。
    // 同日修正（2026-09-06）：联系电话输入框已恢复到区块二（必填）；创建阶段（区块一）仍不校验手机号，
    // 必填与 11 位格式校验统一在 onSaveSupplement 执行。
    onCreateOrganization() {
      if (!this.data.authReady) {
        wx.showToast({
          title: '请先完成教练认证',
          icon: 'none'
        })
        return
      }

      const createForm = this.data.createForm || {}
      if (!String(createForm.organization_name || '').trim()) {
        wx.showToast({
          title: '请填写机构名称',
          icon: 'none'
        })
        return
      }

      // 调整（2026-09-05）：字段语义从「邀请码前缀」升级为「完整自定义邀请码」，提示文案同步更新
      if (!this.data.isEditMode && !String(createForm.invite_prefix || '').trim()) {
        wx.showToast({
          title: '请填写自定义邀请码',
          icon: 'none'
        })
        return
      }

      // 新增 DIY 二维码图片必填校验：合成到入口二维码中间的品牌 Logo / 教练头像
      if (!this.data.isEditMode && !String(createForm.diy_qrcode_image || '').trim()) {
        wx.showToast({
          title: '请上传DIY二维码图片',
          icon: 'none'
        })
        return
      }

      // 调整（2026-09-06）：联系电话（contact_phone）已从区块二表单移除，
      // 由教练资料（profile.phone）自动回填到 createForm.contact_phone 并随 organization_basic 提交，
      // 创建阶段不再强制；手机号格式校验在 onSaveSupplement 中按「填了才校验」处理。
      // 同日修正（2026-09-06）：联系电话输入框已恢复，自动回填带出逻辑保留；创建阶段依旧不校验手机号，
      // 必填与 11 位格式校验统一在 onSaveSupplement 执行（原「填了才校验」已改回必填）。

      this.submitOrganizationAction(this.data.isEditMode ? 'updateOrganization' : 'createOrganization', {
        organization_basic: createForm
      }, {
        successTitle: this.data.isEditMode ? '机构信息已更新' : '机构创建成功',
        // 新增创建流程停留本页：创建成功后就地生成并展示机构入口二维码（编辑保存仍回机构首页）
        stayForQrcode: !this.data.isEditMode
      })
    },

    // 新增区块二（PendingSupplement）保存：补充信息解锁后由这里提交 updateOrganization；
    // 只负责第二区资料（联系人 / 城市 / 地址 / 简介 / 轮播图 / 品牌副标题 / 核心服务 / 服务区域 / 适合谁 / 教练理念）。
    // 联系电话（contact_phone）已从表单移除（2026-09-06）：手机号在教练资料入库，自动回填并提交，A→B 同步逻辑已就绪。
    // 同日修正（2026-09-06）：联系电话输入框已恢复（必填 + 11 位格式校验）；所在城市（city）输入框已删除、
    // 不再收集与校验城市（createForm.city 字段保留，仅用于编辑态带回历史值，不主动清除旧数据）。
    // 区块一字段（名称 / 前缀 / DIY二维码图片）生成后不可修改，随表单原值带回不改动。
    // 调整（2026-09-05）：展示页（家长扫码落地页 entry_landing / B 侧机构展示页）会出现第二区全部字段，
    // 因此第二区字段全部必填，保存前逐项校验拦截
    onSaveSupplement() {
      if (!this.data.authReady) {
        wx.showToast({
          title: '请先完成教练认证',
          icon: 'none'
        })
        return
      }

      if (!this.data.supplementUnlocked) {
        wx.showToast({
          title: '请先生成机构入口二维码',
          icon: 'none'
        })
        return
      }

      const createForm = this.data.createForm || {}
      // 联系人必填：展示页「联系人」行直接取该字段渲染
      if (!String(createForm.contact_name || '').trim()) {
        wx.showToast({
          title: '请填写联系人',
          icon: 'none'
        })
        return
      }

      // 调整（2026-09-06）：联系电话（contact_phone）不再由本表单收集。
      // 手机号已在教练资料（NDLdev_users.phone）入库，refreshCertificationState 自动从 profile.phone
      // 回填到 createForm.contact_phone 并随区块二一起提交；A→B 机构展示同步传输逻辑已就绪。
      // 因此此处不再强制校验 11 位手机号格式，避免用户无法编辑该字段时被必填校验拦截。
      // 同日修正（2026-09-06）：上一条调整系误操作——用户要求删除的是「所在城市」，联系电话输入框已恢复；
      // 手机号恢复必填 + 11 位格式校验（输入框仍由教练资料自动回填带出，可直接修改）。
      if (!/^1[3-9]\d{9}$/.test(String(createForm.contact_phone || '').trim())) {
        wx.showToast({
          title: '请填写正确的11位手机号',
          icon: 'none'
        })
        return
      }

      // 调整（2026-09-06）：所在城市（city）输入框已从区块二删除、不再收集，城市必填校验同步移除；
      // createForm.city 仍可能携带编辑态回填的机构文档历史值并随表单提交，此处不做任何拦截。

      // 机构地址必填：展示页「机构地址」行直接取该字段渲染
      if (!String(createForm.address || '').trim()) {
        wx.showToast({
          title: '请填写机构地址',
          icon: 'none'
        })
        return
      }

      // 机构简介必填：展示页简介区直接取该字段渲染
      if (!String(createForm.intro || '').trim()) {
        wx.showToast({
          title: '请填写机构简介',
          icon: 'none'
        })
        return
      }

      // 新增（2026-09-05）：品牌副标题 slogan 必填 —— 展示在机构首页 Hero 区机构名称下方（os-hero-subtitle）
      if (!String(createForm.slogan || '').trim()) {
        wx.showToast({
          title: '请填写品牌副标题',
          icon: 'none'
        })
        return
      }

      // 新增（2026-09-05）：核心服务 / 服务区域 / 适合谁 / 教练理念 四项必填校验，
      // 与其余区块二字段一致 —— 展示页区块三（基本信息）会渲染这些行
      if (!String(createForm.core_services || '').trim()) {
        wx.showToast({
          title: '请填写核心服务',
          icon: 'none'
        })
        return
      }

      if (!String(createForm.service_area || '').trim()) {
        wx.showToast({
          title: '请填写服务区域',
          icon: 'none'
        })
        return
      }

      if (!String(createForm.target_audience || '').trim()) {
        wx.showToast({
          title: '请填写适合谁',
          icon: 'none'
        })
        return
      }

      if (!String(createForm.coaching_philosophy || '').trim()) {
        wx.showToast({
          title: '请填写教练理念',
          icon: 'none'
        })
        return
      }

      // 首页轮播图必填：展示页轮播区至少要有一张图才不空白（最多 5 张的上限沿用上传处限制）
      if (!Array.isArray(createForm.brand_swiper_images) || !createForm.brand_swiper_images.length) {
        wx.showToast({
          title: '请至少上传1张轮播图',
          icon: 'none'
        })
        return
      }

      this.submitOrganizationAction('updateOrganization', {
        organization_basic: createForm
      }, {
        successTitle: '机构信息已更新'
      })
    },

    // 新增机构操作统一提交：创建机构和教练加入都走同一个云函数
    // 拆分说明（2026-09-20）：本组件只处理 create 链路（含 stayForQrcode 分支），
    // staffForm 回填已下沉到 coachaddorganization 组件，本组件不再处理 staffRole
    submitOrganizationAction(action, payload, options = {}) {
      if (this.data.isSubmitting) {
        return
      }

      const app = getApp()
      this.setData({
        isSubmitting: true,
        submitResultCard: null
      })
      wx.showLoading({
        title: '提交中...'
      })

      wx.cloud.callFunction({
        name: getApp().getFnName('ForOrganizationDo'),
        data: {
          action,
          envVersion: app.globalData.miniEnvVersion || 'develop',
          ...payload
        }
      }).then((res) => {
        const result = res && res.result ? res.result : {}
        if (result.status !== 'success') {
          wx.showToast({
            title: result.message || '提交失败',
            icon: 'none'
          })
          return
        }

        const organizationProfile = {
          orgId: result.organizationId || '',
          orgName: result.organizationName || '',
          memberRole: result.memberRole || '',
          inviteCode: result.invitationCode || '',
          joinedAt: result.joinedAt || '',
          source: action
        }

        if (app.saveUserIdentity) {
          app.saveUserIdentity({
            userRole: 'C',
            bizRole: action === 'joinOrganization' ? BIZ_ROLE_ORG_COACH : BIZ_ROLE_ORG_ADMIN,
            organizationProfile,
            needChooseRole: false
          })
        }

        // 新增结果卡片跨页透传：创建页提交成功后，结果卡片改到机构首页入口区展示
        const nextSubmitResultCard = {
          title: options.successTitle || '提交成功',
          organizationName: result.organizationName || '',
          invitationCode: result.invitationCode || '',
          memberRoleLabel: action === 'joinOrganization' ? '机构执行教练' : '机构管理层',
          message: result.message || '操作成功'
        }

        this.setData({
          submitResultCard: nextSubmitResultCard
        })

        wx.setStorageSync(ORGANIZATION_RESULT_CARD_STORAGE_KEY, nextSubmitResultCard)

        // 新增身份入库回填：云函数返回当前用户在机构成员项里的 staff_role，
        // 页面据此刷新身份选择区，避免前端选的值和最终落库值不一致
        // 拆分说明（2026-09-20）：staffForm 回填已下沉到 coachaddorganization 组件，本组件不再处理 staffRole

        // 新增创建成功停留本页：机构入口二维码的生成 + 入库在 NEWDL_ResponseQRCode 云函数侧完成
        // （B 侧生成归属 B 的码 → 图片转存 A 侧云存储 → 入库 organization 文档 entry_qrcode 字段），
        // 前端就地展示返回结果，不再立即跳转机构首页
        if (options.stayForQrcode) {
          // 先把刚创建成功的机构 ID 回填 currentOrganizationId 和 currentInvitationCode，
          // 后续 generateOrganizationQrcode 按 HTTP 模式调用时必须显式传 organizationId。
          // 新增区块二门控：创建成功后进入二维码门控等待期（qrcodeGatePending），
          // 第二区（PendingSupplement）保持锁定，直到入口二维码生成成功才解锁填写
          this.setData({
            currentOrganizationId: String(result.organizationId || '').trim(),
            currentInvitationCode: String(result.invitationCode || '').trim(),
            isEditMode: true,
            qrcodeGatePending: true,
            supplementUnlocked: false,
            // 新增（2026-09-06）：创建成功解锁区块二前，把区块二表单字段全部清空——
            // 防止同页面实例里上一次「编辑态回填」带来的旧机构数据/默认文案残留，
            // 随新机构的区块二提交一起入库（org_1a0749 默认值污染即此场景）。
            // 区块一三字段（organization_name/invite_prefix/diy_qrcode_image）保留不动
            createForm: {
              ...this.data.createForm,
              contact_name: '',
              contact_phone: '',
              city: '',
              address: '',
              intro: '',
              slogan: '',
              core_services: '',
              service_area: '',
              target_audience: '',
              coaching_philosophy: '',
              brand_swiper_images: []
            },
            qrcodeCard: {
              ...this.data.qrcodeCard,
              visible: true,
              isLoading: false,
              hasRecord: false,
              qrcodeFileId: '',
              entryId: '',
              scene: '',
              message: '机构创建成功，正在生成机构入口二维码...',
              transferWarning: ''
            }
          })
          this.generateOrganizationQrcode()
          return
        }

        wx.showToast({
          title: options.successTitle || '提交成功',
          icon: 'success'
        })

        // 新增保存后停留本页：身份保存这类单项提交不需要跳走，用户继续在当前页操作
        if (options.stayOnPage) {
          return
        }

        // 新增成功后自动回入口：用户提交成功后直接回机构首页看结果卡片，不用自己再点一次返回
        wx.switchTab({
          url: '/pages/organization/organization'
        })
      }).catch(() => {
        wx.showToast({
          title: '网络错误',
          icon: 'none'
        })
      }).finally(() => {
        wx.hideLoading()
        this.setData({
          isSubmitting: false
        })
      })
    },

    // 新增成功后返回机构入口：创建机构或加入机构后，统一回到机构入口页查看当前状态
    backToOrganizationEntry() {
      wx.switchTab({
        url: '/pages/organization/organization'
      })
    },

    // 新增下拉刷新入口（2026-09-20）：供宿主页面 onPullDownRefresh 调用，
    // 清除未保存编辑标记后整包回查机构卡片
    // 拆分说明（2026-09-20）：认证状态已由外壳 onPullDownRefresh → refreshCertificationState 统一刷新，
    // 本组件下拉刷新只回查机构资料
    refreshForPullDown() {
      this._hasUnsavedFormEdits = false
      return this.refreshCurrentOrganizationCard()
    }
  }
})
