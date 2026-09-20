// ============================================================
// 业务积木：表单提交 - profile_coachbaseinformation 模块
// 所属页面：pages/index/profile/profile（教练基础资料填写）
// 说明：本组件完整还原原 profile 页面的固定 UI 结构与全部业务逻辑，
//       由原 Page 形态改造为 Component。所有事件方法位于 methods 内，
//       组件 attached 时自动加载资料。
// ============================================================

const { prepareImageForUpload } = require('../../../utils/imageUpload')

// 新增教练默认头像：未上传照片时按性别自动套用官方默认头像，保证资料页头像不会空白
const DEFAULT_COACH_AVATAR = {
  男: 'cloud://cloud1-6gh7jgl8c5b16a83.636c-cloud1-6gh7jgl8c5b16a83-1398046944/NEWDL/users/默认头像defaultavatar/default_coach_avatar_male_cropped.png',
  女: 'cloud://cloud1-6gh7jgl8c5b16a83.636c-cloud1-6gh7jgl8c5b16a83-1398046944/NEWDL/users/默认头像defaultavatar/default_coach_avatar_female_cropped.png'
}

// 新增性别选项：基础信息区收集教练性别，同时决定默认头像
const GENDER_OPTIONS = ['男', '女']

// 新增默认昵称：新用户（数据库无昵称）自动填入该昵称，与输入框占位文案保持一致
const DEFAULT_NICKNAME = 'XX教练'

// 新增擅长领域选项：文案直接参考创建课程页的课程方向，资料页改成可多选收集
const SKILL_OPTION_GROUPS = [
  { title: '体态矫正', options: ['圆肩驼背改善', '脊柱侧弯预防', 'X/O 型腿调整'] },
  { title: '专业追高', options: ['基础能力巩固', '专项成绩突破', '考级与比赛冲刺'] },
  { title: '田径专项', options: ['短跑爆发力', '中长跑耐力', '跑跳投综合训练'] },
  { title: '中考体育', options: ['长跑专项', '跳绳专项', '实心球专项'] },
  { title: '少儿体能班', options: ['基础体能', '协调性训练', '平衡能力'] },
  { title: '跳绳班', options: ['基础跳绳', '速度跳绳', '花样跳绳'] },
  { title: '球类专项班', options: ['乒乓球', '羽毛球', '篮球', '足球'] }
]

Component({
  data: {
    currentIndex: -1,   // 当前展开的卡片索引（默认全部收起）
    isSaving: false,
    isUploadingImage: false,
    securityReview: {
      status: '',
      reason: '',
      message: '',
      checkType: '',
      failedTextIndex: -1,
      failedImageIndex: -1
    },
    profileForm: {
      avatarUrl: '',
      nickname: '',
      phone: '',
      gender: '',
      experienceLevel: '',
      studentCountLevel: '',
      city: '',
      address: '',
      basicPhotoProof: '',
      aboutMe: '',
      workExperience: '',
      education: '',
      educationPhotoProof: '',
      skills: '',
      languages: '',
      honors: '',
      relatedCertificates: '',
      honorShowcase: ''
    },
    skillOptionGroups: [],
    genderOptions: GENDER_OPTIONS,
    // 新增默认头像展示源：按当前性别算出的官方默认头像，与自定义照片并列展示
    defaultAvatarUrl: '',
    // 新增自定义照片标记：区分「用户自己上传的照片」与「系统默认头像」
    hasCustomAvatar: false,

    cards: [
      // 新增资料模块：表单页补充相关证书和荣誉展示，和展示页保持同步
      { icon: "🎓", title: "教育背景", field: "education", placeholder: "填写你的教育背景", value: '', proofField: 'educationPhotoProof', proofLabel: '照片佐证' },
      { icon: "📜", title: "相关证书", field: "relatedCertificates", placeholder: "如：教师资格证、救生员证、体适能教练证", value: '', isMultiBlock: true, blockLabel: '证书内容', proofLabel: '证书佐证' },
      { icon: "🏆", title: "荣誉展示", field: "honorShowcase", placeholder: "如：比赛获奖、优秀教练、学员成果展示", value: '', isMultiBlock: true, blockLabel: '荣誉内容', proofLabel: '荣誉佐证' },
      // { icon: "👤", title: "关于我", field: "aboutMe", placeholder: "介绍一下自己", value: '' },
      // { icon: "💼", title: "工作经历", field: "workExperience", placeholder: "填写你的工作经历", value: '' },
      // 保留说明：用户要求将第 7、8 个资料卡片注释但不删除，当前先隐藏“擅长领域”“教学风格”
      // { icon: "⭐", title: "擅长领域", field: "skills", placeholder: "如：体能训练、力量训练、青少年训练", value: '' },
      // { icon: "♡", title: "教学风格", field: "honors", placeholder: "如：耐心负责、因材施教、鼓励式教学", value: '' },
      // 保留说明：用户已明确要求“所在地区不要”，这里不再在表单页收集该项
    ]
  },

  // 新增组件生命周期：原 Page 的 onLoad 逻辑迁移到 attached；localImagePathMap 作为实例属性在 created 初始化
  lifetimes: {
    created() {
      // 新增本地图片路径映射：记录上传原图的本地路径，提交审核时据此压成最小图（原 Page 顶层属性下沉）
      this.localImagePathMap = {}
    },
    attached() {
      this.localImagePathMap = {}
      this.applyProfileForm(this.data.profileForm)
      this.loadProfile()
    }
  },

  methods: {
    // 新增多选文本解析：兼容历史手输文本和当前多选结果，统一整理成去重数组
    parseSkillSelectionList(rawValue) {
      const text = String(rawValue || '').trim()
      if (!text) {
        return []
      }

      try {
        const parsedValue = JSON.parse(text)
        if (Array.isArray(parsedValue)) {
          return [...new Set(parsedValue.map((item) => String(item || '').trim()).filter(Boolean))]
        }
      } catch (error) {
        // 保留兼容：历史旧值继续按普通文本分隔解析
      }

      return [...new Set(
        text
          .split(/[\n,，、/]+/)
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      )]
    },

    // 新增多选结果序列化：继续落成字符串字段，避免改动云函数和数据库结构
    serializeSkillSelectionList(selectionList = []) {
      return [...new Set((selectionList || []).map((item) => String(item || '').trim()).filter(Boolean))].join('、')
    },

    // 新增擅长领域展示源：让 WXML 直接拿到已选中状态，减少模板层判断复杂度
    buildSkillOptionGroups(selectedList = []) {
      const selectedMap = {}
      ;(selectedList || []).forEach((item) => {
        selectedMap[item] = true
      })

      return SKILL_OPTION_GROUPS.map((group) => ({
        title: group.title,
        options: (group.options || []).map((optionName) => ({
          name: optionName,
          selected: !!selectedMap[optionName]
        }))
      }))
    },

    // 新增默认头像取值：按性别返回官方默认教练头像，未选择性别时返回空
    getDefaultAvatarByGender(gender = '') {
      return DEFAULT_COACH_AVATAR[String(gender || '').trim()] || ''
    },

    // 新增默认头像识别：判断当前头像是否仍是官方默认头像（空值也算，方便切换性别时跟随替换）
    isDefaultCoachAvatar(avatarUrl = '') {
      const currentAvatarUrl = String(avatarUrl || '').trim()
      if (!currentAvatarUrl) {
        return true
      }
      return Object.keys(DEFAULT_COACH_AVATAR).some((gender) => DEFAULT_COACH_AVATAR[gender] === currentAvatarUrl)
    },

    // 新增默认昵称兜底：数据库里没有昵称时（新用户 / 老数据空值）自动填入默认昵称
    resolveNickname(rawValue) {
      const nickname = String(rawValue || '').trim()
      return nickname || DEFAULT_NICKNAME
    },

    // 新增资料表单统一回填：普通输入、多选和图片上传都走同一个 setData 收口
    applyProfileForm(nextProfileForm = {}) {
      const mergedProfileForm = Object.assign({}, this.data.profileForm, nextProfileForm)
      // 新增默认昵称兜底：库里没有昵称时自动填入「XX教练」，用户可随时改成自己的昵称
      mergedProfileForm.nickname = this.resolveNickname(mergedProfileForm.nickname)
      // 新增自定义照片识别：非官方默认头像且非空才算用户自己上传的照片
      const customAvatarUrl = this.isDefaultCoachAvatar(mergedProfileForm.avatarUrl)
        ? ''
        : String(mergedProfileForm.avatarUrl || '').trim()
      const defaultAvatarUrl = this.getDefaultAvatarByGender(mergedProfileForm.gender)
      // 新增默认头像兜底：没有自定义照片时，按当前性别自动套用对应默认头像（切换性别会跟随变化）
      mergedProfileForm.avatarUrl = customAvatarUrl || defaultAvatarUrl
      const skillSelectionList = this.parseSkillSelectionList(mergedProfileForm.skills)
      const normalizedProfileForm = Object.assign({}, mergedProfileForm, {
        skills: this.serializeSkillSelectionList(skillSelectionList)
      })

      this.setData({
        profileForm: normalizedProfileForm,
        defaultAvatarUrl,
        hasCustomAvatar: !!customAvatarUrl,
        cards: this.buildCardsWithValue(normalizedProfileForm),
        skillOptionGroups: this.buildSkillOptionGroups(skillSelectionList)
      })
    },

    // 新增恢复默认头像：清掉自定义照片，回落到当前性别的官方默认头像
    resetAvatarToDefault() {
      const nextProfileForm = Object.assign({}, this.data.profileForm, {
        avatarUrl: ''
      })
      this.applyProfileForm(nextProfileForm)
      this.syncGlobalAvatar(this.data.profileForm.avatarUrl)
      this.savePreviewDraft(this.data.profileForm)
      wx.showToast({
        title: '已恢复默认头像',
        icon: 'none'
      })
    },

    // 点击展开 / 收起
    toggleCard(e) {
      const index = e.currentTarget.dataset.index;

      this.setData({
        currentIndex: this.data.currentIndex === index ? -1 : index
      });
    },

    // 新增通用输入：基础信息和资料详情统一走一个字段更新入口
    onFieldInput(e) {
      const field = e.currentTarget.dataset.field
      let value = e.detail.value || ''
      // 新增电话输入限制：只允许数字并且最多保留 11 位大陆手机号
      if (field === 'phone') {
        value = value.replace(/\D/g, '').slice(0, 11)
      }
      const nextProfileForm = Object.assign({}, this.data.profileForm, {
        [field]: value
      })
      this.applyProfileForm(nextProfileForm)
      // 新增预览草稿联动：输入时同步缓存，避免切到预览页时漏掉最新内容
      this.savePreviewDraft(nextProfileForm)
    },

    // 新增全局头像同步：头像变化后立即写入全局与本地缓存，其它页面即时展示
    syncGlobalAvatar(avatarUrl = '') {
      const safeAvatarUrl = String(avatarUrl || '').trim()
      if (!safeAvatarUrl) {
        return
      }
      const app = getApp()
      app.globalData.avatarUrl = safeAvatarUrl
      wx.setStorageSync('avatarUrl', safeAvatarUrl)
    },

    // 新增数字资料选择：基础信息区单独收集工作经验、带过学员量级和性别
    onOptionSelect(e) {
      const field = e.currentTarget.dataset.field
      const value = e.currentTarget.dataset.value || ''
      if (!field) {
        return
      }

      const nextProfileForm = Object.assign({}, this.data.profileForm, {
        [field]: value
      })
      this.applyProfileForm(nextProfileForm)
      // 新增性别联动头像：切换性别后若头像仍是默认头像，立即同步全局头像
      if (field === 'gender' && this.isDefaultCoachAvatar(this.data.profileForm.avatarUrl)) {
        this.syncGlobalAvatar(this.data.profileForm.avatarUrl)
        this.savePreviewDraft(this.data.profileForm)
        return
      }
      // 新增预览草稿联动：选项变化时同步缓存，避免头部统计预览滞后
      this.savePreviewDraft(nextProfileForm)
    },

    // 新增图片字段更新：统一处理照片和照片佐证回填，避免到处重复 setData
    updateImageField(field, fileId) {
      const nextProfileForm = Object.assign({}, this.data.profileForm, {
        [field]: fileId || ''
      })
      this.applyProfileForm(nextProfileForm)
      // 新增预览草稿联动：图片上传后同步缓存，保证预览页能立即看到
      this.savePreviewDraft(nextProfileForm)
    },

    // 新增本地图片路径键：普通图片和多块佐证统一生成稳定 key，方便提交审核时找到原始本地图
    buildLocalImageKey(field, index = -1) {
      if (typeof index === 'number' && index >= 0) {
        return `${field}.${index}.proof`
      }
      return String(field || '').trim()
    },

    // 新增本地图片路径记录：上传原图后把当前本地路径记下来，后续审核时再压成最小图
    rememberLocalImagePath(field, filePath, index = -1) {
      const localImageKey = this.buildLocalImageKey(field, index)
      if (!localImageKey || !filePath) {
        return
      }
      this.localImagePathMap[localImageKey] = filePath
    },

    // 新增擅长领域多选：资料页支持直接点选多个方向，结果统一回写到 skills 字段
    toggleSkillOption(e) {
      const value = String(e.currentTarget.dataset.value || '').trim()
      if (!value) {
        return
      }

      const currentSelectionList = this.parseSkillSelectionList(this.data.profileForm.skills)
      const nextSelectionList = currentSelectionList.includes(value)
        ? currentSelectionList.filter((item) => item !== value)
        : currentSelectionList.concat(value)
      const nextProfileForm = Object.assign({}, this.data.profileForm, {
        skills: this.serializeSkillSelectionList(nextSelectionList)
      })

      this.applyProfileForm(nextProfileForm)
      this.savePreviewDraft(nextProfileForm)
    },

    // 新增多块资料默认项：相关证书和荣誉展示每块都由内容和佐证组成
    createDefaultMultiBlockItem() {
      return {
        content: '',
        proof: ''
      }
    },

    // 新增多块资料解析：兼容旧字符串和新数组字符串，统一转成块列表渲染
    parseMultiBlockValue(rawValue) {
      if (Array.isArray(rawValue)) {
        return rawValue.length ? rawValue : [this.createDefaultMultiBlockItem()]
      }

      const text = String(rawValue || '').trim()
      if (!text) {
        return [this.createDefaultMultiBlockItem()]
      }

      try {
        const parsedValue = JSON.parse(text)
        if (Array.isArray(parsedValue) && parsedValue.length) {
          return parsedValue.map((item) => ({
            content: typeof item.content === 'string' ? item.content : '',
            proof: typeof item.proof === 'string' ? item.proof : ''
          }))
        }
      } catch (error) {
        // 保留兼容：历史单文本数据直接塞进第一块内容里
      }

      return [{
        content: text,
        proof: ''
      }]
    },

    // 新增多块资料序列化：保存时统一压成字符串入库，减少云函数改动面
    serializeMultiBlockValue(blockList = []) {
      const normalizedBlocks = (Array.isArray(blockList) ? blockList : [])
        .map((item) => ({
          content: String((item && item.content) || '').trim(),
          proof: String((item && item.proof) || '').trim()
        }))
        .filter((item) => item.content || item.proof)

      return normalizedBlocks.length ? JSON.stringify(normalizedBlocks) : ''
    },

    // 新增多块草稿序列化：编辑态保留空块，避免点击“添加”后被立刻过滤掉
    serializeMultiBlockDraftValue(blockList = []) {
      const normalizedBlocks = (Array.isArray(blockList) ? blockList : [])
        .map((item) => ({
          content: String((item && item.content) || '').trim(),
          proof: String((item && item.proof) || '').trim()
        }))

      return normalizedBlocks.length ? JSON.stringify(normalizedBlocks) : ''
    },

    // 新增多块资料列表更新：统一回写某个卡片的块列表并同步到底层字段
    updateMultiBlockField(field, blockList = []) {
      const nextProfileForm = Object.assign({}, this.data.profileForm, {
        [field]: this.serializeMultiBlockDraftValue(blockList)
      })
      this.applyProfileForm(nextProfileForm)
      this.savePreviewDraft(nextProfileForm)
    },

    // 新增多块内容输入：每个模块支持多个内容块，单独编辑互不影响
    onMultiBlockInput(e) {
      const field = e.currentTarget.dataset.field
      const index = Number(e.currentTarget.dataset.index)
      const value = e.detail.value || ''
      const blockList = this.parseMultiBlockValue(this.data.profileForm[field])

      if (!field || Number.isNaN(index) || !blockList[index]) {
        return
      }

      blockList[index] = Object.assign({}, blockList[index], {
        content: value
      })
      this.updateMultiBlockField(field, blockList)
    },

    // 新增多块佐证回填：对应块上传完成后只更新自己的图片
    updateMultiBlockProof(field, index, fileId) {
      const blockList = this.parseMultiBlockValue(this.data.profileForm[field])
      if (!field || Number.isNaN(index) || !blockList[index]) {
        return
      }

      blockList[index] = Object.assign({}, blockList[index], {
        proof: fileId || ''
      })
      this.updateMultiBlockField(field, blockList)
    },

    // 新增多块添加：相关证书和荣誉展示支持手动追加多个块
    addMultiBlock(e) {
      const field = e.currentTarget.dataset.field
      if (!field) {
        return
      }

      const blockList = this.parseMultiBlockValue(this.data.profileForm[field])
      blockList.push(this.createDefaultMultiBlockItem())
      this.updateMultiBlockField(field, blockList)
    },

    // 新增多块删除：允许删除多余的资料块，但至少保留一个空块
    removeMultiBlock(e) {
      const field = e.currentTarget.dataset.field
      const index = Number(e.currentTarget.dataset.index)
      if (!field || Number.isNaN(index)) {
        return
      }

      let blockList = this.parseMultiBlockValue(this.data.profileForm[field]).filter((item, itemIndex) => itemIndex !== index)
      if (!blockList.length) {
        blockList = [this.createDefaultMultiBlockItem()]
      }
      this.updateMultiBlockField(field, blockList)
    },

    // 新增卡片值同步：把当前表单内容映射到展开卡片里，避免模板动态取值不稳定
    buildCardsWithValue(profileForm = {}) {
      return this.data.cards.map((item) => ({
        ...item,
        value: profileForm[item.field] || '',
        blockList: item.isMultiBlock ? this.parseMultiBlockValue(profileForm[item.field]) : [],
        proofValue: item.proofField ? (profileForm[item.proofField] || '') : '',
        // 新增条件佐证标记：教育背景填写了内容时，照片佐证才变成必传
        proofRequired: !!(item.proofField && String(profileForm[item.field] || '').trim())
      }))
    },

    // 新增资料表单标准化：提交前统一去掉首尾空格，避免看起来填了值却被后端判空
    normalizeProfileForm(profileForm = {}) {
      const nextProfileForm = {}
      Object.keys(this.data.profileForm || {}).forEach((key) => {
        const rawValue = profileForm[key]
        let nextValue = typeof rawValue === 'string' ? rawValue.trim() : ''
        if (key === 'phone') {
          // 新增联系电话标准化：保存前统一收口成 11 位纯数字，避免旧格式混入资料库
          nextValue = nextValue.replace(/\D/g, '').slice(0, 11)
        }
        if (key === 'relatedCertificates' || key === 'honorShowcase') {
          nextValue = this.serializeMultiBlockValue(this.parseMultiBlockValue(rawValue))
        }
        nextProfileForm[key] = nextValue
      })
      return nextProfileForm
    },

    // 新增多块校验：新增多个块时，每块都必须有内容和对应佐证
    validateMultiBlockField(field, title, profileForm) {
      const blockList = this.parseMultiBlockValue(profileForm[field])
        .map((item) => ({
          content: String((item && item.content) || '').trim(),
          proof: String((item && item.proof) || '').trim()
        }))
        .filter((item) => item.content || item.proof)

      for (let index = 0; index < blockList.length; index += 1) {
        const blockItem = blockList[index]
        if (!blockItem.content) {
          return `${title}第${index + 1}块请填写内容`
        }
        if (!blockItem.proof) {
          return `${title}第${index + 1}块请上传佐证`
        }
      }

      return ''
    },

    // 新增电话格式校验：当前资料页要求联系电话必须是中国大陆 11 位手机号
    isValidPhone(phone) {
      return /^1[3-9]\d{9}$/.test(phone || '')
    },

    // 新增用户上传目录：每个用户固定落到自己的云存储文件夹下
    getUserUploadFolder() {
      const app = getApp()
      const userKey = app.globalData.token || app.globalData.openid || wx.getStorageSync('token') || wx.getStorageSync('openid') || 'guest_user'
      return `NEWDL/users/${userKey}`
    },

    // 新增审核图下载源：优先复用当前会话的本地图，没有时再从云存储把原图下载回来做最小压缩
    async resolveReviewSourceFilePath(fileID, localImageKey = '') {
      const localFilePath = localImageKey ? this.localImagePathMap[localImageKey] : ''
      if (localFilePath) {
        return localFilePath
      }

      const safeFileId = String(fileID || '').trim()
      if (!safeFileId) {
        return ''
      }

      const downloadRes = await wx.cloud.downloadFile({
        fileID: safeFileId
      })
      return String((downloadRes && downloadRes.tempFilePath) || '').trim()
    },

    // 新增审核图上传：保存原图后，提交审核时单独压成最小图并上传到 review 目录，只给审核使用
    async uploadReviewImage(field, originalFileId, localImageKey = '') {
      const safeOriginalFileId = String(originalFileId || '').trim()
      if (!safeOriginalFileId) {
        return ''
      }

      const reviewSourceFilePath = await this.resolveReviewSourceFilePath(safeOriginalFileId, localImageKey)
      if (!reviewSourceFilePath) {
        return safeOriginalFileId
      }

      const preparedReviewImage = await prepareImageForUpload(reviewSourceFilePath, {
        maxBytes: 80 * 1024,
        qualityList: [20, 10, 5]
      })
      const userFolder = this.getUserUploadFolder()
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: `${userFolder}/_security_review/${field}/${Date.now()}-${Math.floor(Math.random() * 10000)}.jpg`,
        filePath: preparedReviewImage.filePath || reviewSourceFilePath
      })
      return String((uploadRes && uploadRes.fileID) || safeOriginalFileId).trim()
    },

    // 新增审核资料构建：提交审核时单独组装一份“最小审核图”资料，不影响数据库里保存的原图
    async buildReviewProfile(profileForm = {}) {
      const reviewProfile = Object.assign({}, profileForm)

      // 新增默认头像免压缩：官方默认教练头像无需重复下载压缩送审，直接沿用原 fileID
      reviewProfile.avatarUrl = this.isDefaultCoachAvatar(profileForm.avatarUrl)
        ? String(profileForm.avatarUrl || '').trim()
        : await this.uploadReviewImage('avatarUrl', profileForm.avatarUrl, this.buildLocalImageKey('avatarUrl'))
      reviewProfile.basicPhotoProof = await this.uploadReviewImage('basicPhotoProof', profileForm.basicPhotoProof, this.buildLocalImageKey('basicPhotoProof'))
      reviewProfile.educationPhotoProof = await this.uploadReviewImage('educationPhotoProof', profileForm.educationPhotoProof, this.buildLocalImageKey('educationPhotoProof'))

      const relatedCertificatesList = this.parseMultiBlockValue(profileForm.relatedCertificates)
      if (relatedCertificatesList.length) {
        const nextRelatedCertificatesList = []
        for (let index = 0; index < relatedCertificatesList.length; index += 1) {
          const blockItem = relatedCertificatesList[index]
          nextRelatedCertificatesList.push({
            content: String((blockItem && blockItem.content) || '').trim(),
            proof: await this.uploadReviewImage(
              'relatedCertificates',
              blockItem && blockItem.proof,
              this.buildLocalImageKey('relatedCertificates', index)
            )
          })
        }
        reviewProfile.relatedCertificates = this.serializeMultiBlockValue(nextRelatedCertificatesList)
      }

      const honorShowcaseList = this.parseMultiBlockValue(profileForm.honorShowcase)
      if (honorShowcaseList.length) {
        const nextHonorShowcaseList = []
        for (let index = 0; index < honorShowcaseList.length; index += 1) {
          const blockItem = honorShowcaseList[index]
          nextHonorShowcaseList.push({
            content: String((blockItem && blockItem.content) || '').trim(),
            proof: await this.uploadReviewImage(
              'honorShowcase',
              blockItem && blockItem.proof,
              this.buildLocalImageKey('honorShowcase', index)
            )
          })
        }
        reviewProfile.honorShowcase = this.serializeMultiBlockValue(nextHonorShowcaseList)
      }

      return reviewProfile
    },

    // 新增资料图片上传：按字段选择一张图片并上传到云存储
    chooseAndUploadImage(e) {
      const field = e.currentTarget.dataset.field
      const cardField = e.currentTarget.dataset.cardField
      const blockIndex = Number(e.currentTarget.dataset.index)
      if (!field || this.data.isUploadingImage) {
        return
      }

      wx.chooseImage({
        count: 1,
        sizeType: ['original'],
        success: async (res) => {
          const filePath = res.tempFilePaths && res.tempFilePaths[0]
          if (!filePath) {
            return
          }

          this.setData({
            isUploadingImage: true
          })
          wx.showLoading({
            title: '上传中...'
          })

          try {
            const userFolder = this.getUserUploadFolder()
            // 新增资料图片云存储：不同字段分目录保存，后续展示直接复用 fileID
            const uploadRes = await wx.cloud.uploadFile({
              cloudPath: `${userFolder}/${field}/${Date.now()}-${Math.floor(Math.random() * 10000)}.jpg`,
              filePath
            })

            if (cardField && !Number.isNaN(blockIndex)) {
              this.rememberLocalImagePath(cardField, filePath, blockIndex)
              this.updateMultiBlockProof(cardField, blockIndex, uploadRes.fileID || '')
              wx.showToast({
                title: '上传成功',
                icon: 'success'
              })
              return
            }

            this.rememberLocalImagePath(field, filePath)
            this.updateImageField(field, uploadRes.fileID || '')
            if (field === 'avatarUrl') {
              const app = getApp()
              app.globalData.avatarUrl = uploadRes.fileID || app.globalData.avatarUrl || ''
              wx.setStorageSync('avatarUrl', app.globalData.avatarUrl || '')
            }

            wx.showToast({
              title: field === 'avatarUrl' ? '已上传，保存时会自动检测' : '上传成功',
              icon: 'success'
            })
          } catch (error) {
            wx.showToast({
              title: '上传失败',
              icon: 'none'
            })
          } finally {
            this.setData({
              isUploadingImage: false
            })
            wx.hideLoading()
          }
        }
      })
    },

    // 新增资料加载：进入页面时读取当前用户自己的资料
    loadProfile() {
      wx.showLoading({
        title: '加载中...'
      })
      wx.cloud.callFunction({
        name: 'NEWDL_mine_user',
        data: {
          action: 'getProfile',
          envVersion: getApp().globalData.miniEnvVersion || 'develop'
        },
        success: (res) => {
          const result = res && res.result
          if (result && result.status === 'success' && result.profile) {
            const nextProfileForm = Object.assign({}, this.data.profileForm, result.profile)
            const app = getApp()
            if (nextProfileForm.avatarUrl) {
              app.globalData.avatarUrl = nextProfileForm.avatarUrl
              wx.setStorageSync('avatarUrl', nextProfileForm.avatarUrl)
            }
            this.applyProfileForm(nextProfileForm)
            this.setData({
              securityReview: result.securityReview || this.data.securityReview
            })
            // 新增组件事件：资料加载完成后通知宿主页面（宿主可不监听，不影响组件自身逻辑）
            this.triggerEvent('loaded', { profile: nextProfileForm })
          } else {
            wx.showToast({
              title: '资料加载失败',
              icon: 'none'
            })
          }
        },
        fail: () => {
          wx.showToast({
            title: '资料加载失败',
            icon: 'none'
          })
        },
        complete: () => {
          wx.hideLoading()
        }
      })
    },

    // 新增资料后台审核触发：保存成功后单独发起审核请求，不阻塞当前编辑和返回操作
    async triggerProfileSecurityReview(profileForm = {}) {
      try {
        const reviewProfile = await this.buildReviewProfile(profileForm)
        wx.cloud.callFunction({
          name: 'NEWDL_mine_user',
          data: {
            action: 'submitProfileSecurityReview',
            reviewProfile,
            envVersion: getApp().globalData.miniEnvVersion || 'develop'
          },
          success: (res) => {
            const result = res && res.result
            if (result && result.status === 'success' && result.review) {
              this.setData({
                securityReview: result.review
              })
            }
          },
          fail: (error) => {
            console.warn('资料后台审核触发失败', error)
          }
        })
      } catch (error) {
        console.warn('构建审核专用最小图片失败', error)
      }
    },

    // 新增资料保存：提交当前页面编辑内容并入库到 users 集合
    saveProfile() {
      if (this.data.isSaving) {
        return
      }

      const profileForm = this.normalizeProfileForm(this.data.profileForm || {})
      if (!profileForm.nickname) {
        wx.showToast({
          title: '请填写昵称',
          icon: 'none'
        })
        return
      }

      if (!this.isValidPhone(profileForm.phone)) {
        wx.showToast({
          title: '请填写正确的11位手机号',
          icon: 'none'
        })
        return
      }

      // 新增条件佐证校验：教育背景填写后必须同步上传照片佐证；未填写则不要求
      if (profileForm.education && !profileForm.educationPhotoProof) {
        wx.showToast({
          title: '填写教育背景后请上传照片佐证',
          icon: 'none'
        })
        return
      }

      const relatedCertificatesError = this.validateMultiBlockField('relatedCertificates', '相关证书', profileForm)
      if (relatedCertificatesError) {
        wx.showToast({
          title: relatedCertificatesError,
          icon: 'none'
        })
        return
      }

      const honorShowcaseError = this.validateMultiBlockField('honorShowcase', '荣誉展示', profileForm)
      if (honorShowcaseError) {
        wx.showToast({
          title: honorShowcaseError,
          icon: 'none'
        })
        return
      }

      this.setData({
        isSaving: true
      })

      wx.showLoading({
        title: '保存中...'
      })

      wx.cloud.callFunction({
        name: 'NEWDL_mine_user',
        data: {
          action: 'updateProfile',
          profile: profileForm,
          envVersion: getApp().globalData.miniEnvVersion || 'develop'
        },
        success: (res) => {
          const result = res && res.result
          if (result && result.status === 'success') {
            const app = getApp()
            const latestProfile = result.profile || profileForm
            if (app.saveUserIdentity) {
              app.saveUserIdentity({
                nickname: latestProfile.nickname || app.globalData.nickname,
                avatarUrl: latestProfile.avatarUrl || app.globalData.avatarUrl || '',
                userRole: 'C',
                needChooseRole: false
              })
            } else {
              app.globalData.nickname = latestProfile.nickname || app.globalData.nickname
              app.globalData.avatarUrl = latestProfile.avatarUrl || app.globalData.avatarUrl || ''
              app.globalData.userRole = 'C'
              wx.setStorageSync('nickname', app.globalData.nickname || '')
              wx.setStorageSync('avatarUrl', app.globalData.avatarUrl || '')
              wx.setStorageSync('userRole', 'C')
            }

            this.applyProfileForm(Object.assign({}, this.data.profileForm, latestProfile))
            this.setData({
              securityReview: result.securityReview || {
                status: 'pending',
                reason: '',
                message: '资料已保存，图片正在后台检测',
                checkType: '',
                failedTextIndex: -1,
                failedImageIndex: -1
              }
            })
            // 新增先保存后审核：资料入库成功后再异步发起审核，不占用用户当前保存操作时间
            this.triggerProfileSecurityReview(profileForm)

            // 新增组件事件：资料保存成功后通知宿主页面（宿主可不监听，不影响组件自身逻辑）
            this.triggerEvent('submitted', { profile: latestProfile })

            wx.showToast({
              title: '成功保存',
              icon: 'success'
            })
            return
          }

          wx.showToast({
            title: ((result && result.message) === '您发布的内容含违规信息' ? '您发布的内容含违规信息' : ((result && result.message) || '保存失败')),
            icon: 'none'
          })
        },
        fail: () => {
          // 新增组件事件：保存请求失败时通知宿主页面（宿主可不监听）
          this.triggerEvent('error', { stage: 'save' })
          wx.showToast({
            title: '保存失败',
            icon: 'none'
          })
        },
        complete: () => {
          this.setData({
            isSaving: false
          })
          wx.hideLoading()
        }
      })
    },

    // 新增资料预览跳转：在编辑页底部直接进入资料编辑预览页
    goToProfilePreview() {
      // 新增预览联动：先缓存当前表单，预览页优先展示刚填写但尚未保存的内容
      this.savePreviewDraft()
      wx.navigateTo({
        url: '/pages/profile/edit/edit'
      })
    },

    // 新增图片预览：点击已上传的照片时直接放大查看
    previewImage(e) {
      const url = e.currentTarget.dataset.url
      if (!url) {
        return
      }

      wx.previewImage({
        current: url,
        urls: [url]
      })
    },

    // 新增预览草稿缓存键：资料编辑页和预览页通过同一个临时存储传递未保存内容
    getPreviewDraftStorageKey() {
      return 'NEWDL_profile_preview_draft'
    },

    // 新增预览草稿缓存：点击预览时先把当前表单带过去，避免未保存昵称在预览页丢失
    savePreviewDraft(profileForm) {
      try {
        const draftProfile = this.normalizeProfileForm(profileForm || this.data.profileForm || {})
        wx.setStorageSync(this.getPreviewDraftStorageKey(), draftProfile)
      } catch (error) {
        console.warn('保存资料预览草稿失败', error)
      }
    }
  }
})
