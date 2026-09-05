// pages/organization/organization_create/organization_create.js
const {
  BIZ_ROLE_ORG_ADMIN,
  BIZ_ROLE_ORG_COACH
} = require('../../../utils/bizRole')
const { prepareImageForUpload } = require('../../../utils/imageUpload')

const TAB_CREATE = 'create'
const TAB_JOIN = 'join'
const ORGANIZATION_RESULT_CARD_STORAGE_KEY = 'organizationEntryResultCard'
const BRAND_SWIPER_IMAGE_MAX_COUNT = 5

Page({

  /**
   * 页面的初始数据
   */
  data: {
    currentTab: TAB_CREATE,
    tabList: [
      { key: TAB_CREATE, label: 'A创建机构' },
      { key: TAB_JOIN, label: 'B教练加入' }
    ],
    isEditMode: false,
    currentOrganizationId: '',
    currentInvitationCode: '',
    isAuthLoading: false,
    authReady: false,
    authStatusText: '正在检查教练认证状态',
    authTipText: '创建机构和教练加入都必须先完成教练资料认证。',
    securityReview: {
      status: '',
      reason: '',
      message: '',
      checkType: '',
      failedTextIndex: -1,
      failedImageIndex: -1
    },
    createForm: {
      organization_name: '',
      invite_prefix: '',
      // 新增 DIY 二维码图片：机构上传自己的图片（教练头像 / 品牌 Logo），生成入口二维码时合成到二维码中间；
      // 属于区块一（Oncegenerated_cannotbemodified）字段，创建时必填、生成后不可修改
      diy_qrcode_image: '',
      contact_name: '',
      contact_phone: '',
      city: '',
      address: '',
      intro: '',
      brand_swiper_images: []
    },
    joinForm: {
      invitation_code: ''
    },
    inviteCodePreview: '',
    joinCodePreview: '',
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

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    const tab = options && options.tab ? String(options.tab).trim() : TAB_CREATE
    const mode = options && options.mode ? String(options.mode).trim() : ''
    this.setData({
      currentTab: tab === TAB_JOIN ? TAB_JOIN : TAB_CREATE,
      isEditMode: mode === 'edit'
    })
    this.refreshCertificationState()
    this.refreshCurrentOrganizationCard()
  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {

  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    this.refreshCertificationState()
    this.refreshCurrentOrganizationCard()
  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {

  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {

  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {
    Promise.all([
      this.refreshCertificationState(),
      this.refreshCurrentOrganizationCard()
    ]).finally(() => {
      wx.stopPullDownRefresh()
    })
  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {

  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {
    return {
      title: '机构创建与加入',
      path: `/pages/organization/organization_create/organization_create?tab=${this.data.currentTab || TAB_CREATE}`
    }
  },

  // 新增标签切换：机构创建和教练加入都放在一个页面里，通过顶部 Tab 切换
  onTabTap(e) {
    const tab = e.currentTarget.dataset.tab
    if (!tab || tab === this.data.currentTab) {
      return
    }

    this.setData({
      currentTab: tab,
      submitResultCard: null
    })
  },

  // 新增资料认证状态刷新：创建机构和教练加入都必须先完成教练资料认证
  refreshCertificationState() {
    const app = getApp()
    this.setData({
      isAuthLoading: true,
      authStatusText: '正在检查教练认证状态'
    })

    return wx.cloud.callFunction({
      name: 'NEWDL_mine_user',
      data: {
        action: 'getProfile',
        envVersion: app.globalData.miniEnvVersion || 'develop'
      }
    }).then((res) => {
      const result = res && res.result ? res.result : {}
      const profile = result.profile || {}
      const securityReview = result.securityReview || {}
      const approved = String((securityReview && securityReview.status) || '').trim() === 'approved'

      this.setData({
        securityReview,
        authReady: approved,
        authStatusText: approved ? '已完成教练认证，可以继续操作' : '未完成教练认证，暂时不能提交',
        authTipText: approved
          ? '你现在可以创建机构，或者填写邀请码加入机构。'
          : '请先完成教练资料填写并等待审核通过，再回来创建机构或加入机构。',
        'createForm.contact_name': this.data.createForm.contact_name || profile.nickname || '',
        'createForm.contact_phone': this.data.createForm.contact_phone || profile.phone || ''
      })
      this.updateInviteCodePreview()
    }).catch(() => {
      this.setData({
        authReady: false,
        authStatusText: '认证状态获取失败，请稍后重试',
        authTipText: '当前无法确认你的教练认证状态，暂时先不要提交。'
      })
    }).finally(() => {
      this.setData({
        isAuthLoading: false
      })
    })
  },

  // 新增进页机构回查：当前页仍保留机构资料回查，结果卡片展示改由机构首页承接
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

      this.setData({
        isEditMode: isAdminRole && this.data.currentTab === TAB_CREATE,
        currentOrganizationId: String(organizationBasic.organization_id || '').trim(),
        currentInvitationCode: String(organizationBasic.invitation_code || '').trim(),
        // 新增机构资料回填：管理层进入创建页时，直接把已有机构资料带到表单里，改完即可提交
        createForm: isAdminRole ? {
          organization_name: String(organizationBasic.organization_name || '').trim(),
          invite_prefix: String(organizationBasic.invitation_prefix || '').trim(),
          // 新增 DIY 二维码图片回填：编辑态只读展示（区块一生成后不可修改）
          diy_qrcode_image: String(organizationBasic.diy_qrcode_image || '').trim(),
          contact_name: String(organizationBasic.contact_name || '').trim(),
          contact_phone: String(organizationBasic.contact_phone || '').trim(),
          city: String(organizationBasic.city || '').trim(),
          address: String(organizationBasic.address || '').trim(),
          intro: String(organizationBasic.intro || '').trim(),
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
      value = value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8)
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

  // 新增加入机构输入收口：邀请码统一转成大写英数格式，避免前端提交脏值
  onJoinInput(e) {
    let value = String((e.detail && e.detail.value) || '')
    value = value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 16)

    this.setData({
      'joinForm.invitation_code': value,
      joinCodePreview: value
    })
  },

  // 新增邀请码预览：前缀由用户决定，剩余位由系统补足 16 位
  updateInviteCodePreview() {
    if (this.data.isEditMode) {
      this.setData({
        inviteCodePreview: this.data.currentInvitationCode || ''
      })
      return
    }

    const prefix = String((this.data.createForm && this.data.createForm.invite_prefix) || '').trim().toUpperCase()
    const remainLength = Math.max(16 - prefix.length, 0)
    const preview = `${prefix}${'X'.repeat(remainLength)}`
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

  // 新增 HTTP 云函数统一调用封装（修复 -501001 FunctionType parameter is invalid）：
  // NEWDL_ResponseQRCode 部署为 HTTP 云函数（scf_bootstrap + 监听 9000 端口），
  // HTTP 云函数只能通过 wx.cloud.callHTTPFunction / HTTP 网关触发，
  // 用 wx.cloud.callFunction 调它会直接报 -501001 FunctionType parameter is invalid。
  // 注意：callHTTPFunction 要求基础库 ≥ 3.15.1；返回体从 res.result 变为 res.data（HTTP 语义）。
  callResponseQrcodeCloud(action, extraData = {}) {
    return new Promise((resolve, reject) => {
      // 基础库过低时没有 callHTTPFunction，返回可读错误，避免 undefined 调用直接崩。
      if (!wx.cloud || typeof wx.cloud.callHTTPFunction !== 'function') {
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
      wx.cloud.callHTTPFunction({
        name: 'NEWDL_ResponseQRCode',
        // HTTP 语义调用：POST / + JSON body，云函数侧 HTTP 入口会把 body 合并成 event。
        path: '/',
        method: 'post',
        data: { action, ...extraData },
        success: (res) => {
          const cost = Date.now() - requestAt
          const payload = (res && res.data) ? res.data : {}
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
    // HTTP 云函数模式下必须显式传 organizationId（没有微信身份上下文），
    // 这里从 currentOrganizationId 取；机构刚创建成功时，stayForQrcode 分支已先回填过。
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
      const result = res && res.data ? res.data : {}
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
    // HTTP 云函数模式下必须显式传 organizationId（没有微信身份上下文），
    // 编辑态进页时 currentOrganizationId 已由 refreshCurrentOrganizationCard 从机构文档回填。
    const organizationId = String(this.data.currentOrganizationId || '').trim()
    if (!organizationId) {
      return Promise.resolve()
    }
    // 改用 callResponseQrcodeCloud（wx.cloud.callHTTPFunction）调用 HTTP 云函数，理由见其注释。
    return this.callResponseQrcodeCloud('getOrganizationQrcode', {
      organizationId,
      envVersion: app.globalData.miniEnvVersion || 'develop'
    }).then((res) => {
      const result = res && res.data ? res.data : {}
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
  // 联系电话等其余资料归区块二（PendingSupplement），在二维码生成后由 onSaveSupplement 补充保存
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

    if (!this.data.isEditMode && !String(createForm.invite_prefix || '').trim()) {
      wx.showToast({
        title: '请填写邀请码前缀',
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

    // 联系电话校验移除：区块二未解锁前不收集联系电话，创建阶段不再强制；
    // 手机号格式校验统一挪到 onSaveSupplement（区块二保存）里做

    this.submitOrganizationAction(this.data.isEditMode ? 'updateOrganization' : 'createOrganization', {
      organization_basic: createForm
    }, {
      successTitle: this.data.isEditMode ? '机构信息已更新' : '机构创建成功',
      // 新增创建流程停留本页：创建成功后就地生成并展示机构入口二维码（编辑保存仍回机构首页）
      stayForQrcode: !this.data.isEditMode
    })
  },

  // 新增区块二（PendingSupplement）保存：补充信息解锁后由这里提交 updateOrganization；
  // 只负责第二区资料（联系人 / 联系电话 / 城市 / 地址 / 简介 / 轮播图），
  // 区块一字段（名称 / 前缀 / DIY二维码图片）生成后不可修改，随表单原值带回不改动
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
    // 手机号校验从创建阶段挪到这里：第二区解锁后补充联系电话时才强制校验
    if (!/^1[3-9]\d{9}$/.test(String(createForm.contact_phone || '').trim())) {
      wx.showToast({
        title: '请填写正确的11位手机号',
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

  // 新增教练加入提交：填写邀请码校验通过后，才会成为机构执行教练
  onJoinOrganization() {
    if (!this.data.authReady) {
      wx.showToast({
        title: '请先完成教练认证',
        icon: 'none'
      })
      return
    }

    const invitationCode = String((((this.data || {}).joinForm || {}).invitation_code) || '').trim().toUpperCase()
    if (invitationCode.length !== 16) {
      wx.showToast({
        title: '请输入16位邀请码',
        icon: 'none'
      })
      return
    }

    this.submitOrganizationAction('joinOrganization', {
      invitation_code: invitationCode
    }, {
      successTitle: '加入机构成功'
    })
  },

  // 新增机构操作统一提交：创建机构和教练加入都走同一个云函数
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
      name: 'ForOrganizationDo',
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
  }
})
