// ============================================================
// 业务积木：表单提交 - publish_classcreate 模块（创建班课程 tab）
// 所属页面：pages/task/publish/publish
// 说明：原 publish 页面 selectedTab === 'create' 分支整体迁移为本组件。
//       所有事件方法位于 methods 内，组件 attached / order 变化时自动回填表单。
// 拆分说明（2026-09-20）：publish 页面按表单提交职责拆为 classcreate / dailysummary / classoff 三个组件，
//       本组件对应【创建班课程】tab。
// ============================================================

const app = getApp();
const { BIZ_ROLE_ORG_ADMIN } = require('../../../utils/bizRole');
const DEFAULT_CLASS_LESSON_COUNT = 10;
// 协作码衍生课用的 bridge_status 常量
const BRIDGE_STATUS_LINKED_BY_COLLAB = 'linked_by_collaboration_code';

Component({
  // 组件外部入参：由宿主页面 publish 下发
  properties: {
    order: { type: Object, value: {} },
    orderId: { type: String, value: '' },
    isEditMode: { type: Boolean, value: false },
    canEditCourseInfo: { type: Boolean, value: true },
    canDeleteCourse: { type: Boolean, value: true },
    canAdjustLessonPlan: { type: Boolean, value: false },
    lessonPlanLocked: { type: Boolean, value: false },
    hasGeneratedPickupCode: { type: Boolean, value: false },
    confirmPublishLoading: { type: Boolean, value: false },
    // 协作码导入后的表单数据（由宿主页面 applyCollaborativeOrderToForm 构建下发），
    // 组件 observer 会把这些字段合并到内部 form，实现协作信息回填
    collaborationFormData: { type: Object, value: null },
    // 协作码导入后的追踪字段（由宿主页面从 applyCollaborativeOrderToForm 同步）
    collaborationTrace: {
      type: Object,
      value: {
        collaborationCode: '',
        collaborationMatchedOrderId: '',
        collaborationOriginalFromBCourseId: '',
        collaborationOriginalFromBFormId: '',
        collaborationOriginalFromBOpenid: '',
        collaborationOriginalSource: '',
        collaborationOriginalBridgeStatus: '',
        collaborationOriginalParentCourseCode: '',
        collaborationOriginalMatchedCourseCode: ''
      }
    }
  },

  data: {
    form: {
      title: '',
      sub_plan_name: '',
      course_plan: '',
      frequency: '',
      category: '',
      description: '',
      price_interval: '',
      location: '',
      group_rules: '',
      contact: '',
      course_size_mode: '1对1',
      safety_confirmed: false,
      child_profiles: [],
      coach_private_note: '',
      allow_transfer_to_other_coach: false
    },
    showCover: false,
    priceOptions: ['不同地区不同', '100-130', '130-160', '160-190', '190-220', '220-250', '250以上'],
    currentClassId: null,
    selectedSubName: null,
    currentClass: null,
    isSubmitting: false,
    // 课程类型预设
    classTypes: [
      {
        id: 'posture', name: '体态矫正',
        brief: '专门针对青少年中常见的圆肩、驼背、X/O型腿等问题设计的专项训练。',
        defaultLessons: DEFAULT_CLASS_LESSON_COUNT, images: [],
        planText: '课程分为前期、中期、后期三个阶段推进：前期进行体态评估与基础动作学习，中期重点训练肩颈、脊柱、下肢的稳定与拉伸，后期形成家庭可执行的体态改善方案并跟踪效果。',
        subItems: ['圆肩驼背改善', '脊柱侧弯预防', 'X/O 型腿调整'],
        subPlans: {
          '圆肩驼背改善': '本子计划聚焦于现代青少年因久坐、低头使用电子设备导致的圆肩驼背问题。通过胸椎伸展、肩胛激活及颈部放松训练，帮助打开上背部、恢复自然肩颈曲线。',
          '脊柱侧弯预防': '针对脊柱发育关键期可能出现的轻度功能性侧弯，本计划强调早期筛查与干预。',
          'X/O 型腿调整': 'X型腿或O型腿多与髋关节稳定性不足、足弓塌陷或走路姿势异常相关。'
        }
      },
      {
        id: 'elite', name: '专业追高',
        brief: '提高专项成绩，适合有一定基础、想要突破的孩子',
        defaultLessons: DEFAULT_CLASS_LESSON_COUNT, images: [],
        planText: '课程分为前期、中期、后期三个阶段推进：前期基础体能与动作技术复盘，中期进行专项速度、力量、灵敏等强化训练，后期侧重专项测试与比赛模拟。',
        subItems: ['基础能力巩固', '专项成绩突破', '考级与比赛冲刺'],
        subPlans: {
          '基础能力巩固': '本子计划旨在为高水平专项训练筑牢体能根基。',
          '专项成绩突破': '本计划以精准诊断为核心，通过阶段性测试识别技术瓶颈与体能短板。',
          '考级与比赛冲刺': '本计划紧密对标体育特长生考级、校队选拔或市级赛事评分标准。'
        }
      },
      {
        id: 'track', name: '田径专项',
        brief: '短跑、中长跑、跑跳投综合训练',
        defaultLessons: DEFAULT_CLASS_LESSON_COUNT, images: [],
        planText: '课程分为前期、中期、后期三个阶段推进：前期学习跑姿、起跑与节奏控制，中期分模块训练短跑速度、中长跑耐力和跑跳投基础技术。',
        subItems: ['短跑爆发力', '中长跑耐力', '跑跳投综合训练'],
        subPlans: {
          '短跑爆发力': '本计划聚焦短距离项目的核心能力——瞬间加速与高速维持。',
          '中长跑耐力': '本计划面向中长距离项目，强调有氧能力与节奏感的协同发展。',
          '跑跳投综合训练': '在稳固基本跑姿基础上，拓展田径基础技能模块。'
        }
      },
      {
        id: 'exam', name: '中考体育',
        brief: '围绕中考项目进行系统训练与模拟测试',
        defaultLessons: DEFAULT_CLASS_LESSON_COUNT, images: [],
        planText: '课程分为前期、中期、后期三个阶段推进：针对中考各项进行专项拆解练习。',
        subItems: ['长跑专项', '跳绳专项', '实心球专项'],
        subPlans: {
          '长跑专项': '本计划围绕中考长跑项目，系统提升有氧耐力与跑步经济性。',
          '跳绳专项': '本计划面向跳绳专项，强调耐力与节奏感的协同发展。',
          '实心球专项': '本计划聚焦实心球投掷的技术链条优化。'
        }
      },
      {
        id: 'kids_fitness', name: '少儿体能班',
        brief: '提升整体体能与协调性，增强自信心',
        defaultLessons: DEFAULT_CLASS_LESSON_COUNT, images: [],
        planText: '以游戏化形式提升孩子的跑、跳、爬、钻、平衡等基础体能。',
        subItems: ['基础体能', '协调性训练', '平衡能力'],
        subPlans: {
          '基础体能': '通过趣味障碍跑、动物模仿爬行、追逐游戏等形式，全面提升儿童的力量、速度、耐力与灵活性。',
          '协调性训练': '借助多方向变向跑、手脚配合钻爬、节奏踏步等游戏化任务。',
          '平衡能力': '利用平衡木、软垫、单脚站立挑战等器材与情境，训练静态与动态平衡控制。'
        }
      },
      {
        id: 'rope', name: '跳绳班',
        brief: '跳绳基础与花样技巧训练，兼顾兴趣与考试',
        defaultLessons: DEFAULT_CLASS_LESSON_COUNT, images: [],
        planText: '从单摇、双摇等基础节奏入手，逐步加入交叉跳、花样跳等技巧训练。',
        subItems: ['基础跳绳', '速度跳绳', '花样跳绳'],
        subPlans: {
          '基础跳绳': '从正确握绳、手腕摇动、双脚轻跳等基本要素入手，建立规范的单摇节奏。',
          '速度跳绳': '借助多方向变向跑、手脚配合钻爬、节奏踏步等游戏化任务。',
          '花样跳绳': '引入交叉跳、开合跳、弓步跳、双摇等基础花样动作。'
        }
      },
      {
        id: 'ball', name: '球类专项班',
        brief: '乒乓球、羽毛球、篮球、足球等专项兴趣培养',
        defaultLessons: DEFAULT_CLASS_LESSON_COUNT, images: [],
        planText: '根据孩子选择的球类项目，从基本握拍、运球、传接球等动作教起。',
        subItems: ['乒乓球', '羽毛球', '篮球', '足球'],
        subPlans: {
          '乒乓球': '从握拍方式、基本站位、正反手推挡与攻球教起。',
          '羽毛球': '重点训练握拍转换、高远球挥拍轨迹、步法移动。',
          '篮球': '从持球姿势、原地运球、传接球准确性开始。',
          '足球': '围绕脚内侧传球、停球、带球变向、射门等核心技能展开训练。'
        }
      }
    ]
  },

  // 监听 order 变化：编辑态回填表单；监听 collaborationFormData：协作导入回填表单
  observers: {
    'order': function (order) {
      if (order && order._id) {
        this.applyOrderToForm(order);
      }
    },
    // 协作码导入后，宿主页面把导入的表单字段通过 collaborationFormData 下发，
    // 组件把这些字段合并进内部 form（覆盖原 applyCollaborativeOrderToForm 直接写 this.data.form 的逻辑）
    'collaborationFormData': function (collabForm) {
      if (!collabForm) return;
      const currentForm = this.data.form || {};
      const nextChildProfiles = this.normalizeChildProfiles(
        Array.isArray(collabForm.child_profiles) ? collabForm.child_profiles : []
      );
      this.setData({
        form: {
          ...currentForm,
          title: String(collabForm.title || currentForm.title || '').trim(),
          sub_plan_name: String(collabForm.sub_plan_name || '').trim(),
          course_plan: String(collabForm.course_plan || currentForm.course_plan || '').trim(),
          frequency: String(collabForm.frequency || currentForm.frequency || '').trim(),
          category: String(collabForm.category || currentForm.category || '').trim(),
          description: String(collabForm.description || currentForm.description || '').trim(),
          location: String(collabForm.location || currentForm.location || '').trim(),
          contact: String(collabForm.contact || currentForm.contact || '').trim(),
          course_size_mode: String(collabForm.course_size_mode || currentForm.course_size_mode || '1对1').trim() || '1对1',
          child_profiles: nextChildProfiles,
          latitude: collabForm.latitude !== undefined ? collabForm.latitude : currentForm.latitude,
          longitude: collabForm.longitude !== undefined ? collabForm.longitude : currentForm.longitude,
          coach_private_note: String(currentForm.coach_private_note || '').trim(),
          price_interval: String(currentForm.price_interval || '').trim(),
          allow_transfer_to_other_coach: !!currentForm.allow_transfer_to_other_coach
        },
        currentClassId: null,
        currentClass: null,
        selectedSubName: null
      });
    }
  },

  methods: {
    // 新增多孩子数据收口
    normalizeChildProfiles(childProfiles = []) {
      const safeList = Array.isArray(childProfiles) ? childProfiles : [];
      const normalizedList = safeList.map(item => ({
        nickname: String((item || {}).nickname || '').trim(),
        age: String((item || {}).age || '').trim(),
        gender: String((item || {}).gender || '').trim(),
        height: String((item || {}).height || '').trim(),
        weight: String((item || {}).weight || '').trim()
      }));
      return normalizedList.filter(item =>
        item.nickname || item.age || item.gender || item.height || item.weight
      );
    },

    applyOrderToForm(order) {
      const courseTarget = order.course_target || {};
      const courseBasic = order.course_basic || {};
      const childProfile = order.child_profile || {};
      const coachPrivate = order.coach_private || {};
      const categoryName = courseTarget.category || order.category || '';
      const savedSubPlanName = courseTarget.sub_plan_name || order.sub_plan_name || '';
      const matchedClass = this.data.classTypes.find(item => item.name === categoryName) || null;
      const childProfiles = this.normalizeChildProfiles(
        (Array.isArray(order.child_profiles) && order.child_profiles.length)
          ? order.child_profiles
          : [{
              nickname: childProfile.nickname || order.child_nickname || '',
              age: childProfile.age || order.child_age || '',
              gender: childProfile.gender || order.child_gender || '',
              height: childProfile.height || order.child_height || '',
              weight: childProfile.weight || order.child_weight || ''
            }]
      );

      this.setData({
        form: {
          ...this.data.form,
          title: courseTarget.title || order.title || '',
          sub_plan_name: savedSubPlanName,
          course_plan: courseTarget.course_plan || order.course_plan || (matchedClass ? matchedClass.planText : ''),
          frequency: courseBasic.frequency || order.frequency || '',
          category: categoryName,
          description: courseTarget.description || order.description || '',
          price_interval: coachPrivate.price_interval || order.price_interval || '',
          location: courseBasic.location || order.location || '',
          contact: courseBasic.contact || order.contact || '',
          course_size_mode: courseBasic.course_size_mode || order.course_size_mode || '1对1',
          safety_confirmed: courseBasic.safety_confirmed !== undefined ? !!courseBasic.safety_confirmed : !!order.safety_confirmed,
          child_profiles: childProfiles,
          coach_private_note: '',
          allow_transfer_to_other_coach: coachPrivate.allow_transfer_to_other_coach !== undefined ? !!coachPrivate.allow_transfer_to_other_coach : !!order.allow_transfer_to_other_coach,
          latitude: order.latitude,
          longitude: order.longitude
        },
        currentClassId: matchedClass ? matchedClass.id : null,
        currentClass: matchedClass,
        selectedSubName: savedSubPlanName || null
      });
    },

    buildAutoCourseTitle(className = '', subPlanName = '') {
      const baseName = String(subPlanName || className || '').trim();
      return baseName ? `${baseName}课程` : '';
    },

    buildGroupedSubmitForm(rawForm) {
      const childProfiles = this.normalizeChildProfiles(rawForm.child_profiles);
      const firstChildProfile = childProfiles[0] || { nickname: '', age: '', gender: '', height: '', weight: '' };
      return {
        course_target: {
          category: rawForm.category || '',
          title: rawForm.title || '',
          sub_plan_name: rawForm.sub_plan_name || '',
          description: rawForm.description || '',
          course_plan: rawForm.course_plan || ''
        },
        course_basic: {
          course_size_mode: rawForm.course_size_mode || '1对1',
          frequency: rawForm.frequency || '',
          location: rawForm.location || '',
          contact: rawForm.contact || '',
          safety_confirmed: !!rawForm.safety_confirmed
        },
        child_profile: {
          nickname: firstChildProfile.nickname || '',
          age: firstChildProfile.age || '',
          gender: firstChildProfile.gender || '',
          height: firstChildProfile.height || '',
          weight: firstChildProfile.weight || ''
        },
        child_profiles: childProfiles,
        coach_private: {
          price_interval: rawForm.price_interval || '',
          coach_private_note: rawForm.coach_private_note || '',
          allow_transfer_to_other_coach: !!rawForm.allow_transfer_to_other_coach
        }
      };
    },

    // 新增课程机构归属构建
    buildOrderOrganizationInfo() {
      const order = this.data.order || {};
      const existingOrderOrgInfo = order.order_org_info || {};
      const businessIdentity = app.getBusinessIdentity ? app.getBusinessIdentity() : null;
      const organizationProfile = (businessIdentity && businessIdentity.organizationProfile) || {};
      const bizRole = String((businessIdentity && businessIdentity.bizRole) || '').trim();
      const orgId = String(
        existingOrderOrgInfo.orgId || order.orgId || organizationProfile.orgId || ''
      ).trim();
      if (!orgId) return {};
      return {
        orgId,
        orgName: String(existingOrderOrgInfo.orgName || order.orgName || organizationProfile.orgName || '').trim(),
        memberRole: String(existingOrderOrgInfo.memberRole || order.orgMemberRole || organizationProfile.memberRole || (bizRole === 'org_admin' ? 'admin' : '')).trim(),
        inviteCode: String(existingOrderOrgInfo.inviteCode || organizationProfile.inviteCode || '').trim()
      };
    },

    chooseLocation() {
      if (!this.data.canEditCourseInfo) {
        wx.showToast({ title: '课程资料已锁定，不可修改。', icon: 'none' });
        return;
      }
      this.setData({ showCover: true });
      wx.chooseLocation({
        success: (res) => {
          this.setData({
            'form.location': res.name || res.address,
            'form.latitude': res.latitude,
            'form.longitude': res.longitude
          });
        },
        fail: (err) => {
          console.log('fail', err);
          wx.showToast({ title: '无法获取位置权限', icon: 'none' });
        },
        complete: () => {
          this.setData({ showCover: false });
        }
      });
    },

    onPricePresetChange(e) {
      if (!this.data.canEditCourseInfo) {
        wx.showToast({ title: '课程资料已锁定，不可修改。', icon: 'none' });
        return;
      }
      this.setData({ 'form.price_interval': this.data.priceOptions[e.detail.value] });
    },

    onSelectClass(e) {
      if (!this.data.canEditCourseInfo) {
        wx.showToast({ title: '课程资料已锁定，不可修改。', icon: 'none' });
        return;
      }
      const id = e.currentTarget.dataset.id;
      if (id === this.data.currentClassId) return;
      const cls = this.data.classTypes.find(c => c.id === id);
      this.setData({
        currentClassId: id,
        currentClass: cls,
        selectedSubName: null
      });
      this.setData({
        'form.category': cls.name,
        'form.title': this.buildAutoCourseTitle(cls.name, ''),
        'form.sub_plan_name': '',
        'form.description': `我想学习${cls.name}，${cls.brief}。`,
        'form.course_plan': cls.planText || ''
      });
    },

    onSelectSubItem(e) {
      if (!this.data.canEditCourseInfo) {
        wx.showToast({ title: '课程资料已锁定，不可修改。', icon: 'none' });
        return;
      }
      const { parentId, name } = e.currentTarget.dataset;
      const targetClass = this.data.classTypes.find(item => item.id === parentId);
      this.setData({
        currentClassId: parentId,
        currentClass: targetClass,
        selectedSubName: name
      });
      this.setData({
        'form.category': targetClass.name,
        'form.title': this.buildAutoCourseTitle(targetClass.name, name),
        'form.sub_plan_name': name,
        'form.description': `我想学习${targetClass.name}，专项练习：${name}。`,
        'form.course_plan': (targetClass.subPlans && targetClass.subPlans[name]) || targetClass.planText || ''
      });
    },

    onInput(e) {
      if (!this.data.canEditCourseInfo) return;
      const field = e.currentTarget.dataset.field;
      let value = e.detail.value;
      if (field === 'contact') {
        value = String(value || '').replace(/\D/g, '').slice(0, 11);
      }
      this.setData({ [`form.${field}`]: value });
    },

    onChildProfileInput(e) {
      if (!this.data.canEditCourseInfo) return;
      const index = Number(e.currentTarget.dataset.index || 0);
      const field = String(e.currentTarget.dataset.field || '').trim();
      if (!field) return;
      const childProfiles = this.normalizeChildProfiles(this.data.form.child_profiles);
      let value = String((e.detail || {}).value || '');
      if (field === 'age') {
        value = value.replace(/\D/g, '');
      }
      childProfiles[index] = {
        ...(childProfiles[index] || { nickname: '', age: '', gender: '', height: '', weight: '' }),
        [field]: value
      };
      this.setData({ 'form.child_profiles': childProfiles });
    },

    isValidPhone(value) {
      return /^1[3-9]\d{9}$/.test(String(value || '').trim());
    },

    onPrivateTransferChange(e) {
      this.setData({ 'form.allow_transfer_to_other_coach': !!e.detail.value });
    },

    onSafetyConfirmedChange(e) {
      this.setData({ 'form.safety_confirmed': !!e.detail.value });
    },

    onCourseSizeModeChange(e) {
      if (!this.data.canEditCourseInfo) {
        wx.showToast({ title: '课程资料已锁定，不可修改。', icon: 'none' });
        return;
      }
      this.setData({ 'form.course_size_mode': e.detail.value || '1对1' });
    },

    onChildGenderChange(e) {
      if (!this.data.canEditCourseInfo) {
        wx.showToast({ title: '课程资料已锁定，不可修改。', icon: 'none' });
        return;
      }
      const index = Number(e.currentTarget.dataset.index || 0);
      const childProfiles = this.normalizeChildProfiles(this.data.form.child_profiles);
      childProfiles[index] = {
        ...(childProfiles[index] || { nickname: '', age: '', gender: '', height: '', weight: '' }),
        gender: e.detail.value || ''
      };
      this.setData({ 'form.child_profiles': childProfiles });
    },

    addChildProfile() {
      if (!this.data.canEditCourseInfo) {
        wx.showToast({ title: '课程资料已锁定，不可修改。', icon: 'none' });
        return;
      }
      const childProfiles = this.normalizeChildProfiles(this.data.form.child_profiles);
      childProfiles.push({ nickname: '', age: '', gender: '', height: '', weight: '' });
      this.setData({ 'form.child_profiles': childProfiles });
    },

    removeChildProfile(e) {
      if (!this.data.canEditCourseInfo) {
        wx.showToast({ title: '课程资料已锁定，不可修改。', icon: 'none' });
        return;
      }
      const index = Number(e.currentTarget.dataset.index || 0);
      const childProfiles = this.normalizeChildProfiles(this.data.form.child_profiles);
      if (childProfiles.length <= 1) {
        this.setData({ 'form.child_profiles': [] });
        return;
      }
      childProfiles.splice(index, 1);
      this.setData({ 'form.child_profiles': childProfiles });
    },

    // 课节管理弹窗：通知宿主页面打开对应弹窗（弹窗 UI 保留在父页面流转 tab）
    openSetTotalModal() {
      this.triggerEvent('open-set-total-modal');
    },

    openSyncModal() {
      this.triggerEvent('open-sync-modal');
    },

    // 「完成创建，允许接单」
    onConfirmPublishReady() {
      if (this.data.confirmPublishLoading) return;
      if (this.data.hasGeneratedPickupCode) {
        wx.showToast({ title: '接取码已生成，无需重复操作', icon: 'none' });
        return;
      }
      const orderId = this.data.orderId;
      if (!orderId) {
        wx.showToast({ title: '课程尚未创建', icon: 'none' });
        return;
      }
      const token = wx.getStorageSync('token');
      const runtimeEnvVersion = app.globalData.miniEnvVersion || 'develop';
      this.triggerEvent('confirm-publish-loading', { loading: true });
      wx.showLoading({ title: '生成接取码中...' });
      wx.cloud.callFunction({
        name: getApp().getFnName('NEWDL_execution_order'),
        data: {
          action: 'confirm_generate_pickup_code',
          orderId,
          userId: token,
          envVersion: runtimeEnvVersion
        },
        success: (res) => {
          wx.hideLoading();
          const result = res.result || {};
          if (result.code === 0) {
            wx.showToast({ title: '接取码已生成，课程已发布', icon: 'success' });
            this.triggerEvent('confirm-publish-loading', { loading: false });
            // 通知宿主页面重新拉取订单详情
            this.triggerEvent('publish-ready', { orderId });
          } else {
            this.triggerEvent('confirm-publish-loading', { loading: false });
            wx.showToast({ title: result.msg || '生成接取码失败', icon: 'none' });
          }
        },
        fail: (err) => {
          wx.hideLoading();
          this.triggerEvent('confirm-publish-loading', { loading: false });
          console.error('[publish_classcreate] [onConfirmPublishReady] 云函数调用失败', err);
          wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' });
        }
      });
    },

    handleDeleteCourse() {
      if (!this.data.canDeleteCourse) {
        wx.showToast({ title: '仅创建者在「待编辑」且未确认接单前可删课。', icon: 'none' });
        return;
      }
      if (!this.data.orderId) {
        this.setData({
          form: {
            title: '', sub_plan_name: '', frequency: '', category: '', description: '',
            price_interval: '', location: '', group_rules: '', contact: '',
            course_size_mode: '1对1', safety_confirmed: false, course_plan: '',
            child_profiles: [], coach_private_note: '', allow_transfer_to_other_coach: false
          },
          currentClassId: null,
          selectedSubName: null,
          currentClass: null
        });
        return;
      }
      wx.showModal({
        title: '删除课程',
        content: '确认删除当前课程吗？',
        success: async (res) => {
          if (res.confirm) {
            wx.showLoading({ title: '正在删除...' });
            try {
              const token = wx.getStorageSync('token');
              const result = await wx.cloud.callFunction({
                name: getApp().getFnName('NEWDL_execution_order'),
                data: {
                  action: 'cancel',
                  orderId: this.data.orderId,
                  userId: token,
                  envVersion: app.globalData.miniEnvVersion || 'develop'
                }
              });
              wx.hideLoading();
              if (result.result.code === 0) {
                wx.showToast({ title: '删除成功' });
                this.triggerEvent('course-deleted');
                wx.navigateBack();
                return;
              }
              wx.showToast({ title: result.result.msg || '删除失败', icon: 'none' });
            } catch (error) {
              wx.hideLoading();
              console.error('[publish_classcreate] [handleDeleteCourse] 失败:', error);
              wx.showToast({ title: '网络错误', icon: 'none' });
            }
          }
        }
      });
    },

    // 构建课程保存/发布 payload
    buildCourseSubmitForm() {
      const rawForm = this.data.form;
      const safeSubPlanName = rawForm.sub_plan_name || this.data.selectedSubName || '';
      const safeTitle = rawForm.title || this.buildAutoCourseTitle(rawForm.category || ((this.data.currentClass || {}).name || ''), safeSubPlanName);
      const safeForm = { ...rawForm, title: safeTitle, sub_plan_name: safeSubPlanName };
      const publishType = '发布看看';
      const token = wx.getStorageSync('token');
      const groupedForm = this.buildGroupedSubmitForm(safeForm);
      const firstChildProfile = (groupedForm.child_profiles || [])[0] || { nickname: '', age: '', gender: '', height: '', weight: '' };
      const orderOrganizationInfo = this.buildOrderOrganizationInfo();
      const submitForm = {
        ...safeForm,
        ...groupedForm,
        child_nickname: firstChildProfile.nickname || '',
        child_age: firstChildProfile.age || '',
        child_gender: firstChildProfile.gender || '',
        child_height: firstChildProfile.height || '',
        child_weight: firstChildProfile.weight || '',
        publish_type: publishType,
        class_count: (this.data.currentClass && this.data.currentClass.defaultLessons) || DEFAULT_CLASS_LESSON_COUNT,
        usertoken: token || 'guest_token',
        userInfo: app.globalData.userInfo || { nickName: '发布者', avatarUrl: '' },
        create_time: new Date().toISOString()
      };
      if (orderOrganizationInfo.orgId) {
        submitForm.order_org_info = orderOrganizationInfo;
        submitForm.orgId = orderOrganizationInfo.orgId;
        submitForm.orgName = orderOrganizationInfo.orgName;
        submitForm.orgMemberRole = orderOrganizationInfo.memberRole;
      }
      // 协作码导入追踪字段
      const trace = this.data.collaborationTrace || {};
      const hasBBridgeTrace = Boolean(
        trace.collaborationOriginalFromBCourseId || trace.collaborationOriginalFromBFormId ||
        trace.collaborationOriginalFromBOpenid || trace.collaborationMatchedOrderId
      );
      if (hasBBridgeTrace) {
        submitForm.from_b_course_id = String(trace.collaborationOriginalFromBCourseId || '').trim();
        submitForm.from_b_form_id = String(trace.collaborationOriginalFromBFormId || '').trim();
        submitForm.from_b_openid = String(trace.collaborationOriginalFromBOpenid || '').trim();
        submitForm.bridge_status = String(trace.collaborationOriginalBridgeStatus || BRIDGE_STATUS_LINKED_BY_COLLAB).trim() || BRIDGE_STATUS_LINKED_BY_COLLAB;
        submitForm.source = String(trace.collaborationOriginalSource || '').trim() || 'LINKED_BY_COLLAB';
        const linkedOrderMeta = {
          linked_collaboration_order_id: String(trace.collaborationMatchedOrderId || '').trim(),
          linked_collaboration_parent_course_code: String(trace.collaborationOriginalParentCourseCode || '').trim(),
          linked_collaboration_code_displayed: String(trace.collaborationCode || '').trim(),
          linked_via: 'collaboration_input_row'
        };
        submitForm.other_info = { ...(submitForm.other_info || {}), linked_collaboration_meta: linkedOrderMeta };
        if (submitForm.other_info && !submitForm.other_info.imported_target_snapshot) {
          submitForm.other_info.imported_target_snapshot = { ...linkedOrderMeta };
        }
      }
      return submitForm;
    },

    onSubmit() {
      if (!this.data.canEditCourseInfo) {
        wx.showToast({ title: '仅创建者在「待编辑」且未确认接单前可编辑班级资料。', icon: 'none' });
        return;
      }
      if (this.data.isSubmitting) return;
      const rawForm = this.data.form;
      if (!rawForm.location) {
        wx.showToast({ title: '请选择任务位置', icon: 'none' });
        return;
      }
      if (!rawForm.contact || !String(rawForm.contact).trim()) {
        wx.showToast({ title: '请填写联系方式', icon: 'none' });
        return;
      }
      if (!this.isValidPhone(rawForm.contact)) {
        wx.showToast({ title: '请填写正确的11位手机号', icon: 'none' });
        return;
      }
      const token = wx.getStorageSync('token');
      const runtimeEnvVersion = app.globalData.miniEnvVersion || 'develop';
      const submitForm = this.buildCourseSubmitForm();
      this.setData({ isSubmitting: true });
      wx.showLoading({ title: '发布中...' });
      wx.cloud.callFunction({
        name: getApp().getFnName('NEWDL_execution_order'),
        data: {
          action: this.data.orderId ? 'update_order' : 'publish',
          submitForm,
          userId: token,
          userRole: 'C',
          envVersion: runtimeEnvVersion,
          orderId: this.data.orderId || ''
        },
        success: (res) => {
          wx.hideLoading();
          const result = res.result || {};
          if (result.code === 0 || result.status === 'success' || result._id) {
            if (app.saveUserIdentity) {
              app.saveUserIdentity({ userRole: 'C', needChooseRole: false });
            }
            wx.showToast({ title: this.data.isEditMode ? '修改成功' : '发布成功' });
            setTimeout(() => {
              const targetId = result.orderId || result._id;
              // 通知宿主页面发布/更新成功（组件即将被 redirectTo 卸载，事件为兜底通知）
              this.triggerEvent('submitted', { orderId: targetId || this.data.orderId });
              if (targetId) {
                wx.redirectTo({ url: `/pages/task/publish/publish?id=${targetId}&tab=flow` });
              } else {
                wx.navigateBack();
              }
            }, 1500);
          } else {
            this.setData({ isSubmitting: false });
            wx.showToast({ title: result.msg || '发布失败，请重试', icon: 'none' });
          }
        },
        fail: (err) => {
          wx.hideLoading();
          this.setData({ isSubmitting: false });
          console.error('[publish_classcreate] [onSubmit] 网络请求失败:', err);
          wx.showToast({ title: '网络请求失败', icon: 'none' });
        }
      });
    }
  }
});
