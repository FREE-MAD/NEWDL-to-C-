// pages/task/publish/publish_pdd/publish_pdd.js
const app = getApp();
const { isCourseCreatorRole, BIZ_ROLE_ORG_ADMIN } = require('../../../utils/bizRole');
const DEFAULT_CLASS_LESSON_COUNT = 10;
// 新增：协作码衍生课用的 bridge_status 常量。
// 保持和后端 BRIDGE_STATUS_SYNCED('synced_from_b') 同语义的独立枚举，
// 前端直接用字符串常量，避免在小程序侧 require 云函数内部常量导致打包路径错。
const BRIDGE_STATUS_LINKED_BY_COLLAB = 'linked_by_collaboration_code';

// 旧课节状态文案映射保留注释，不删除；当前链路已不再依赖“开始上课/下课”状态推进
// const LESSON_STATUS_TEXT_MAP = {
//   PENDING: '待上课',
//   COACH_READY: '待确认',
//   PARENT_CONFIRMED: '上课中',
//   COMPLETED_BY_COACH: '已下课',
//   COMPLETED_BY_PARENT: '已下课',
//   DONE: '已完成'
// };

Page({
  bannerBoxTimer: null,

  data: {
    statusBarHeight: 0,
    topSafe: 0,
    selectedTab: 'create',
    orderId: '',
    isEditMode: false,
    order: {
      title: '',
      category: '',
      description: '',
      location: '',
      price_interval: '',
      schedule: []
    },
    schedule: [],
    displaySchedule: [],
    
    // Form Data
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
      // 新增多孩子表单：创建页默认先不放空白孩子卡片，真正点击“添加”后再开始录入
      child_profiles: [],
      coach_private_note: '',
      allow_transfer_to_other_coach: false,
    },
    showCover: false,
    priceOptions: ['不同地区不同' , '100-130', '130-160', '160-190', '190-220', '220-250', '250以上'],
    publishType: '发布看看', // MVP 固定只保留“发布看看”

    // Class Selection Data
    // 课程类型预设说明：当前所有课程类型统一默认 10 节课，不再按不同课程方向拆分默认课时
    // 如果后面点“半途接入”，则表示这门课前面已经上过几节，现在从中间开始接进系统继续管理
    // 新增：教练接取码相关展示字段。
    // pickupCourseCode：8 位班级码(M 码)；pickupConfirmCode：4 位确认码；
    // pickupFullCode：12 位完整接取码（8+4，直接复制给执行教练）；
    // assignedCoachName / assignedCoachAt：已被教练接取时显示。
    pickupCourseCode: '',
    pickupConfirmCode: '',
    pickupFullCode: '',
    pickupFinalCode: '',
    assignedCoachName: '',
    assignedCoachAt: '',
    isResettingPickupCode: false,
    // 新增：生成 12 位接取码前的强制前置门槛状态。
    // - pickupCourseInfoReady：true 表示管理层已经点过「完成课程信息编辑，允许教练接单」；
    // - pickupCourseInfoReadyAt：显示确认时间，便于判断；
    // - isMarkingCourseInfoReady：按钮 loading 状态，避免重复请求。
    pickupCourseInfoReady: false,
    pickupCourseInfoReadyAt: '',
    isMarkingCourseInfoReady: false,
    pageAccessMode: 'manager',
    pageAccessLabel: '创建者',
    pagePermissionRows: [],
    canViewCreateTab: true,
    canViewManageTab: false,
    canViewSummaryTab: false,
    canViewCloseTab: false,
    canEditCourseInfo: true,
    canDeleteCourse: true,
    canOperatePickupCode: false,
    canAdjustLessonPlan: false,
    canWriteSummary: false,
    canCloseCourse: false,
    hasAssignedCoach: false,
    classTypes: [ 
        { 
          id: 'posture', 
          name: '体态矫正', 
          brief: '专门针对青少年中常见的圆肩、驼背、X/O型腿等问题设计的专项训练。通过一系列定制化的训练计划，帮助孩子改善不良体态，促进健康成长', 
          defaultLessons: DEFAULT_CLASS_LESSON_COUNT,
          images: [], 
          planText: '课程分为前期、中期、后期三个阶段推进：前期进行体态评估与基础动作学习，中期重点训练肩颈、脊柱、下肢的稳定与拉伸，后期形成家庭可执行的体态改善方案并跟踪效果。', 
          subItems: ['圆肩驼背改善', '脊柱侧弯预防', 'X/O 型腿调整'], 
          subPlans: { 
            '圆肩驼背改善': '本子计划聚焦于现代青少年因久坐、低头使用电子设备导致的圆肩驼背问题。通过胸椎伸展、肩胛激活及颈部放松训练，帮助打开上背部、恢复自然肩颈曲线；中间引入弹力带抗阻训练、墙面贴靠站立练习等方法，强化深层稳定肌群，建立正确的静态与动态站姿习惯；最后根据孩子日常学习和生活场景，量身定制一套可在家中轻松执行的数分钟纠正操，并提供动作打卡表与视频指导，确保效果可持续。', 
  
  
            '脊柱侧弯预防': '针对脊柱发育关键期可能出现的轻度功能性侧弯，本计划强调早期筛查与干预。通过评估（如Adam前屈测试、体表标志观察）判断脊柱力线是否对称，并检测左右侧核心肌群力量差异；围绕躯干旋转控制、单侧臀肌与背肌激活展开系统训练，采用瑞士球、平衡垫等器械提升本体感觉与对称发力能力；重点培训家长掌握居家观察要点（如双肩高度、骨盆倾斜等），并教授简单辅助拉伸与提醒技巧，形成联动干预机制。', 
  
  
            'X/O 型腿调整': 'X型腿（膝外翻）或O型腿（膝内翻）多与髋关节稳定性不足、足弓塌陷或走路姿势异常相关。本计划着重训练髋外展肌群（如臀中肌）控制力，引导孩子感知下肢正确对线；结合功能性动作如深蹲、弓步走、弹力带侧向行走等，强化膝关节周围肌肉协同工作能力；最后将分析孩子的日常站姿、坐姿及步态，制定个性化行为调整建议（如避免W坐姿、选择合适鞋垫等），并搭配家庭训练包，巩固课堂成果。          ' 
          } 
        }, 
        { 
          id: 'elite', 
          name: '专业追高', 
          brief: '提高专项成绩，适合有一定基础、想要突破的孩子', 
          defaultLessons: DEFAULT_CLASS_LESSON_COUNT,
          images: [], 
          planText: '课程分为前期、中期、后期三个阶段推进：前期基础体能与动作技术复盘，中期进行专项速度、力量、灵敏等强化训练，后期侧重专项测试与比赛模拟，帮助冲击更高水平。', 
          subItems: ['基础能力巩固', '专项成绩突破', '考级与比赛冲刺'], 
          subPlans: { 
            '基础能力巩固': '本子计划旨在为高水平专项训练筑牢体能根基。围绕全身力量发展（尤其下肢爆发力与核心抗旋能力）、动态柔韧性（如主动腿摆、髋关节活动度）及神经肌肉协调性展开系统训练，在确保动作模式标准的前提下，逐步提升训练强度与耐力水平；通过复合式动作组合与多方向移动练习，全面提升运动表现的稳定性、效率与抗疲劳能力，为后续突破打下坚实基础。', 
            '专项成绩突破': '本计划以精准诊断为核心，通过阶段性测试识别技术瓶颈与体能短板（如起跑反应慢、途中跑节奏紊乱、落地缓冲不足等）。针对弱项进行技术细化与专项体能强化，例如优化蹬伸角度、提升步频控制、增强乳酸耐受能力等；同时融入高强度间歇与模拟实战情境，逐步提高单位时间内的动作输出质量，帮助孩子实现从“练得好”到“赛得出”的关键跨越。', 
            '考级与比赛冲刺': '本计划紧密对标体育特长生考级、校队选拔或市级赛事评分标准，融合技术、体能与心理三大维度。安排全真模拟测试、分段节奏策略演练及临场心理调节训练（如压力应对、专注力聚焦）；在冲刺阶段集中进行全流程模拟——从热身流程、检录候场到正式测试与赛后恢复，均由教练按真实考场要求组织，并辅以视频复盘与细节打磨，全面提升应试信心与实战发挥稳定性。          ' 
          } 
        }, 
        { 
          id: 'track', 
          name: '田径专项', 
          brief: '短跑、中长跑、跑跳投综合训练', 
          defaultLessons: DEFAULT_CLASS_LESSON_COUNT,
          images: [], 
          planText: '课程分为前期、中期、后期三个阶段推进：前期学习跑姿、起跑与节奏控制，中期分模块训练短跑速度、中长跑耐力和跑跳投基础技术，后期进行全项目综合练习与测试。', 
          subItems: ['短跑爆发力', '中长跑耐力', '跑跳投综合训练'], 
          subPlans: { 
            '短跑爆发力': '本计划聚焦短距离项目的核心能力——瞬间加速与高速维持。通过起跑反应训练、起跑加速段蹬伸技术优化及途中跑躯干姿态控制，打造高效跑动模式；结合跨步跳、上坡冲刺、阻力伞跑等手段提升后蹬力量与步频协调性；同时利用视频分析逐帧纠正“坐着跑”“摆臂幅度过小”等常见错误，构建经济、快速、稳定的短跑技术体系。', 
            '中长跑耐力': '本计划面向中长距离项目，强调有氧能力与节奏感的协同发展。采用间歇跑、变速节奏跑与匀速耐力跑相结合的方式，循序渐进提升最大摄氧量与乳酸阈值；同步教授腹式呼吸技巧、步频调控策略及心理分段法（如“每段距离设定小目标”），帮助孩子找到个人最佳配速节奏，避免因战术失误导致后程乏力，实现全程匀速甚至后程加速的理想状态。', 
            '跑跳投综合训练': '在稳固基本跑姿基础上，拓展田径基础技能模块。跳远训练注重助跑与起跳的衔接连贯性、空中收腹举腿姿态控制；立定跳远侧重下肢快速伸缩复合能力（SSC）的激发；实心球投掷则从蹬地转髋到鞭打出手进行动力链整合教学。所有内容均强调上下肢协调发力与核心传导效率，为未来参与全能项目或多方向运动发展奠定扎实技术基础。          ' 
          } 
        }, 
        { 
          id: 'exam', 
          name: '中考体育', 
          brief: '围绕中考项目进行系统训练与模拟测试', 
          defaultLessons: DEFAULT_CLASS_LESSON_COUNT,
          images: [], 
          planText: '课程分为前期、中期、后期三个阶段推进：针对中考各项（如长跑、跳绳、实心球等）进行专项拆解练习，前期打基础，中期逐项提升成绩，后期按照中考流程进行全真模拟与应试策略指导。', 
          subItems: ['长跑专项', '跳绳专项', '实心球专项'], 
         subPlans: { 
           '长跑专项': '本计划围绕中考长跑项目，系统提升有氧耐力与跑步经济性。通过节奏跑、间歇跑与呼吸配合训练，帮助学生建立稳定配速策略；结合体能短板分析（如核心不稳、步幅过大），针对性优化跑姿，减少能量浪费；后期融入模拟测试与心理调适，确保考试当天发挥稳定、避免“撞墙”。', 
           '跳绳专项': '本计划面向跳绳专项，强调耐力与节奏感的协同发展。采用间歇跳、变速节奏跳与匀速耐力跳相结合的方式，循序渐进提升心肺能力与动作稳定性；同步教授呼吸配合技巧、摇绳节奏调控策略及心理分段法（如“每段节奏设定小目标”），帮助孩子找到个人最佳配速节奏，避免因体力分配失误导致后程掉速，实现全程稳定甚至后程提速的理想状态。', 
           '实心球专项': '本计划聚焦实心球投掷的技术链条优化，从握球姿势、下肢蹬伸、转髋送肩到最后鞭打出手，逐环节打磨发力顺序与协调性；通过轻重球交替训练、标志物目标投掷等方式提升出手速度与方向控制；同时结合核心抗旋与肩部柔韧性练习，预防运动损伤，确保动作既规范又具爆发力。 ' 
         } 
       }, 
       { 
         id: 'kids_fitness', 
         name: '少儿体能班', 
         brief: '提升整体体能与协调性，增强自信心', 
         defaultLessons: DEFAULT_CLASS_LESSON_COUNT,
         images: [], 
         planText: '以游戏化形式提升孩子的跑、跳、爬、钻、平衡等基础体能，培养良好运动习惯和专注力，让孩子在快乐中爱上运动。', 
         subItems: ['基础体能', '协调性训练', '平衡能力'], 
         subPlans: { 
           '基础体能': '通过趣味障碍跑、动物模仿爬行、追逐游戏等形式，全面提升儿童的力量、速度、耐力与灵活性；所有动作设计符合儿童生长发育特点，避免过早专项化，在快乐中自然发展基础运动能力。', 
           '协调性训练': '借助多方向变向跑、手脚配合钻爬、节奏踏步等游戏化任务，刺激大脑与肢体的协同工作能力；通过非对称动作、交叉模式练习（如对侧手脚同步）促进神经通路发育，为未来学习复杂运动技能打下基础。', 
           '平衡能力': '利用平衡木、软垫、单脚站立挑战等器材与情境，训练静态与动态平衡控制；结合闭眼站立、抛接球等干扰任务，提升前庭系统与本体感觉整合能力，有效预防跌倒，增强运动安全感与自信心。 ' 
         } 
       }, 
       { 
         id: 'rope', 
         name: '跳绳班', 
         brief: '跳绳基础与花样技巧训练，兼顾兴趣与考试', 
         defaultLessons: DEFAULT_CLASS_LESSON_COUNT,
         images: [], 
         planText: '从单摇、双摇等基础节奏入手，逐步加入交叉跳、花样跳等技巧训练，同时结合学校考试要求，提升速度与耐力。', 
         subItems: ['基础跳绳', '速度跳绳', '花样跳绳'], 
         subPlans: { 
           '基础跳绳': '从正确握绳、手腕摇动、双脚轻跳等基本要素入手，建立规范的单摇节奏；通过地面标记、节拍音乐辅助，帮助孩子掌握稳定、省力的跳绳模式，为后续提速与花样打下技术基础。', 
           '速度跳绳': '借助多方向变向跑、手脚配合钻爬、节奏踏步等游戏化任务，刺激大脑与肢体的协同工作能力；通过非对称动作、交叉模式练习（如对侧手脚同步）促进神经通路发育，为未来学习复杂运动技能打下基础。', 
           '花样跳绳': '引入交叉跳、开合跳、弓步跳、双摇等基础花样动作，培养手脚协调与节奏变化能力；通过组合编排与音乐配合，激发创造力与表现欲，让跳绳从“考试项目”转变为“兴趣特长”。 ' 
         } 
       }, 
       { 
         id: 'ball', 
         name: '球类专项班', 
         brief: '乒乓球、羽毛球、篮球、足球等专项兴趣培养', 
         defaultLessons: DEFAULT_CLASS_LESSON_COUNT,
         images: [], 
         planText: '根据孩子选择的球类项目，从基本握拍、运球、传接球等动作教起，配合分组对抗、小比赛，提高技术的同时培养团队意识与规则意识。', 
         subItems: ['乒乓球', '羽毛球', '篮球', '足球'], 
         subPlans: { 
           '乒乓球': '从握拍方式、基本站位、正反手推挡与攻球教起，逐步过渡到发球、接发与简单对打；通过多球训练提升反应速度与击球稳定性，结合小游戏培养球感与专注力，打好入门技术框架。', 
           '羽毛球': '重点训练握拍转换、高远球挥拍轨迹、步法移动（如并步、交叉步）及网前搓放技术；通过定点多球与半场对抗，提升控球能力与场上覆盖意识，激发对隔网对抗项目的兴趣。', 
           '篮球': '从持球姿势、原地运球、传接球准确性开始，逐步加入行进间运球、三步上篮、基础防守滑步等内容；通过双人配合、三人小组等小比赛培养团队配合意识、规则理解与比赛阅读能力。 ', 
           '足球':'围绕脚内侧传球、停球、带球变向、射门等核心技能展开训练；结合绕杆、传准、小型对抗赛等形式，提升球感、空间感知与协作能力，在实战中体验足球乐趣。' 
         } 
       } 
     ],
    currentClassId: null,
    selectedSubName: null,
    currentClass: null,
    // 新增协作课程码：支持在创建页直接输入小程序 B 的课程码，把家长侧信息带入当前表单
    collaborationCode: '',
    collaborationLoading: false,
    collaborationMatchedOrderId: '',
    collaborationParentName: '',
    collaborationChildCount: 0,
    collaborationLocationText: '',
    collaborationContactText: '',
    // 新增协作卡片锁定态：导入成功 / 进入已有课程编辑态 都会置为 true，
    // 保持课程码 view 可见但不可操作，符合"导入后不隐藏，只锁操作"的要求。
    collaborationCardLocked: false,
    isSubmitting: false, // Prevent duplicate submission
    showSyncModal: false,
    showSetTotalModal: false,
    showBannerBoxExpanded: true,
    setTotalLessonsInput: '1',
    syncTotalLessonsInput: '1',
    syncHistoryCountInput: '0',
    lessonPlanLocked: false,
    lessonPlanLockText: '',
    closeSummaryInput: '',
    closeCoachNoteInput: '',
    selectedLessonIndex: 0,
    summaryLessonIndex: 0,
    manageLessonScrollIntoView: 'manage-lesson-0',
    summaryLessonScrollIntoView: 'summary-lesson-0',
    summaryInput: '',
    summaryDate: '',
    summaryStartTime: '',
    summaryEndTime: '',
    // 已停用手动时长输入方案：先保留注释和位置，避免后续需要恢复时找不到上下文
    // summaryDurationMinutes: '60',
    // 新增首次自动补全标记：只有当另一侧时间还没填时，才按默认 60 分钟补一次
    summaryTimeAutoFilled: false,
    // 新增多维评分维度：每个维度单独打分，最终自动汇总综合评分
    summaryDimensionOptions: ['专注', '动作完成', '课堂配合', '训练状态'],
    summaryDimensionRatings: {},
    // 新增输入态缓存：手动输入时先保留原始文本，避免输入小数过程中被立刻改写
    summaryDimensionInputMap: {},
    summaryDimensionCardList: [
      { label: '专注', value: 0, displayValue: '未选择', hasValue: false, inputValue: '' },
      { label: '动作完成', value: 0, displayValue: '未选择', hasValue: false, inputValue: '' },
      { label: '课堂配合', value: 0, displayValue: '未选择', hasValue: false, inputValue: '' },
      { label: '训练状态', value: 0, displayValue: '未选择', hasValue: false, inputValue: '' }
    ],
    summarySelectedDimensionCount: 0,
    summaryAverageRatingText: '未生成'
  },

  onLoad(options) {
    // 新增：用官方推荐的 wx.getWindowInfo 取代已弃用的 wx.getSystemInfoSync，
    // 只取需要的状态栏高度（statusBarHeight）做安全区适配，避免再打 deprecated 警告。
    let statusBarHeight = 20;
    try {
      if (typeof wx.getWindowInfo === 'function') {
        const windowInfo = wx.getWindowInfo();
        if (windowInfo && typeof windowInfo.statusBarHeight === 'number') {
          statusBarHeight = windowInfo.statusBarHeight;
        }
      } else if (typeof wx.getSystemInfoSync === 'function') {
        // 兼容更低版本的基础库：仅在 getWindowInfo 不可用时回退旧 API（依然有警告，但代码可跑）
        const info = wx.getSystemInfoSync();
        if (info && typeof info.statusBarHeight === 'number') {
          statusBarHeight = info.statusBarHeight;
        }
      }
    } catch (err) {
      // 任何异常直接使用默认 20 兜底，不阻塞后续流程
      console.warn('[publish] onLoad 获取 statusBarHeight 异常，使用默认值：', err);
    }
    const h = statusBarHeight + 40; // Adjust safe-top height
    const targetOrderId = options.id || options.taskId || '';
    const selectedTab = options.tab || 'create';
    this.setData({
      statusBarHeight,
      topSafe: h,
      selectedTab: targetOrderId ? selectedTab : 'create'
    });

    // 新增创建权限闸门：默认 V 只允许查看，不允许直接进入新建/编辑班级页面
    if (!targetOrderId && !this.hasCoachCreatePermission()) {
      // 新增角色重算兜底：静默登录刚启动时先给 V，这里再按资料/发课痕迹重算一次，避免真正教练被误拦
      if (app.resolveUserRoleByBusiness) {
        wx.showLoading({
          title: '识别身份中...'
        });
        app.resolveUserRoleByBusiness(true).then(nextRole => {
          wx.hideLoading();
          if (nextRole === 'C') {
            return;
          }

          wx.showToast({
            title: '仅自由教练或机构管理层可创建课程',
            icon: 'none'
          });
          setTimeout(() => {
            wx.switchTab({
              url: '/pages/index/index'
            });
          }, 600);
        }).catch(() => {
          wx.hideLoading();
          wx.showToast({
            title: '仅自由教练或机构管理层可创建课程',
            icon: 'none'
          });
          setTimeout(() => {
            wx.switchTab({
              url: '/pages/index/index'
            });
          }, 600);
        });
        return;
      }

      wx.showToast({
        title: '仅自由教练或机构管理层可创建课程',
        icon: 'none'
      });
      setTimeout(() => {
        wx.switchTab({
          url: '/pages/index/index'
        });
      }, 600);
      return;
    }

    if (!targetOrderId && (selectedTab === 'manage' || selectedTab === 'summary' || selectedTab === 'close')) {
      wx.showToast({
        title: '请先进入已有班级',
        icon: 'none'
      });
    }

    // 新增教练操作台模式：传入订单ID时直接在当前页执行课程管理
    if (targetOrderId) {
      this.setData({
        orderId: targetOrderId,
        isEditMode: true
      });
      this.fetchOrderDetails(targetOrderId);
      return;
    }
  },

  onShow() {
    this.refreshBannerBoxCollapse();
  },

  onHide() {
    this.clearBannerBoxTimer();
  },

  onUnload() {
    this.clearBannerBoxTimer();
  },

  // 新增静默角色判断：当前会话只要已经被业务判成 C，才允许走创建链路
  hasCoachCreatePermission() {
    const businessIdentity = app.getBusinessIdentity ? app.getBusinessIdentity() : null;
    if (businessIdentity) {
      return isCourseCreatorRole(businessIdentity.bizRole);
    }

    const appRole = app.globalData.userRole || wx.getStorageSync('userRole') || 'V';
    return appRole === 'C';
  },

  // 新增固定 DL 尾码拼接：执行教练确认接取后，页面统一展示“12 位接取码 + DL”的最终确认码
  buildPickupFinalCode(rawPickupFullCode = '') {
    const safeCode = String(rawPickupFullCode || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (safeCode.length !== 12) {
      return '';
    }
    return `${safeCode}DL`;
  },

  // 新增 publish 页权限行：把“当前是谁、能做什么、不能做什么”明确展示出来，避免同页混权
  buildPagePermissionRows(accessState = {}) {
    // 新增：管理者可操作阶段 = 待编辑（editing）+ 待接取（awaiting），仍为发布者本人。
    // 用户新规则：
    //  - 待编辑：管理者可以操作“创建班级课程”（家长填写不一定完善，需要管理者补充）与“课节管理”（设置总课时）；
    //  - 待接取：管理者仍可以补充资料与调课节；
    //  - 进行中：管理者全部不可操作；接取教练只能执行每日总结；其余身份只读查看。
    const stageIsManagerialEditable = !!accessState.stageIsManagerialEditable;
    const stageIsInProgress = !!accessState.stageIsInProgress;
    // 压缩权限卡文案：保留身份/阶段 + 核心可做/不可做，删除重复修饰词
    if (accessState.pageAccessMode === 'executor') {
      return [
        { label: '当前身份', value: '执行教练（本人接取）' },
        { label: '可以操作', value: '查看资料、课节；进行中可填每日总结。' },
        { label: '不可操作', value: '改资料/接取码/课表、删课、结课均不可。' }
      ];
    }
    if (accessState.pageAccessMode === 'readonly') {
      return [
        { label: '当前身份', value: '只读查看者' },
        { label: '可以操作', value: '查看资料、课节、总结。' },
        { label: '不可操作', value: '改资料/接取码/课表/总结、删课、结课均不可。' }
      ];
    }
    // 管理层 / 发布者操作台：分三档（可编辑 editing+awaiting / 锁定 in_progress / 终态）。
    if (stageIsManagerialEditable) {
      return [
        { label: '当前身份', value: '课程发布者 / 管理层' },
        { label: '当前阶段', value: accessState.stageIsAwaiting ? '【待接取】仍可补资料/课节' : '【待编辑】可操作阶段' },
        { label: '可以操作', value: '编辑课程资料；课节管理（总课时/半途接入）；待编辑时生成 12 位接取码；未接取前可删课/重置接取码。' },
        { label: '不可操作', value: '教练接取（进入进行中）后全部操作锁为只读。' }
      ];
    }
    if (stageIsInProgress) {
      return [
        { label: '当前身份', value: '课程发布者 / 管理层' },
        { label: '当前阶段', value: '【进行中】管理者不可操作' },
        { label: '可以操作', value: '查看资料、课节、总结；仍可结课。' },
        { label: '不可操作', value: '改资料/课表/接取码、删课均不可；总结由接取教练填写。' }
      ];
    }
    return [
      { label: '当前身份', value: '课程发布者 / 管理层' },
      { label: '当前阶段', value: accessState.hasAssignedCoach ? '【教练已接取】只读' : '【已完成/已关闭】只读' },
      { label: '可以操作', value: '查看资料、课节、总结；仍可结课。' },
      { label: '不可操作', value: '改资料/课表/接取码、删课均不可。' }
    ];
  },

  // 新增 tab 权限收口：publish 页同一套视图由“发布者”和“执行教练”共用时，必须先把入口裁干净。
  // 权限规则（严格按用户最新规则）：
  //  - 待编辑 + 管理者（本人 / 本机构管理层 org_admin，基于 orgId 归属匹配）：可操作“创建班级课程”+“课节管理”；mark_ready 解锁 → 手动生成 12 位接取码 → 进入待接取。
  //  - 待接取 + 管理者（本人 / 本机构管理层）：仍可继续补充资料 / 调课节（家长填写不一定完善、总课时可能还需要改）；也可以重置接取码。
  //  - 进行中：管理者全部不可操作；只有“接取教练”可以写每日总结；其他人只能查看。
  //  - 已完成 / 已关闭：全部只读；发布者本人仍可按需结课。
  buildPageAccessState(orderData = {}) {
    const myOpenid = app.globalData.openid || wx.getStorageSync('openid') || '';
    const myToken = app.globalData.token || wx.getStorageSync('token') || '';
    const publisherOpenid = String(orderData.publisher_openid || '').trim();
    const publisherId = String(orderData.publisher_Id || '').trim();
    const assignedCoachToken = String(orderData.assignedCoachToken || orderData.assigned_coach_token || '').trim();
    const assignedCoachOpenid = String(orderData.assignedCoachOpenid || orderData.assigned_coach_openid || '').trim();
    const hasAssignedCoach = !!(assignedCoachToken || assignedCoachOpenid);
    const isOwner =
      (publisherOpenid && myOpenid && publisherOpenid === myOpenid)
      || (publisherId && myToken && publisherId === myToken);
    const isAssignedCoach =
      (assignedCoachToken && myToken && assignedCoachToken === myToken)
      || (assignedCoachOpenid && myOpenid && assignedCoachOpenid === myOpenid);
    // 新增：机构管理层（BIZ_ROLE_ORG_ADMIN）基于 orgId 归属的管理权限判断。
    // 即使不是课程的直接发布者本人，只要当前用户的 bizRole=org_admin 且当前用户的 orgId 与课程的 orgId 一致，
    // 也应该拥有“创建班级课程”Tab 权限与“课节管理”调课节权限（解决“我是管理者但没有权限”的问题）。
    const businessIdentity = app.getBusinessIdentity ? app.getBusinessIdentity() : null;
    const myBizRole = String(((businessIdentity && businessIdentity.bizRole) || app.globalData.bizRole || wx.getStorageSync('bizRole') || '')).trim();
    const myOrgProfile = (businessIdentity && businessIdentity.organizationProfile) || app.globalData.organizationProfile || wx.getStorageSync('organizationProfile') || {};
    const myOrgId = String((myOrgProfile && myOrgProfile.orgId) || '').trim();
    const orderOrgInfo = orderData.order_org_info || {};
    const orderOrgId = String(
      orderOrgInfo.orgId
      || orderData.orgId
      || ''
    ).trim();
    const isOrgAdminOfThisCourse = myBizRole === BIZ_ROLE_ORG_ADMIN
      && !!myOrgId
      && !!orderOrgId
      && myOrgId === orderOrgId;
    // 管理者口径：发布者本人 + 本机构管理层（org_admin 且 orgId 匹配）。
    // 这两类用户在 editing/awaiting 阶段都可以补充资料、调课节、生成/重置接取码。
    const isManagerialUser = isOwner || isOrgAdminOfThisCourse;
    // 显式读取 fulfill_state；优先读内层 course_flow_info.fulfill_state，再退回顶层/兜底。
    const courseFlow = orderData.course_flow_info || {};
    const explicitFulfillState = String(
      courseFlow.fulfill_state || orderData.fulfill_state || orderData.status || 'editing'
    ).trim();
    const stageIsEditing = explicitFulfillState === 'editing';
    const stageIsAwaiting = explicitFulfillState === 'awaiting';
    const stageIsInProgress = explicitFulfillState === 'in_progress';
    // 新增：管理者可操作阶段组合 = 待编辑（editing）+ 待接取（awaiting）+ 是管理者（本人/本机构管理层）。
    // 这样在“管理者手动确认生成 12 位接取码并进入待接取”后，家长资料仍能继续补，总课时也仍能继续调。
    const stageIsManagerialEditable = (stageIsEditing || stageIsAwaiting) && isManagerialUser;

    // “创建班级课程”资料编辑：editing + awaiting + 管理者（本人/机构管理层）都可。
    const canEditCourseInfo = stageIsManagerialEditable;
    // 删除课程：仅在 editing 阶段、且还没有接取教练时允许。
    // 在 awaiting（待接取）阶段，12 位接取码已经生成，避免被教练已经截图/保存后课程直接消失，因此不允许删课。
    // 机构管理员虽然被纳入管理者口径，但为避免误删他人创建的课程，删课仍只允许真正的发布者本人。
    const canDeleteCourse = stageIsEditing && isOwner && !hasAssignedCoach;
    // 课节管理（设置总课时、加课时、半途接入、调课表结构）：editing + awaiting + 管理者 都可。
    const canAdjustLessonPlan = stageIsManagerialEditable;

    // 接取码链路权限细分：
    // - mark_ready（完成课程信息编辑，解锁生成接取码）：editing + 管理者（本人/机构管理层），这是生成接取码前的必备第一步。
    // - confirm_generate_pickup_code（手动确认生成 12 位接取码并推进到 awaiting）：也只能在 editing + 管理者，防止 awaiting 阶段重复生成。
    // - reset_pickup_confirm_code（重置接取码或更换确认码）：editing + awaiting + 管理者，待接取阶段管理者可以主动“换一版接取码”继续派发。
    const canMarkCourseInfoReady = stageIsEditing && isManagerialUser;
    const canGeneratePickupCode = stageIsEditing && isManagerialUser;
    const canResetPickupCode = stageIsManagerialEditable;
    // 保持旧字段 canOperatePickupCode：同时覆盖 mark_ready + 生成 + 重置三类动作入口；
    // 旧的判断分支不会有新的 canGeneratePickupCode，所以这里仍保持一个总开关。
    const canOperatePickupCode = (canMarkCourseInfoReady || canGeneratePickupCode || canResetPickupCode);

    // 写每日总结：进入进行中之后，只有接取教练本人能写。
    // 在 editing/awaiting 阶段，也允许管理者先写预习文案或总结草稿，方便教练接手后参考。
    const canWriteSummary = (stageIsInProgress ? isAssignedCoach : (isAssignedCoach || stageIsManagerialEditable));
    // 结课：始终保留给发布者本人（否则需要关闭的课程找不到操作入口），但结构性改动仍然锁死。
    const canCloseCourse = isOwner;

    // 页面模式：管理者（本人/机构管理层）都进入 manager 模式，否则按接取教练/只读分流。
    const pageAccessMode = isManagerialUser ? 'manager' : (isAssignedCoach ? 'executor' : 'readonly');
    // 权限文案按阶段再细化一下：进行中阶段管理者页面明确是“只读查看台”。
    let pageAccessLabel;
    if (pageAccessMode === 'executor') {
      pageAccessLabel = stageIsInProgress ? '执行教练操作台（填写每日总结）' : '执行教练操作台（暂未开始上课）';
    } else if (pageAccessMode === 'readonly') {
      pageAccessLabel = '只读查看';
    } else if (stageIsInProgress) {
      pageAccessLabel = '管理层只读查看台（进行中不可编辑）';
    } else if (stageIsAwaiting) {
      pageAccessLabel = '管理层操作台（待接取，仍可补资料/课节）';
    } else {
      pageAccessLabel = '管理层操作台（待编辑）';
    }

    const pickupFinalCode = String(orderData.pickupFinalCode || orderData.pickup_final_code || '').trim()
      || ((hasAssignedCoach || isAssignedCoach) ? this.buildPickupFinalCode(orderData.pickupFullCode || orderData.pickup_full_code || '') : '');
    const accessState = {
      pageAccessMode,
      pageAccessLabel,
      isOwner,
      isOrgAdminOfThisCourse,
      isAssignedCoach,
      hasAssignedCoach,
      stageIsEditing,
      stageIsAwaiting,
      stageIsInProgress,
      stageIsManagerialEditable,
      explicitFulfillState,
      // Tab可见性：editing/awaiting + 管理者展示【创建班课程】Tab用于补资料；进行中/终态后对管理者隐藏。
      // 【课节管理】所有人都能看见（仅在 managerialEditable 时才能改结构）。
      // 【每日总结】所有人可见（仅接取教练能写）。
      // 【结课】仅发布者本人可见。
      canViewCreateTab: canEditCourseInfo,
      canViewManageTab: true,
      canViewSummaryTab: true,
      canViewCloseTab: canCloseCourse,
      canEditCourseInfo,
      canDeleteCourse,
      canOperatePickupCode,
      canMarkCourseInfoReady,
      canGeneratePickupCode,
      canResetPickupCode,
      canAdjustLessonPlan,
      canWriteSummary,
      canCloseCourse,
      pickupFinalCode
    };

    return {
      ...accessState,
      pagePermissionRows: this.buildPagePermissionRows(accessState)
    };
  },

  // 新增 tab 兜底：不同角色进入 publish 时，自动落到自己能操作的页签
  resolveAccessibleTab(preferredTab = 'create', accessState = {}) {
    const safeTab = String(preferredTab || 'create').trim() || 'create';
    const allowMap = {
      create: !!accessState.canViewCreateTab,
      manage: !!accessState.canViewManageTab,
      summary: !!accessState.canViewSummaryTab,
      close: !!accessState.canViewCloseTab
    };

    if (allowMap[safeTab]) {
      return safeTab;
    }
    if (allowMap.manage) {
      return 'manage';
    }
    if (allowMap.summary) {
      return 'summary';
    }
    if (allowMap.create) {
      return 'create';
    }
    if (allowMap.close) {
      return 'close';
    }
    return 'manage';
  },

  // 新增 tab 权限文案：点击被锁的 tab 时，直接告诉当前角色为什么不能动
  getTabDeniedText(tab = '') {
    if (tab === 'create') {
      return '当前角色不能修改课程资料';
    }
    if (tab === 'close') {
      return '只有课程发布者才能结课';
    }
    if (tab === 'manage') {
      return '当前角色不能进入课节管理';
    }
    if (tab === 'summary') {
      return '当前角色不能进入每日总结';
    }
    return '当前角色不能操作该页面';
  },

  // 新增课程机构归属构建：机构管理层建课时自动带上 orgId，编辑已有机构课时优先沿用原归属
  buildOrderOrganizationInfo() {
    const order = this.data.order || {};
    const existingOrderOrgInfo = order.order_org_info || {};
    const businessIdentity = app.getBusinessIdentity ? app.getBusinessIdentity() : null;
    const organizationProfile = (businessIdentity && businessIdentity.organizationProfile) || {};
    const bizRole = String((businessIdentity && businessIdentity.bizRole) || '').trim();

    const orgId = String(
      existingOrderOrgInfo.orgId
      || order.orgId
      || organizationProfile.orgId
      || ''
    ).trim();

    if (!orgId) {
      return {};
    }

    return {
      orgId,
      orgName: String(
        existingOrderOrgInfo.orgName
        || order.orgName
        || organizationProfile.orgName
        || ''
      ).trim(),
      memberRole: String(
        existingOrderOrgInfo.memberRole
        || order.orgMemberRole
        || organizationProfile.memberRole
        || (bizRole === 'org_admin' ? 'admin' : '')
      ).trim(),
      inviteCode: String(
        existingOrderOrgInfo.inviteCode
        || organizationProfile.inviteCode
        || ''
      ).trim()
    };
  },

  // 新增管理页权限收口：不是当前班级所属教练时，统一退回班级展示页
  redirectToPreviewPage(orderId) {
    if (!orderId) {
      wx.switchTab({
        url: '/pages/index/index'
      });
      return;
    }

    wx.redirectTo({
      url: `/pages/task/progress/progress_specialOperation/progress_specialOperation?id=${orderId}`
    });
  },

  // 新增顶部三 tab：创建班课程、课节管理、每日总结
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (!tab) {
      return;
    }
    // 新增空白页限制：没有订单ID时只允许停留在创建页，避免用户误以为能直接管理旧班级
    if (!this.data.orderId && tab !== 'create') {
      wx.showToast({
        title: '请先发布或进入已有班级',
        icon: 'none'
      });
      return;
    }
    if (this.data.orderId) {
      const allowMap = {
        create: !!this.data.canViewCreateTab,
        manage: !!this.data.canViewManageTab,
        summary: !!this.data.canViewSummaryTab,
        close: !!this.data.canViewCloseTab
      };
      if (!allowMap[tab]) {
        wx.showToast({
          title: this.getTabDeniedText(tab),
          icon: 'none'
        });
        return;
      }
    }
    this.setData({ selectedTab: tab });
  },

  // 新增结课入口：第四个 tab 切到结课页，先填写结语和教练备注再提交
  handleCloseCourseTab() {
    if (!this.data.orderId) {
      wx.showToast({
        title: '请先进入已有班级',
        icon: 'none'
      });
      return;
    }
    if (!this.data.canViewCloseTab) {
      wx.showToast({
        title: this.getTabDeniedText('close'),
        icon: 'none'
      });
      return;
    }
    this.setData({ selectedTab: 'close' });
  },

  // 新增顶部 Banner 自动折叠：页面打开后先完整展示 5 秒，再折叠成一行标题栏
  refreshBannerBoxCollapse() {
    this.clearBannerBoxTimer();
    this.setData({
      showBannerBoxExpanded: true
    });

    this.bannerBoxTimer = setTimeout(() => {
      this.setData({
        showBannerBoxExpanded: false
      });
      this.bannerBoxTimer = null;
    }, 5000);
  },

  // 新增 Banner 标题栏切换：收起后可点击标题重新展开，展开后继续按 5 秒规则自动收起
  toggleBannerBox() {
    const nextExpanded = !this.data.showBannerBoxExpanded;

    this.setData({
      showBannerBoxExpanded: nextExpanded
    });

    if (nextExpanded) {
      this.refreshBannerBoxCollapse();
      return;
    }

    this.clearBannerBoxTimer();
  },

  // 新增 Banner 定时器清理：页面离开时及时停止，避免旧定时器串到下次进入
  clearBannerBoxTimer() {
    if (this.bannerBoxTimer) {
      clearTimeout(this.bannerBoxTimer);
      this.bannerBoxTimer = null;
    }
  },

  // 新增横向课节条定位：管理区和总结区都按同一课节索引自动滚到对应位置
  buildLessonScrollViewState(index = 0) {
    const safeIndex = Math.max(0, Number(index) || 0);
    return {
      selectedLessonIndex: safeIndex,
      summaryLessonIndex: safeIndex,
      manageLessonScrollIntoView: `manage-lesson-${safeIndex}`,
      summaryLessonScrollIntoView: `summary-lesson-${safeIndex}`
    };
  },

  formatTime(dateStr) {
    if (!dateStr) {
      return '';
    }

    const date = new Date(dateStr);
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    const hour = `${date.getHours()}`.padStart(2, '0');
    const minute = `${date.getMinutes()}`.padStart(2, '0');
    return `${month}-${day} ${hour}:${minute}`;
  },

  // 新增总结时间格式化：统一把课节已有时间转成 picker 可直接回显的日期字符串
  formatPickerDate(dateInput) {
    if (!dateInput) {
      return '';
    }

    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  // 新增总结时间格式化：统一把课节已有时间转成 picker 可直接回显的时分字符串
  formatPickerTime(dateInput) {
    if (!dateInput) {
      return '';
    }

    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const hour = `${date.getHours()}`.padStart(2, '0');
    const minute = `${date.getMinutes()}`.padStart(2, '0');
    return `${hour}:${minute}`;
  },

  // 新增总结时间回填：切换课节时把已有上下课时间回填到当前编辑器里；无历史日期时默认带出今天
  buildSummaryTimeEditorData(lesson = {}) {
    const startedAt = lesson.startedAt || '';
    const completedAt = lesson.completedAt || '';
    const fallbackDate = this.formatPickerDate(lesson.summaryDate || startedAt || completedAt || new Date())

    return {
      summaryDate: fallbackDate,
      summaryStartTime: this.formatPickerTime(startedAt),
      summaryEndTime: this.formatPickerTime(completedAt),
      summaryTimeAutoFilled: !!(startedAt && completedAt)
    };
  },

  // 新增分钟数清洗：时长输入只保留正整数分钟，避免把空值/非法值直接写进联动逻辑
  parseSummaryDurationMinutes(rawValue) {
    const cleanedValue = String(rawValue || '').replace(/[^\d]/g, '');
    const parsedValue = Number(cleanedValue);
    if (!cleanedValue || !Number.isFinite(parsedValue) || parsedValue <= 0) {
      return 0;
    }
    return Math.min(parsedValue, 1440);
  },

  // 新增课节时长计算：已有上下课时间时，自动回填真实分钟数，方便继续编辑
  calculateSummaryDurationMinutes(startInput, endInput) {
    if (!startInput || !endInput) {
      return 0;
    }

    const startedAt = startInput instanceof Date ? startInput : new Date(startInput);
    const completedAt = endInput instanceof Date ? endInput : new Date(endInput);
    if (Number.isNaN(startedAt.getTime()) || Number.isNaN(completedAt.getTime())) {
      return 0;
    }

    const diffMinutes = Math.round((completedAt.getTime() - startedAt.getTime()) / 60000);
    return diffMinutes > 0 ? diffMinutes : 0;
  },

  // 新增按分钟推算：录入上课/下课时间后，另一端时间按时长分钟自动联动
  shiftSummaryTime(dateValue, timeValue, offsetMinutes) {
    if (!dateValue || !timeValue) {
      return { date: dateValue || '', time: '' };
    }

    const shiftedDate = new Date(`${dateValue}T${timeValue}:00`);
    if (Number.isNaN(shiftedDate.getTime())) {
      return { date: dateValue || '', time: '' };
    }

    shiftedDate.setMinutes(shiftedDate.getMinutes() + offsetMinutes);
    return {
      date: this.formatPickerDate(shiftedDate),
      time: this.formatPickerTime(shiftedDate)
    };
  },

  // 新增课节时间组装：把日期和时分拼回可存库的 ISO 时间字符串
  buildLessonDateTime(dateValue, timeValue) {
    if (!dateValue || !timeValue) {
      return '';
    }

    const date = new Date(`${dateValue}T${timeValue}:00`);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    return date.toISOString();
  },

  // 新增多维评分收口：每个维度保留 0-5 分，支持手动输入小数，0 代表未选择
  normalizeSummaryDimensionRatings(rawRatings = {}) {
    const nextRatings = {};

    (this.data.summaryDimensionOptions || []).forEach(label => {
      const rawValue = rawRatings[label];
      if (rawValue === '' || rawValue === null || typeof rawValue === 'undefined') {
        return;
      }

      const score = Number(rawValue);
      if (Number.isNaN(score)) {
        return;
      }

      const safeScore = Math.max(0, Math.min(5, Number(score.toFixed(2))));
      if (safeScore > 0) {
        nextRatings[label] = safeScore;
      }
    });

    return nextRatings;
  },

  // 新增多维评分输入缓存：录入中保留原样文本，失焦后再回写标准分值
  buildSummaryDimensionInputMap(ratings = {}, rawInputMap = null) {
    const safeRatings = this.normalizeSummaryDimensionRatings(ratings);
    const nextInputMap = {};

    (this.data.summaryDimensionOptions || []).forEach(label => {
      if (rawInputMap && Object.prototype.hasOwnProperty.call(rawInputMap, label)) {
        nextInputMap[label] = String(rawInputMap[label] || '');
        return;
      }

      nextInputMap[label] = safeRatings[label] > 0 ? String(safeRatings[label]) : '';
    });

    return nextInputMap;
  },

  // 新增多维评分展示卡片：模板层直接读卡片结构，避免 WXML 里做复杂判断
  buildSummaryDimensionCardList(ratings = {}, inputMap = {}) {
    const safeRatings = this.normalizeSummaryDimensionRatings(ratings);
    const cardList = (this.data.summaryDimensionOptions || []).map(label => {
      const value = Number(safeRatings[label] || 0);
      return {
        label,
        value,
        displayValue: value > 0 ? `${value}分` : '未选择',
        hasValue: value > 0,
        inputValue: String(inputMap[label] || '')
      };
    });

    const selectedValues = cardList.filter(item => item.value > 0).map(item => item.value);
    const averageRating = selectedValues.length
      ? (selectedValues.reduce((sum, value) => sum + value, 0) / selectedValues.length)
      : 0;

    return {
      cardList,
      selectedCount: selectedValues.length,
      averageRating,
      averageRatingText: selectedValues.length ? averageRating.toFixed(1) : '未生成'
    };
  },

  // 新增多维评分同步：切换课节和手动录分时统一走这里
  applySummaryDimensionRatings(ratings = {}, rawInputMap = null) {
    const safeRatings = this.normalizeSummaryDimensionRatings(ratings);
    const safeInputMap = this.buildSummaryDimensionInputMap(safeRatings, rawInputMap);
    const ratingMeta = this.buildSummaryDimensionCardList(safeRatings, safeInputMap);

    this.setData({
      summaryDimensionRatings: safeRatings,
      summaryDimensionInputMap: safeInputMap,
      summaryDimensionCardList: ratingMeta.cardList,
      summarySelectedDimensionCount: ratingMeta.selectedCount,
      summaryAverageRatingText: ratingMeta.averageRatingText
    });
  },

  // 新增训练标签整理：详情页沿用标签展示时，直接取已选择的维度名称
  buildSummaryRatingTagsFromDimensions(ratings = {}) {
    const safeRatings = this.normalizeSummaryDimensionRatings(ratings);
    return Object.keys(safeRatings);
  },

  // 新增综合评分计算：多维评分自动求平均作为总分入库
  buildAverageSummaryRating(ratings = {}) {
    const safeRatings = this.normalizeSummaryDimensionRatings(ratings);
    const values = Object.values(safeRatings);
    if (!values.length) {
      return 0;
    }

    const average = values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
    return Number(average.toFixed(1));
  },

  // 旧的左右加减分逻辑保留注释，不删除；当前改为固定分值直选，避免分数微调难控制
  // changeSummaryDimensionScore(e) {
  //   const label = String(e.currentTarget.dataset.label || '').trim();
  //   const delta = Number(e.currentTarget.dataset.delta || 0);
  //   if (!label || !delta) {
  //     return;
  //   }
  //
  //   const currentRatings = this.normalizeSummaryDimensionRatings(this.data.summaryDimensionRatings);
  //   const currentValue = Number(currentRatings[label] || 0);
  //   const nextValue = Math.max(0, Math.min(5, currentValue + delta));
  //
  //   if (nextValue > 0) {
  //     currentRatings[label] = nextValue;
  //   } else {
  //     delete currentRatings[label];
  //   }
  //
  //   this.applySummaryDimensionRatings(currentRatings);
  // },

  // 旧的固定分值点击逻辑保留注释，不删除；当前改为每个维度手动输入具体分数
  // selectSummaryDimensionScore(e) {
  //   const label = String(e.currentTarget.dataset.label || '').trim();
  //   const value = Number(e.currentTarget.dataset.value || 0);
  //   if (!label || !value) {
  //     return;
  //   }
  //
  //   const currentRatings = this.normalizeSummaryDimensionRatings(this.data.summaryDimensionRatings);
  //   currentRatings[label] = Math.max(1, Math.min(5, Math.round(value)));
  //
  //   this.applySummaryDimensionRatings(currentRatings);
  // },

  // 新增手动输入分值：支持小数，输入过程中保留原始文本，便于精确录分
  handleSummaryDimensionInput(e) {
    const label = String(e.currentTarget.dataset.label || '').trim();
    if (!label) {
      return;
    }

    const rawValue = String((e.detail || {}).value || '');
    let nextInputValue = rawValue.replace(/[^\d.]/g, '');

    if (nextInputValue.indexOf('.') !== -1) {
      const parts = nextInputValue.split('.');
      nextInputValue = `${parts[0]}.${parts.slice(1).join('').slice(0, 2)}`;
    }

    if (nextInputValue.startsWith('.')) {
      nextInputValue = '';
    }

    if (nextInputValue !== '') {
      const numericValue = Number(nextInputValue);
      if (!Number.isNaN(numericValue) && numericValue > 5) {
        nextInputValue = '5';
      }
    }

    const nextInputMap = {
      ...(this.data.summaryDimensionInputMap || {}),
      [label]: nextInputValue
    };

    const currentRatings = this.normalizeSummaryDimensionRatings(this.data.summaryDimensionRatings);
    const numericValue = Number(nextInputValue);
    if (nextInputValue === '' || Number.isNaN(numericValue) || numericValue <= 0) {
      delete currentRatings[label];
    } else {
      currentRatings[label] = Math.max(0, Math.min(5, Number(numericValue.toFixed(2))));
    }

    this.applySummaryDimensionRatings(currentRatings, nextInputMap);
  },

  // 新增分值失焦整理：把输入框内容回写成标准格式，避免保留无效字符
  handleSummaryDimensionBlur() {
    this.applySummaryDimensionRatings(this.data.summaryDimensionInputMap);
  },

  // 新增清空当前维度分值：保留“未选择”状态，方便重新点选
  clearSummaryDimensionScore(e) {
    const label = String(e.currentTarget.dataset.label || '').trim();
    if (!label) {
      return;
    }

    const currentRatings = this.normalizeSummaryDimensionRatings(this.data.summaryDimensionRatings);
    delete currentRatings[label];
    this.applySummaryDimensionRatings(currentRatings);
  },

  // 新增维度评分初始化：兼容老数据没有 dimensionRatings 的情况
  buildSummaryDimensionRatingsFromLesson(lesson = {}) {
    if (lesson && typeof lesson.dimensionRatings === 'object' && lesson.dimensionRatings) {
      return this.normalizeSummaryDimensionRatings(lesson.dimensionRatings);
    }

    return {};
  },

  // 新增课节展示状态：只有总结内容和上课日期同时存在，才视为已完成
  buildLessonDisplayMeta(lesson = {}) {
    const hasSummary = !!((lesson.summary || '').trim());
    const hasSummaryDate = !!(lesson.summaryDate || lesson.startedAt || lesson.completedAt);
    const isCompleted = hasSummary && hasSummaryDate;

    return {
      isCompleted,
      statusText: isCompleted ? '已完成' : '待记录',
      displayStatusClass: isCompleted ? 'done' : 'pending'
    };
  },

  buildScheduleView(schedule) {
    return (schedule || [])
      .map(item => ({
        ...item,
        ...this.buildLessonDisplayMeta(item),
        startedAtText: item.startedAt ? this.formatTime(item.startedAt) : '',
        completedAtText: item.completedAt ? this.formatTime(item.completedAt) : '',
        // 旧状态驱动文案保留注释，不删除；现在统一只把课节当记录项展示
        // statusText: LESSON_STATUS_TEXT_MAP[item.status] || item.status || '待处理'
      }))
      // 新增展示排序：未完成课节置顶，已完成课节沉到列表底部，便于教练先处理还没记录的课
      // 这里说的“已完成”是指这个课节已经写过总结并带有上课日期，不是单纯点过某个按钮
      .sort((a, b) => {
        if (a.isCompleted === b.isCompleted) {
          return (a.lesson || 0) - (b.lesson || 0);
        }
        return a.isCompleted ? 1 : -1;
      });
  },

  // 新增课表锁定统计：只统计接入后课表里真实记录完成的课节，历史汇总课次不计入“三节后锁定”
  getRecordedLessonCount(schedule = []) {
    return (schedule || []).filter(item => this.buildLessonDisplayMeta(item).isCompleted).length;
  },

  // 新增课表锁定限制：前 3 节课都可以修改，记录满 3 节后自动锁定；半途接入时只统计接入后的课节
  buildLessonPlanGuard(orderData) {
    const schedule = Array.isArray((orderData || {}).schedule) ? orderData.schedule : [];
    const historySync = (orderData || {}).history_sync;
    const recordedLessonCount = this.getRecordedLessonCount(schedule);
    const remainingEditableCount = Math.max(0, 3 - recordedLessonCount);
    const lessonPlanLocked = recordedLessonCount >= 3;
    // 压缩课表锁定提示：保留已记录节数 + 剩余可调节数 + 锁定核心语义
    const lessonPlanLockText = lessonPlanLocked
      ? `已记录 ${recordedLessonCount} 节课，触发「三节后锁定」，不再支持修改总课时或半途接入。`
      : (historySync
        ? `半途接入，历史 ${historySync.syncedCount || 0} 节不计锁定；接入后再记录 ${remainingEditableCount} 节将锁定。`
        : `从第 1 节起统计；累计满 3 节课后自动锁定，目前还可记录 ${remainingEditableCount} 节。`);

    return {
      recordedLessonCount,
      lessonPlanLocked,
      lessonPlanLockText
    };
  },

  // 新增课节展示整理：半途接入时在前面插入一个历史汇总框
  buildDisplaySchedule(schedule, orderData) {
    const list = [];
    const historyCount = (((orderData || {}).history_sync || {}).syncedCount) || 0;

    if (historyCount > 0) {
      list.push({
        isHistorySummary: true,
        actualIndex: -1,
        title: `0-${historyCount}`,
        statusText: '已完成',
        displayStatusClass: 'done'
      });
    }

    (schedule || []).forEach((item, index) => {
      list.push({
        ...item,
        actualIndex: index,
        isHistorySummary: false
      });
    });

    return list;
  },

  // 新增表单分组整理：数据库按页面结构保存四类信息
  buildAutoCourseTitle(className = '', subPlanName = '') {
    const baseName = String(subPlanName || className || '').trim();
    return baseName ? `${baseName}课程` : '';
  },

  // 新增表单分组整理：数据库按页面结构保存四类信息
  buildGroupedSubmitForm(rawForm) {
    const childProfiles = this.normalizeChildProfiles(rawForm.child_profiles);
    const firstChildProfile = childProfiles[0] || { nickname: '', age: '', gender: '', height: '', weight: '' };

    return {
      course_target: {
        category: rawForm.category || '',
        title: rawForm.title || '',
        sub_plan_name: rawForm.sub_plan_name || '',
        description: rawForm.description || '',
        // 新增课程计划字段：支持在课程说明卡里直接二次编辑
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
        // 兼容旧结构：child_profile 继续保留第一个孩子，避免旧页面和旧数据链路断掉
        nickname: firstChildProfile.nickname || '',
        age: firstChildProfile.age || '',
        gender: firstChildProfile.gender || '',
        height: firstChildProfile.height || '',
        weight: firstChildProfile.weight || ''
      },
      // 新增多孩子结构：新页面优先读取 child_profiles
      child_profiles: childProfiles,
      coach_private: {
        price_interval: rawForm.price_interval || '',
        coach_private_note: rawForm.coach_private_note || '',
        allow_transfer_to_other_coach: !!rawForm.allow_transfer_to_other_coach
      }
    };
  },

  // 新增多孩子数据收口：统一把页面录入和老数据回填都整理成数组
  normalizeChildProfiles(childProfiles = []) {
    const safeList = Array.isArray(childProfiles) ? childProfiles : [];
    const normalizedList = safeList.map(item => ({
      nickname: String((item || {}).nickname || '').trim(),
      age: String((item || {}).age || '').trim(),
      gender: String((item || {}).gender || '').trim(),
      height: String((item || {}).height || '').trim(),
      weight: String((item || {}).weight || '').trim()
    }));

    const filteredList = normalizedList.filter(item =>
      item.nickname || item.age || item.gender || item.height || item.weight
    );

    return filteredList;
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
        // 新增空孩子兼容：没填任何孩子资料时，这里保持 0 个，不再强行补一个空卡片
        child_profiles: childProfiles,
        coach_private_note: coachPrivate.coach_private_note || order.coach_private_note || '',
        allow_transfer_to_other_coach: coachPrivate.allow_transfer_to_other_coach !== undefined ? !!coachPrivate.allow_transfer_to_other_coach : !!order.allow_transfer_to_other_coach,
        latitude: order.latitude,
        longitude: order.longitude
      },
      currentClassId: matchedClass ? matchedClass.id : null,
      currentClass: matchedClass,
      selectedSubName: savedSubPlanName || null
    });
  },

  syncSummaryEditor(schedule) {
    const lessonIndex = this.data.summaryLessonIndex || 0;
    const targetLesson = (schedule || [])[lessonIndex] || {};
    const targetSummaryIndex = targetLesson.lesson ? lessonIndex : 0;
    const safeLesson = (schedule || [])[targetSummaryIndex] || {};
    const dimensionRatings = this.buildSummaryDimensionRatingsFromLesson(safeLesson);
    this.setData({
      ...this.buildLessonScrollViewState(targetSummaryIndex),
      summaryInput: safeLesson.summary || '',
      ...this.buildSummaryTimeEditorData(safeLesson)
    });
    this.applySummaryDimensionRatings(dimensionRatings);
  },

  // 新增课节选择器：课节管理先选中目标课节，再执行对应操作
  syncSelectedLesson(schedule) {
    const lessonIndex = this.data.selectedLessonIndex || 0;
    const targetLesson = (schedule || [])[lessonIndex] || {};
    this.setData({
      ...this.buildLessonScrollViewState(targetLesson.lesson ? lessonIndex : 0)
    });
  },

  fetchOrderDetails(orderId) {
    wx.showLoading({ title: '加载中' });

    return wx.cloud.callFunction({
      name: 'NEWDL_execution_order',
      data: {
        action: 'get_oneorder',
        orderId,
        envVersion: app.globalData.miniEnvVersion || 'develop'
      }
    }).then(res => {
      wx.hideLoading();
      const result = res.result || {};
      if (result.code !== 0 || !result.data) {
        wx.showToast({ title: result.msg || '加载失败', icon: 'none' });
        return;
      }

      const orderData = result.data || {};
      const accessState = this.buildPageAccessState(orderData);

      // 新增管理者入口校验：管理页只允许发布者本人、本机构管理层 org_admin（isOrgAdminOfThisCourse）、
      // 或已接取的执行教练进入；其他无权限用户统一回班级展示页。
      // 解决“我是管理者但创建班级课程没有权限”的问题。
      if (!accessState.isOwner && !accessState.isAssignedCoach && !accessState.isOrgAdminOfThisCourse) {
        wx.showToast({
          title: '仅发布者/机构管理层/执行教练可操作',
          icon: 'none'
        });
        setTimeout(() => {
          this.redirectToPreviewPage(orderId);
        }, 600);
        return;
      }

      // 新增角色即时升级：只要已命中所属教练，就把当前会话同步成 C
      if (app.saveUserIdentity) {
        app.saveUserIdentity({
          userRole: 'C',
          needChooseRole: false
        });
      }

      const schedule = this.buildScheduleView(orderData.schedule || []);
      const displaySchedule = this.buildDisplaySchedule(schedule, orderData);
      const historyCount = (((orderData || {}).history_sync || {}).syncedCount) || 0;
      const lessonPlanGuard = this.buildLessonPlanGuard(orderData);
      // 新增：编辑态 (已有课程) 也按"不隐藏课程码 view 但禁止操作"的要求展示协作码：
      // 1) 从订单 4 字段里挑一个真实存在的码显示；
      // 2) 把 collaborationCardLocked 置 true，确保输入框和按钮不可再改。
      const existingCourseCode = this.normalizeCollaborationCode(
        orderData.joinCode
        || orderData.courseCode
        || orderData.parent_course_code
        || orderData.from_b_course_id
        || ''
      );
      const otherInfo = orderData.other_info || {};
      const childProfiles = this.normalizeChildProfiles(
        (Array.isArray(orderData.child_profiles) && orderData.child_profiles.length)
          ? orderData.child_profiles
          : [{
              nickname: orderData.child_nickname || ((orderData.child_profile || {}).nickname) || '',
              age: orderData.child_age || ((orderData.child_profile || {}).age) || '',
              gender: orderData.child_gender || ((orderData.child_profile || {}).gender) || '',
              height: orderData.child_height || ((orderData.child_profile || {}).height) || '',
              weight: orderData.child_weight || ((orderData.child_profile || {}).weight) || ''
            }]
      );
      const safeParentName = String(otherInfo.imported_parent_name || ((otherInfo.publisherInfo || {}).nickName) || '').trim();
      const safeLocation = String(orderData.location || ((orderData.course_basic || {}).location) || '').trim();
      const safeContact = String(otherInfo.imported_phone || orderData.contact || ((orderData.course_basic || {}).contact) || '').trim();
      // 新增：编辑态读取「教练接取码」相关字段与执行教练信息，供 UI 卡片展示、复制和重置。
      const pickupCourseCode = String(orderData.joinCode || orderData.courseCode || existingCourseCode || '').trim();
      const pickupConfirmCode = String(orderData.pickupConfirmCode || orderData.pickup_confirm_code || '').trim();
      // 优先用后端已拼好的 pickupFullCode，没有时退化为本地拼接（兼容历史老订单在编辑时才补确认码的显示）
      const pickupFullCode = String(orderData.pickupFullCode || orderData.pickup_full_code || '').trim()
        || ((pickupCourseCode.length === 8 && pickupConfirmCode.length === 4) ? `${pickupCourseCode}${pickupConfirmCode}` : '');
      const pickupFinalCode = String(orderData.pickupFinalCode || orderData.pickup_final_code || '').trim()
        || accessState.pickupFinalCode;
      const assignedCoachName = String(orderData.assignedCoachName || orderData.assigned_coach_name || '').trim();
      const rawAssignedAt = orderData.assignedCoachAt;
      const assignedCoachAt = rawAssignedAt ? ((new Date(rawAssignedAt)).toLocaleString()) : '';
      // 新增：读取「课程资料确认门槛」的状态：course_info_ready_at 有值 = 管理层已经点过
      // 「完成课程信息编辑，允许教练接单」，之后才允许在 UI 上点击「确认生成 12 位接取码」。
      // course_flow_info 里也会同步写一份，任取一份有值即可，避免某一端只更新到了顶层或内层。
      const rawInfoReadyAt = orderData.course_info_ready_at
        || (((orderData.course_flow_info || {}).course_info_ready_at) || null);
      const pickupCourseInfoReady = !!(rawInfoReadyAt);
      const pickupCourseInfoReadyAt = rawInfoReadyAt ? ((new Date(rawInfoReadyAt)).toLocaleString()) : '';
      const selectedTab = this.resolveAccessibleTab(this.data.selectedTab, accessState);

      this.setData({
        orderId,
        isEditMode: true,
        selectedTab,
        order: orderData,
        schedule,
        displaySchedule,
        setTotalLessonsInput: `${orderData.progress_total || 1}`,
        syncTotalLessonsInput: `${orderData.progress_total || 1}`,
        syncHistoryCountInput: `${historyCount || 0}`,
        closeSummaryInput: (((orderData || {}).course_flow_info || {}).close_summary) || '',
        closeCoachNoteInput: (((orderData || {}).course_flow_info || {}).close_coach_note) || '',
        // 新增：编辑态下协作卡片锁定 + 历史协作码读出来展示；
        // 如果 order 是导入型 (带 source='from_b_parent' 或已有 from_b_course_id) 也显示已匹配摘要。
        collaborationCode: existingCourseCode,
        collaborationMatchedOrderId: (orderData.from_b_course_id || orderData.bridge_status) ? (orderData._id || orderId) : '',
        collaborationParentName: safeParentName,
        collaborationChildCount: childProfiles.length,
        collaborationLocationText: safeLocation,
        collaborationContactText: safeContact,
        collaborationCardLocked: true,
        // 新增：编辑态同步「接取码卡片」显示数据
        pickupCourseCode,
        pickupConfirmCode,
        pickupFullCode,
        pickupFinalCode,
        assignedCoachName,
        assignedCoachAt,
        // 新增：同步「课程资料确认门槛」状态到前端接取码卡片，控制第一步按钮和第二步按钮的解锁。
        pickupCourseInfoReady,
        pickupCourseInfoReadyAt,
        pageAccessMode: accessState.pageAccessMode,
        pageAccessLabel: accessState.pageAccessLabel,
        pagePermissionRows: accessState.pagePermissionRows,
        canViewCreateTab: accessState.canViewCreateTab,
        canViewManageTab: accessState.canViewManageTab,
        canViewSummaryTab: accessState.canViewSummaryTab,
        canViewCloseTab: accessState.canViewCloseTab,
        canEditCourseInfo: accessState.canEditCourseInfo,
        canDeleteCourse: accessState.canDeleteCourse,
        canOperatePickupCode: accessState.canOperatePickupCode,
        // 新增：接取码链路三个细分权限，用于 publish 页不同入口的 toast 文案区分。
        canMarkCourseInfoReady: accessState.canMarkCourseInfoReady,
        canGeneratePickupCode: accessState.canGeneratePickupCode,
        canResetPickupCode: accessState.canResetPickupCode,
        canAdjustLessonPlan: accessState.canAdjustLessonPlan,
        canWriteSummary: accessState.canWriteSummary,
        canCloseCourse: accessState.canCloseCourse,
        hasAssignedCoach: accessState.hasAssignedCoach,
        ...lessonPlanGuard
      });

      this.applyOrderToForm(orderData);
      this.syncSelectedLesson(schedule);
      this.syncSummaryEditor(schedule);
    }).catch(err => {
      wx.hideLoading();
      console.error('[publish] [fetchOrderDetails] 加载失败:', err);
      wx.showToast({ title: '网络错误', icon: 'none' });
    });
  },

  chooseLocation() {
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

  onPriceChange(e) {
    this.setData({
      'form.price_interval': this.data.priceOptions[e.detail.value]
    });
  },

  // 新增协作课程码清洗：输入时统一去空格并转成大写，减少手动输入差错
  normalizeCollaborationCode(rawValue = '') {
    return String(rawValue || '').replace(/\s+/g, '').trim().toUpperCase();
  },

  // 新增协作课程码输入：创建页顶部单独维护一个课程码输入框
  handleCollaborationCodeInput(e) {
    // 新增：协作卡片一旦锁定（导入成功 / 已有课程编辑），就不允许再改，
    // 哪怕前端微信组件 disabled 失效，这里 JS 再兜一层，避免 view 虽然显示码但代码路径还能改码。
    if (this.data.collaborationCardLocked) {
      return;
    }
    this.setData({
      collaborationCode: this.normalizeCollaborationCode((e.detail || {}).value || '')
    });
  },

  // 新增协作信息回填：把小程序 B 已有的家长/孩子/地点信息直接灌进当前建课表单
  applyCollaborativeOrderToForm(order = {}) {
    const currentForm = this.data.form || {};
    const courseBasic = order.course_basic || {};
    const otherInfo = order.other_info || {};
    const publisherInfo = otherInfo.publisherInfo || {};
    const childProfiles = this.normalizeChildProfiles(
      (Array.isArray(order.child_profiles) && order.child_profiles.length)
        ? order.child_profiles
        : [{
            nickname: order.child_nickname || '',
            age: order.child_age || '',
            gender: order.child_gender || '',
            height: order.child_height || '',
            weight: order.child_weight || ''
          }]
    );
    const safeLocation = String(order.location || courseBasic.location || '').trim();
    const safeContact = String(otherInfo.imported_phone || order.contact || courseBasic.contact || '').trim();
    const safeParentName = String(otherInfo.imported_parent_name || publisherInfo.nickName || '').trim();
    // 修复：collaboration 展示用课程码必须"8 位 M 码优先"，不能先取 from_b_course_id。
    // 之前实现 order.from_b_course_id 写的是 B 侧内部 courseId（如 COURSE_17883），
    // 而 B 约课桥接时 8 位家长可分享的 M 码统一写进 joinCode/courseCode/parent_course_code 三份；
    // 前端展示一旦从 from_b_course_id（COURSE_17883）覆盖掉用户刚输入的 M 码（BGWBFEWA），
    // 用户就会看到"刚输的码被偷偷替换"的怪异现象，也会造成后续把 COURSE_17883 当成协作码去再次导入的误查。
    // 只有当订单完全没写三份 M 码字段时（极早期桥订单，没跑补 M 码逻辑），才兜底用 from_b_course_id。
    const mCodeCandidates = [
      order.joinCode,
      order.courseCode,
      order.parent_course_code,
      this.data.collaborationCode
    ].map(item => this.normalizeCollaborationCode(item)).filter(Boolean);
    const safeCourseCode = mCodeCandidates[0] || this.normalizeCollaborationCode(order.from_b_course_id || '');
    // 新增：B 侧原始追踪字段保留成独立 data 属性，发布时继续原样透传到新订单文档，
    // 确保"发布课程（而不是去数据库里找已有课程/修改已桥课程）"这一新建语义下仍然能追踪到 B 原始单据。
    // from_b_course_id 不再作为展示课程码的来源，但仍然保留在 collaborationOriginalFromBCourseId 上用于后续溯源。
    // 注意：otherInfo 已在函数开头第 1509 行声明并赋值，此处直接复用，避免重复声明导致编译失败。
    const safeFromBCourseId = String(order.from_b_course_id || '').trim();
    const safeFromBFormId = String(
      order.from_b_form_id
      || otherInfo.from_b_form_id
      || ((otherInfo.imported_target_snapshot || {}).formId)
      || ''
    ).trim();
    const safeFromBOpenid = String(
      order.from_b_openid
      || otherInfo.from_b_openid
      || ((otherInfo.imported_target_snapshot || {}).fromOpenid)
      || ''
    ).trim();
    const safeBridgeSource = String(order.source || otherInfo.source || '').trim() || 'bridged_from_b';
    const safeBridgeStatus = String(order.bridge_status || '').trim();
    // 新增：课程标题不从协作码（小程序 B 家长订单）进行对应拉取，
    // 因为课程标题是教练侧独立定义的信息，和家长端的订单标题属于不同概念，
    // 保持教练在表单里已经填好的 title，为空则继续为空让教练自行填写。
    const nextTitle = String(currentForm.title || '').trim();
    // 新增：课程备注（description）前置追加一行「悦动邻 - 家长约课登记导入」，
    // 用于在所有列表 / 详情 / 备注区域一眼识别"这一单是 B 家长约课带过来的协作订单"。
    const importTagLine = '悦动邻 - 家长约课登记导入';
    const existingDescription = String(currentForm.description || '').trim();
    const importedDescription = String(order.description || '').trim();
    const rawDescriptionParts = [importedDescription, existingDescription].filter(Boolean);
    const mergedDescriptionWithoutTag = rawDescriptionParts.join('\n').trim();
    const nextDescription = mergedDescriptionWithoutTag
      ? `${importTagLine}\n${mergedDescriptionWithoutTag}`
      : importTagLine;
    // 新增：同一个协作码重复导入不要重复堆「悦动邻 - 家长约课登记导入」行；
    // 如果 description 开头已经是同一行导入标识，直接复用旧值，避免用户点两次拉取产生两行相同前缀。
    const descriptionAlreadyTagged = mergedDescriptionWithoutTag.startsWith(importTagLine);
    const finalDescription = descriptionAlreadyTagged
      ? mergedDescriptionWithoutTag
      : nextDescription;

    this.setData({
      form: {
        ...currentForm,
        title: nextTitle,
        sub_plan_name: '',
        course_plan: String(order.course_plan || currentForm.course_plan || '').trim(),
        frequency: String(order.frequency || currentForm.frequency || '').trim(),
        category: String(order.category || currentForm.category || '家长转交').trim(),
        description: finalDescription,
        location: safeLocation || currentForm.location || '',
        contact: safeContact || currentForm.contact || '',
        course_size_mode: String(order.course_size_mode || currentForm.course_size_mode || '1对1').trim() || '1对1',
        // 新增协作导入：直接按对方订单带出的孩子列表覆盖，避免家长已填的信息还要重复再录一次
        child_profiles: childProfiles,
        latitude: order.latitude !== undefined ? order.latitude : currentForm.latitude,
        longitude: order.longitude !== undefined ? order.longitude : currentForm.longitude,
        // 新增：教练内部的课程备注不从协作码拉取，
        // 这是教练侧独立的内部记录信息（和家长端填写的内容是不同概念），
        // 保持教练已填的内容不变，为空则继续为空。
        coach_private_note: String(currentForm.coach_private_note || '').trim(),
        // 新增：价格区间和是否允许流转也不从协作码拉取，
        // 这两个属于教练内部经营判断字段，保持已填内容不变。
        price_interval: String(currentForm.price_interval || '').trim(),
        allow_transfer_to_other_coach: !!currentForm.allow_transfer_to_other_coach
      },
      currentClassId: null,
      currentClass: null,
      selectedSubName: null,
      collaborationCode: safeCourseCode,
      collaborationMatchedOrderId: String(order._id || '').trim(),
      collaborationParentName: safeParentName,
      collaborationChildCount: childProfiles.length,
      collaborationLocationText: safeLocation,
      collaborationContactText: safeContact,
      // 新增：B 桥追踪信息独立成 data 字段，发布时透传到新订单文档。
      // 需求约定："发布课程(而不是去数据库里面找已有课程)"。
      // 也就是即使 get_order_by_course_code 查到了一条已经桥接进来的 B 订单，
      // 用户在 publish 页再点"发布"时仍然会新建一条 A 管理课程，
      // 而不是 update 那条旧桥订单；为了溯源，旧桥订单的 B 信息必须原样挂到新订单上。
      collaborationOriginalFromBCourseId: safeFromBCourseId,
      collaborationOriginalFromBFormId: safeFromBFormId,
      collaborationOriginalFromBOpenid: safeFromBOpenid,
      collaborationOriginalSource: safeBridgeSource,
      collaborationOriginalBridgeStatus: safeBridgeStatus,
      collaborationOriginalParentCourseCode: this.normalizeCollaborationCode(order.parent_course_code || ''),
      collaborationOriginalMatchedCourseCode: this.normalizeCollaborationCode(order.courseCode || order.joinCode || '')
    });
  },

  // 新增协作拉取：输入家长课程码后，直接去云端查对应订单并带入当前表单
  async pullCollaborativeOrder() {
    if (this.data.collaborationLoading) {
      return;
    }

    // 新增：和 WXML 的 disabled/锁定态保持一致，JS 也阻止重复触发，
    // 确保导入后 view 显示码，而按钮与回车事件不会再去云端查询覆盖。
    if (this.data.collaborationCardLocked) {
      wx.showToast({
        title: this.data.orderId ? '已有课程，协作码锁定' : '协作码已导入，不可再次拉取',
        icon: 'none'
      });
      return;
    }

    if (this.data.orderId) {
      wx.showToast({
        title: '已有课程时不能重新拉取',
        icon: 'none'
      });
      return;
    }

    const courseCode = this.normalizeCollaborationCode(this.data.collaborationCode);
    if (!courseCode) {
      wx.showToast({
        title: '请先输入课程码',
        icon: 'none'
      });
      return;
    }

    this.setData({
      collaborationCode: courseCode,
      collaborationLoading: true,
      collaborationMatchedOrderId: '',
      collaborationParentName: '',
      collaborationChildCount: 0,
      collaborationLocationText: '',
      collaborationContactText: ''
    });
    wx.showLoading({
      title: '拉取中...'
    });

    // 新增：把云函数调用 + 3 层解包逻辑收敛成单独 helper，
    // 便于"首进失败时自动重试一次"——真实线上出现过"第一次调用返回 404 未知操作(无 debug)，
    // 再进页面又好了"的现象，极大可能是新包没完全热/多实例时首请求落到老实例；toast 提示 + 静默重试 1 次，避免把用户吓成『码错了』。
    // 修复：getApp() 上未挂过 .share，之前会直接抛 "Cannot destructure property 'app' of ..."；
    // 这里直接取 App 实例，同时把 miniEnvVersion 改成多层兜底，避免因为一次空属性错误导致 finally 没跑、按钮保持 loading 一直转圈。
    const appInstance = getApp() || {};
    const appGlobal = (appInstance && appInstance.globalData) ? appInstance.globalData : {};
    const miniEnvVersion = appGlobal.miniEnvVersion
      || (wx.getAccountInfoSync && (() => {
        try { return (wx.getAccountInfoSync().miniProgram || {}).envVersion; } catch (_) { return ''; }
      })())
      || 'develop';
    // 新增：云调用超时兜底。B(API 桥接) 场景下云端实例如果 cold start + DB 连接超时，
    // wx.cloud.callFunction 偶尔不会 resolve / reject，造成前端「一直转圈」。
    // 这里用 Promise.race 加 15 秒硬超时，到期直接抛错并交给 finally 清理 loading 态。
    const CLOUD_CALL_TIMEOUT_MS = 15000;
    const callCloudOrderOnce = async (attemptTag) => {
      const callPromise = (async () => {
        const res = await wx.cloud.callFunction({
          name: 'NEWDL_execution_order',
          data: {
            action: 'get_order_by_course_code',
            courseCode,
            envVersion: miniEnvVersion
          }
        });
        return res;
      })();
      const timeoutPromise = new Promise((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error(`cloud timeout ${CLOUD_CALL_TIMEOUT_MS}ms`));
        }, CLOUD_CALL_TIMEOUT_MS);
      });
      const res = await Promise.race([callPromise, timeoutPromise]);
      console.log(`[publish] [pullCollaborativeOrder][${attemptTag}] callFunction 原始返回 res =`, res);

      let result = res && res.result;
      // 兼容形态2：重复包装一层 result
      if (result && typeof result === 'object' && typeof result.result === 'object' && typeof result.code !== 'number') {
        result = result.result;
      }
      // 兼容形态3：HTTP 返回 { statusCode, headers, body/data }
      if (result && typeof result === 'object') {
        if (typeof result.data === 'object' && typeof result.code !== 'number') {
          result = { ...result, ...result.data };
        }
        if (typeof result.body === 'string' && result.body.trim().charAt(0) === '{') {
          try {
            const bodyObj = JSON.parse(result.body);
            if (bodyObj && typeof bodyObj === 'object') {
              result = { ...result, ...bodyObj };
            }
          } catch (err) {
            console.warn(`[publish] [pullCollaborativeOrder][${attemptTag}] HTTP body JSON parse fail:`, err);
          }
        }
        if (typeof result.body === 'object' && result.body && typeof result.code !== 'number') {
          result = { ...result, ...result.body };
        }
      }
      result = result || {};
      console.log(`[publish] [pullCollaborativeOrder][${attemptTag}] 解包后的业务 result =`, result);
      return { res, result };
    };

    // 新增：404 未知操作且无 debug = 典型"云端实例未切到新包"。只弹 toast 不阻塞，并 500ms 后再试一次。
    // 真失败（重试后仍然是 404 / 或有 debug 但结构不一致）再弹 Modal。
    try {
      let firstPair = await callCloudOrderOnce('attempt-1');
      let { res, result } = firstPair;
      const isUnhandledUnknownAction = (
        result.code === 404
        && result.msg === '未知操作'
        && !(result.debug && Object.keys(result.debug).length)
      );
      if (isUnhandledUnknownAction) {
        console.warn('[publish] [pullCollaborativeOrder] 首包返回 404 未知操作且无 debug，疑似新包冷启动/实例未切，自动重试一次；code=', courseCode);
        wx.showToast({
          title: '云端预热中，重试一次',
          icon: 'none'
        });
        await new Promise(resolve => setTimeout(resolve, 500));
        const secondPair = await callCloudOrderOnce('attempt-2');
        res = secondPair.res;
        result = secondPair.result;
      }

      if (result.code !== 0 || !result.data) {
        // 新增：区分协作码查不到 vs 云函数 action 没命中 vs 云函数异常(无code) 三种常见失败，
        // 避免都显示「未找到协作信息」让用户反复重试同一个码。
        const debug = result.debug || {};
        if (result.code === 404 && result.msg === '未知操作') {
          const receivedAction = debug.receivedAction;
          const parsed = debug.parsed || {};
          const supportedActions = debug.supportedActions;
          const actionDiagnostic = debug.actionDiagnostic || {};
          // 新增：经过首包自动重试后，仍然没有 debug 且没有 buildId，
          // 说明云函数实际入口仍然是旧 true_index（exports.main 只有旧 switch-case，
          // 没有 get_order_by_course_code / 接取码 / 12位接取码 全套 action），
          // 这就是"输入课程码一致转圈"的根因：首进必 404 无 debug，前端判断"预热"，
          // 重试仍然 404 无 debug → finally 重置 loading 之前用户感知就是一直在转。
          // 这里先给出明确 toast 定位到「云端版本未同步」，不再误导成码格式错。
          const hasDebugPayload = Boolean(debug && Object.keys(debug).length);
          const hasBuildId = Boolean(debug.buildId);
          console.error('[publish] [pullCollaborativeOrder] 云函数返回 未知操作:', {
            sentAction: 'get_order_by_course_code',
            receivedAction,
            supportedActions,
            parsed,
            actionDiagnostic,
            buildId: debug.buildId,
            hasDebugPayload,
            rawResult: result,
            rawCallFunctionRes: res
          });
          const contentLines = [];
          if (!hasDebugPayload || !hasBuildId) {
            // 修复：旧 true_index 的 default 返回的是纯 {code:404,msg:'未知操作'}，
            // 既没有 debug 也没有 buildId，前端不应该再提示"云端预热"或"动作字符 hex"，
            // 直接点明「云端版本未同步」，并用 toast + console.error 双路径给出修复文件路径，
            // 便于开发者一眼定位到 NEWDL_execution_order/index.js 入口。
            const tip = '云端版本未同步(缺get_order_by_course_code等action)，请重新上传 NEWDL_execution_order';
            contentLines.push(tip);
            contentLines.push('提示：入口文件 cloudfunctions/NEW_DL_fun/NEWDL_execution_order/index.js 已改为 require(\'./dev_index.js\')，重新上传部署后生效。');
            wx.showModal({
              title: '协作查询入口异常',
              content: contentLines.join('\n'),
              showCancel: false
            });
            return;
          }
          if (debug.buildId) contentLines.push(`云端版本：${debug.buildId}`);
          contentLines.push(`服务端动作：${receivedAction || '<空>'}`);
          if (actionDiagnostic && actionDiagnostic.hex) {
            contentLines.push(`动作字符：hex=${actionDiagnostic.hex} len=${actionDiagnostic.length}`);
          }
          if (parsed && parsed.actionSource) {
            contentLines.push(`解析来源：${parsed.actionSource}`);
            if (parsed.httpMethod || parsed.path) contentLines.push(`请求：${parsed.httpMethod || '-'} ${parsed.path || '-'}`);
          }
          if (Array.isArray(supportedActions) && supportedActions.length) {
            contentLines.push(`支持动作前6项：${supportedActions.slice(0, 6).join('、')}`);
          }
          if (debug.errorName) {
            contentLines.push(`服务端异常: ${debug.errorName} - ${result.msg || ''}`);
          }
          wx.showModal({
            title: '协作查询入口异常',
            content: contentLines.join('\n'),
            showCancel: false
          });
          return;
        }

        if (result.code === 400) {
          const parsed = (debug && debug.parsed) ? debug.parsed : {};
          // 压缩 400 提示：去掉解析细节啰嗦描述
          const detail = parsed.actionSource ? `来源：${parsed.actionSource}` : '';
          wx.showModal({
            title: '云函数缺少 action',
            content: `${result.msg || '缺少动作参数'}${detail ? '；' + detail : ''}。请检查云函数版本与传参。`,
            showCancel: false
          });
          return;
        }

        if (result.code === 404) {
          wx.showToast({
            title: result.msg || '未找到对应课程码',
            icon: 'none'
          });
          return;
        }

        wx.showToast({
          title: result.msg || '未找到协作信息',
          icon: 'none'
        });
        return;
      }

      this.applyCollaborativeOrderToForm(result.data || {});
      // 新增：导入成功后立即锁定协作卡片；课程码继续在 view 显示，但输入框和按钮均不可操作，
      // 满足「导入后不要隐藏课程码 view（显示但不可操作）」的要求。
      this.setData({
        collaborationCardLocked: true
      });
      wx.showToast({
        title: '协作信息已带入',
        icon: 'success'
      });
    } catch (error) {
      console.error('[publish] [pullCollaborativeOrder] 拉取失败:', error);
      wx.showToast({
        title: '拉取失败',
        icon: 'none'
      });
    } finally {
      wx.hideLoading();
      this.setData({
        collaborationLoading: false
      });
    }
  },

  // 新增：协作辅助区的主流程快捷跳转。
  // 因为 pages/task/progress/progress 在 app.json tabBar.list 里（"课程管理"Tab），必须用 wx.switchTab 跳转，navigateTo 会失败。
  // 这里保留 switchTab → navigateTo → redirectTo 三级降级，避免未来 tabBar 调整或栈内场景不同时按钮变死链。
  goCollaborationQuickProgress() {
    const target = '/pages/task/progress/progress';
    const tryNavigate = (fallbackReason) => {
      console.info(`[publish] [goCollaborationQuickProgress] switchTab 失败，原因: ${fallbackReason}；降级 navigateTo`);
      wx.navigateTo({
        url: target,
        fail(err) {
          console.warn('[publish] [goCollaborationQuickProgress] navigateTo 也失败，降级 redirectTo:', err);
          wx.redirectTo({
            url: target,
            fail(lastErr) {
              console.error('[publish] [goCollaborationQuickProgress] 全部跳转方式失败:', lastErr);
              wx.showToast({
                title: '跳转失败，请手动切到课程管理Tab',
                icon: 'none'
              });
            }
          });
        }
      });
    };

    try {
      wx.switchTab({
        url: target,
        fail(err) {
          tryNavigate((err && err.errMsg) || 'switchTab reject');
        }
      });
    } catch (error) {
      tryNavigate(`sync switchTab throw: ${error && error.message ? error.message : error}`);
    }
  },

  // Select a class
  onSelectClass(e) {
    const id = e.currentTarget.dataset.id;
    if (id === this.data.currentClassId) return;

    const cls = this.data.classTypes.find(c => c.id === id);
    this.setData({
      currentClassId: id,
      currentClass: cls,
      selectedSubName: null // Reset sub-selection
    });

    // Auto-fill form description
    this.setData({
      'form.category': cls.name,
      'form.title': this.buildAutoCourseTitle(cls.name, ''),
      'form.sub_plan_name': '',
      'form.description': `我想学习${cls.name}，${cls.brief}。`,
      'form.course_plan': cls.planText || ''
    });
  },

  onSelectSubItem(e) {
    const { parentId, name } = e.currentTarget.dataset;
    const targetClass = this.data.classTypes.find(item => item.id === parentId);
    
    this.setData({
      currentClassId: parentId,
      currentClass: targetClass,
      selectedSubName: name
    });

    // Update form description
    this.setData({
      'form.category': targetClass.name,
      'form.title': this.buildAutoCourseTitle(targetClass.name, name),
      'form.sub_plan_name': name,
      'form.description': `我想学习${targetClass.name}，专项练习：${name}。`,
      'form.course_plan': (targetClass.subPlans && targetClass.subPlans[name]) || targetClass.planText || ''
    });
  },

  // ========== Input Binding ==========
  onInput(e) {
    const field = e.currentTarget.dataset.field;
    let value = e.detail.value;
    // 新增联系方式输入收口：创建班课程时输入阶段就限制为 11 位大陆手机号
    if (field === 'contact') {
      value = String(value || '').replace(/\D/g, '').slice(0, 11);
    }
    this.setData({
      [`form.${field}`]: value
    });
  },

  // 新增孩子表单输入：每个孩子独立编辑，互不覆盖
  onChildProfileInput(e) {
    const index = Number(e.currentTarget.dataset.index || 0);
    const field = String(e.currentTarget.dataset.field || '').trim();
    if (!field) {
      return;
    }

    const childProfiles = this.normalizeChildProfiles(this.data.form.child_profiles);
    let value = String((e.detail || {}).value || '');

    if (field === 'age') {
      value = value.replace(/\D/g, '');
    }

    childProfiles[index] = {
      ...(childProfiles[index] || { nickname: '', age: '', gender: '', height: '', weight: '' }),
      [field]: value
    };

    this.setData({
      'form.child_profiles': childProfiles
    });
  },

  // 新增手机号格式校验：创建班课程时统一按 11 位大陆手机号收口
  isValidPhone(value) {
    return /^1[3-9]\d{9}$/.test(String(value || '').trim());
  },

  // 新增教练私有字段：记录仅供内部查看的备注和是否允许流转
  onPrivateTransferChange(e) {
    this.setData({
      'form.allow_transfer_to_other_coach': !!e.detail.value
    });
  },

  // 新增安全与规范确认：发布前必须勾选
  onSafetyConfirmedChange(e) {
    this.setData({
      'form.safety_confirmed': !!e.detail.value
    });
  },

  // 新增课程人数收集：1对1 / 1对多
  onCourseSizeModeChange(e) {
    this.setData({
      'form.course_size_mode': e.detail.value || '1对1'
    });
  },

  // 新增孩子性别收集：作为教练内部建档信息
  onChildGenderChange(e) {
    const index = Number(e.currentTarget.dataset.index || 0);
    const childProfiles = this.normalizeChildProfiles(this.data.form.child_profiles);
    childProfiles[index] = {
      ...(childProfiles[index] || { nickname: '', age: '', gender: '', height: '', weight: '' }),
      gender: e.detail.value || ''
    };

    this.setData({
      'form.child_profiles': childProfiles
    });
  },

  // 新增孩子卡片操作：支持继续追加孩子资料
  addChildProfile() {
    const childProfiles = this.normalizeChildProfiles(this.data.form.child_profiles);
    childProfiles.push({ nickname: '', age: '', gender: '', height: '', weight: '' });
    this.setData({
      'form.child_profiles': childProfiles
    });
  },

  // 新增孩子卡片删除：删除到最后一个时允许回到 0 个，和默认态保持一致
  removeChildProfile(e) {
    const index = Number(e.currentTarget.dataset.index || 0);
    const childProfiles = this.normalizeChildProfiles(this.data.form.child_profiles);

    if (childProfiles.length <= 1) {
      this.setData({
        'form.child_profiles': []
      });
      return;
    }

    childProfiles.splice(index, 1);
    this.setData({
      'form.child_profiles': childProfiles
    });
  },

  handleDeleteCourse() {
    if (!this.data.canDeleteCourse) {
      // 压缩删课 toast：保留阶段+原因关键
      const inProgress = this.data.explicitFulfillState === 'in_progress';
      const awaiting = this.data.explicitFulfillState === 'awaiting';
      const msg = inProgress
        ? '进行中不能删课。'
        : (awaiting ? '待接取阶段已生成接取码，不能直接删课；请先重置接取码或在「待编辑」阶段删除。'
                    : '仅创建者在「待编辑」且未接取时可删课。');
      wx.showToast({ title: msg, icon: 'none' });
      return;
    }
    if (!this.data.orderId) {
      this.setData({
        form: {
          title: '',
          sub_plan_name: '',
          frequency: '',
          category: '',
          description: '',
          price_interval: '',
          location: '',
          group_rules: '',
          contact: '',
          course_size_mode: '1对1',
          safety_confirmed: false,
          course_plan: '',
          child_profiles: [],
          coach_private_note: '',
          allow_transfer_to_other_coach: false
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
              name: 'NEWDL_execution_order',
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
              wx.navigateBack();
              return;
            }

            wx.showToast({ title: result.result.msg || '删除失败', icon: 'none' });
          } catch (error) {
            wx.hideLoading();
            console.error('[publish] [handleDeleteCourse] 失败:', error);
            wx.showToast({ title: '网络错误', icon: 'none' });
          }
        }
      }
    });
  },

  openSetTotalModal() {
    if (!this.data.orderId) {
      wx.showToast({ title: '请先发布课程', icon: 'none' });
      return;
    }
    if (!this.data.canAdjustLessonPlan) {
      const inProgress = this.data.explicitFulfillState === 'in_progress';
      // 压缩设置总课时 toast：只保留身份+阶段关键
      wx.showToast({
        title: inProgress ? '进行中不可改总课时/课表。' : '仅创建者在「待编辑/待接取」可设总课时。',
        icon: 'none'
      });
      return;
    }

    // 新增三节锁定保护：累计记录满 3 节课后不允许再改总课时
    if (this.data.lessonPlanLocked) {
      wx.showToast({ title: '已记录满3节课，不能再修改', icon: 'none' });
      return;
    }

    // 新增总课时设置：直接控制下面应该生成多少个课节框
    this.setData({
      showSetTotalModal: true,
      setTotalLessonsInput: `${this.data.order.progress_total || 1}`
    });
  },

  openSyncModal() {
    if (!this.data.orderId) {
      wx.showToast({ title: '请先发布课程', icon: 'none' });
      return;
    }
    if (!this.data.canAdjustLessonPlan) {
      const inProgress = this.data.explicitFulfillState === 'in_progress';
      // 压缩半途接入 toast：保留阶段+身份关键
      wx.showToast({
        title: inProgress ? '进行中不可做半途接入。' : '仅创建者在「待编辑/待接取」可调课表。',
        icon: 'none'
      });
      return;
    }

    // 新增三节锁定保护：累计记录满 3 节课后不允许再改半途接入
    if (this.data.lessonPlanLocked) {
      wx.showToast({ title: '已记录满3节课，不能再修改', icon: 'none' });
      return;
    }

    const historyCount = (((this.data.order || {}).history_sync || {}).syncedCount) || (this.data.order.progress_done || 0);

    this.setData({
      showSyncModal: true,
      syncTotalLessonsInput: `${this.data.order.progress_total || 1}`,
      syncHistoryCountInput: `${historyCount || 0}`
    });
  },

  closeSyncModal() {
    this.setData({ showSyncModal: false });
  },

  // 新增总课时弹层关闭：单独设置完整课表时使用
  closeSetTotalModal() {
    this.setData({ showSetTotalModal: false });
  },

  handleSetTotalLessonsInput(e) {
    this.setData({ setTotalLessonsInput: e.detail.value });
  },

  handleSyncTotalLessonsInput(e) {
    this.setData({ syncTotalLessonsInput: e.detail.value });
  },

  handleSyncHistoryCountInput(e) {
    this.setData({ syncHistoryCountInput: e.detail.value });
  },

  async submitSetTotalLessons() {
    if (this.data.lessonPlanLocked) {
      wx.showToast({ title: '已记录满3节课，不能再修改', icon: 'none' });
      return;
    }

    const totalLessons = parseInt(this.data.setTotalLessonsInput, 10);

    if (!totalLessons || totalLessons < 1) {
      wx.showToast({ title: '总课时至少为1', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '保存中' });

    try {
      const token = wx.getStorageSync('token');
      const result = await wx.cloud.callFunction({
        name: 'NEWDL_execution_order',
        data: {
          action: 'sync_lesson_progress',
          orderId: this.data.orderId,
          userId: token,
          totalLessons,
          historyCount: 0,
          envVersion: app.globalData.miniEnvVersion || 'develop'
        }
      });

      wx.hideLoading();
      if (result.result.code === 0) {
        wx.showToast({ title: '课表已生成', icon: 'success' });
        this.closeSetTotalModal();
        this.fetchOrderDetails(this.data.orderId);
        return;
      }

      wx.showToast({ title: result.result.msg || '保存失败', icon: 'none' });
    } catch (error) {
      wx.hideLoading();
      console.error('[publish] [submitSetTotalLessons] 失败:', error);
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  async submitSyncLessonProgress() {
    if (this.data.lessonPlanLocked) {
      wx.showToast({ title: '已记录满3节课，不能再修改', icon: 'none' });
      return;
    }

    const totalLessons = parseInt(this.data.syncTotalLessonsInput, 10);
    const historyCount = parseInt(this.data.syncHistoryCountInput, 10);

    if (!totalLessons || totalLessons < 1) {
      wx.showToast({ title: '总课时至少为1', icon: 'none' });
      return;
    }

    if (Number.isNaN(historyCount) || historyCount < 0 || historyCount >= totalLessons) {
      wx.showToast({ title: '已完成课次不合法', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '保存中' });

    try {
      const token = wx.getStorageSync('token');
      const result = await wx.cloud.callFunction({
        name: 'NEWDL_execution_order',
        data: {
          action: 'sync_lesson_progress',
          orderId: this.data.orderId,
          userId: token,
          totalLessons,
          historyCount,
          envVersion: app.globalData.miniEnvVersion || 'develop'
        }
      });

      wx.hideLoading();
      if (result.result.code === 0) {
        wx.showToast({ title: '补录成功', icon: 'success' });
        this.closeSyncModal();
        this.fetchOrderDetails(this.data.orderId);
        return;
      }

      wx.showToast({ title: result.result.msg || '补录失败', icon: 'none' });
    } catch (error) {
      wx.hideLoading();
      console.error('[publish] [submitSyncLessonProgress] 失败:', error);
      wx.showToast({ title: '补录失败', icon: 'none' });
    }
  },

  handleLessonAction(e) {
    // 旧课节状态推进入口保留注释，不删除；当前页面不再允许通过前端触发开始上课/下课
    /*
    const datasetIndex = e.currentTarget.dataset.index;
    const index = datasetIndex === undefined ? this.data.selectedLessonIndex : Number(datasetIndex);
    const subAction = e.currentTarget.dataset.subaction;
    const lesson = this.data.schedule[index];

    if (!lesson || !subAction) {
      return;
    }

    let confirmContent = '确认执行此操作吗？';
    if (subAction === 'coach_ready') confirmContent = '确认开始上课？';
    if (subAction === 'coach_complete') confirmContent = '确认下课？';

    wx.showModal({
      title: '提示',
      content: confirmContent,
      success: async (res) => {
        if (!res.confirm) {
          return;
        }

        wx.showLoading({ title: '处理中' });
        try {
          const result = await wx.cloud.callFunction({
            name: 'NEWDL_execution_order',
            data: {
              action: 'lesson_handshake',
              orderId: this.data.orderId,
              lessonIndex: lesson.lesson || (index + 1),
              subAction,
              envVersion: app.globalData.miniEnvVersion || 'develop'
            }
          });

          wx.hideLoading();
          if (result.result.code === 0) {
            wx.showToast({ title: '操作成功' });
            this.fetchOrderDetails(this.data.orderId);
            return;
          }

          wx.showToast({ title: result.result.msg || '操作失败', icon: 'none' });
        } catch (error) {
          wx.hideLoading();
          console.error('[publish] [handleLessonAction] 失败:', error);
          wx.showToast({ title: '网络错误', icon: 'none' });
        }
      }
    });
    */

    wx.showToast({ title: '课节状态推进已下线', icon: 'none' });
  },

  // 新增课节管理选择：选中当前要操作的课节
  selectManageLesson(e) {
    if (Number(e.currentTarget.dataset.history || 0) === 1) {
      return;
    }
    const index = Number(e.currentTarget.dataset.index || 0);
    const lesson = this.data.schedule[index] || {};
    const dimensionRatings = this.buildSummaryDimensionRatingsFromLesson(lesson);
    this.setData({
      ...this.buildLessonScrollViewState(index),
      summaryInput: lesson.summary || '',
      ...this.buildSummaryTimeEditorData(lesson)
    });
    this.applySummaryDimensionRatings(dimensionRatings);
  },

  selectSummaryLesson(e) {
    const index = Number(e.currentTarget.dataset.index || 0);
    const lesson = this.data.schedule[index] || {};
    const dimensionRatings = this.buildSummaryDimensionRatingsFromLesson(lesson);
    this.setData({
      selectedTab: 'summary',
      ...this.buildLessonScrollViewState(index),
      summaryInput: lesson.summary || '',
      ...this.buildSummaryTimeEditorData(lesson)
    });
    this.applySummaryDimensionRatings(dimensionRatings);
  },

  handleSummaryInput(e) {
    this.setData({ summaryInput: e.detail.value });
  },

  // 新增结课输入：记录面向家长/课程的结语内容
  handleCloseSummaryInput(e) {
    this.setData({ closeSummaryInput: e.detail.value });
  },

  // 新增结课教练备注：仅在教练管理页内部可见，不对外展示
  handleCloseCoachNoteInput(e) {
    this.setData({ closeCoachNoteInput: e.detail.value });
  },

  // 新增总结日期选择：上下课时间默认共用同一天，便于一小时自动推算
  handleSummaryDateChange(e) {
    this.setData({ summaryDate: e.detail.value });
  },

  // 新增上课时间选择：只有下课时间还没填时，才按默认 60 分钟补一次；后续手动改时间不再强制联动
  handleSummaryStartTimeChange(e) {
    const summaryStartTime = e.detail.value;
    const summaryDate = this.data.summaryDate || this.formatPickerDate(new Date());
    const nextData = {
      summaryDate,
      summaryStartTime
    };

    if (!this.data.summaryEndTime) {
      const shifted = this.shiftSummaryTime(summaryDate, summaryStartTime, 60);
      nextData.summaryEndTime = shifted.time || this.data.summaryEndTime;
      nextData.summaryTimeAutoFilled = true;
    } else {
      nextData.summaryTimeAutoFilled = false;
    }

    this.setData(nextData);
  },

  // 新增下课时间选择：只有上课时间还没填时，才按默认 60 分钟反推一次；后续手动改时间不再强制联动
  handleSummaryEndTimeChange(e) {
    const summaryEndTime = e.detail.value;
    const summaryDate = this.data.summaryDate || this.formatPickerDate(new Date());
    const nextData = {
      summaryDate,
      summaryEndTime
    };

    if (!this.data.summaryStartTime) {
      const shifted = this.shiftSummaryTime(summaryDate, summaryEndTime, -60);
      nextData.summaryDate = shifted.date || summaryDate;
      nextData.summaryStartTime = shifted.time || this.data.summaryStartTime;
      nextData.summaryTimeAutoFilled = true;
    } else {
      nextData.summaryTimeAutoFilled = false;
    }

    this.setData(nextData);
  },

  // 新增时长手动输入：支持直接录入 90/120 等分钟数，并自动联动开始/结束时间
  handleSummaryDurationInput(e) {
    const rawValue = String(e.detail.value || '').replace(/[^\d]/g, '');
    const summaryDurationMinutes = rawValue.slice(0, 4);
    const durationMinutes = this.parseSummaryDurationMinutes(summaryDurationMinutes);
    const summaryDate = this.data.summaryDate || this.formatPickerDate(new Date());
    const nextData = {
      summaryDurationMinutes
    };

    if (durationMinutes > 0) {
      nextData.summaryDate = summaryDate;
      if (this.data.summaryStartTime) {
        const shifted = this.shiftSummaryTime(summaryDate, this.data.summaryStartTime, durationMinutes);
        nextData.summaryEndTime = shifted.time || this.data.summaryEndTime;
      } else if (this.data.summaryEndTime) {
        const shifted = this.shiftSummaryTime(summaryDate, this.data.summaryEndTime, -durationMinutes);
        nextData.summaryStartTime = shifted.time || this.data.summaryStartTime;
      }
    }

    this.setData(nextData);
  },

  async saveSummary() {
    if (!this.data.canWriteSummary) {
      // 压缩写总结 toast：保留阶段+身份关键
      const inProgress = this.data.explicitFulfillState === 'in_progress';
      const msg = inProgress
        ? '进行中仅接取教练可填总结。'
        : '当前身份不可填总结；未接取阶段需创建者身份。';
      wx.showToast({ title: msg, icon: 'none' });
      return;
    }
    if (!this.data.orderId) {
      wx.showToast({ title: '请先发布课程', icon: 'none' });
      return;
    }

    const lesson = this.data.schedule[this.data.summaryLessonIndex];
    if (!lesson) {
      wx.showToast({ title: '请选择课节', icon: 'none' });
      return;
    }

    const summaryInput = (this.data.summaryInput || '').trim();
    if (!summaryInput) {
      wx.showToast({ title: '请先填写总结内容', icon: 'none' });
      return;
    }

    const summaryDimensionRatings = this.normalizeSummaryDimensionRatings(this.data.summaryDimensionRatings);
    const summaryRating = this.buildAverageSummaryRating(summaryDimensionRatings);
    const summaryRatingTags = this.buildSummaryRatingTagsFromDimensions(summaryDimensionRatings);
    if (!summaryRatingTags.length) {
      wx.showToast({ title: '多维评分至少选一个', icon: 'none' });
      return;
    }

    if (!this.data.summaryDate) {
      wx.showToast({ title: '请选择上课日期', icon: 'none' });
      return;
    }
    if (!this.data.summaryStartTime) {
      wx.showToast({ title: '请选择上课时间', icon: 'none' });
      return;
    }
    if (!this.data.summaryEndTime) {
      wx.showToast({ title: '请选择下课时间', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '保存中' });
    try {
      const startedAt = this.buildLessonDateTime(this.data.summaryDate, this.data.summaryStartTime);
      const completedAt = this.buildLessonDateTime(this.data.summaryDate, this.data.summaryEndTime);
      // 新增时间先后校验：避免把同一天里“下课早于上课”的无效课节时间直接存入数据库
      if (startedAt && completedAt) {
        const startedAtTime = new Date(startedAt).getTime();
        const completedAtTime = new Date(completedAt).getTime();
        if (Number.isFinite(startedAtTime) && Number.isFinite(completedAtTime) && completedAtTime <= startedAtTime) {
          wx.hideLoading();
          wx.showToast({ title: '下课时间需晚于上课时间', icon: 'none' });
          return;
        }
      }

      const lessonContent = {
        summary: summaryInput,
        // 新增总结日期保存：已完成状态依赖“总结内容 + 上课日期”同时存在
        summaryDate: this.data.summaryDate,
        // 新增评分与标签保存：多维评分自动汇总总分，并保留每个维度的分数
        rating: summaryRating,
        ratingTags: summaryRatingTags,
        dimensionRatings: summaryDimensionRatings
      };

      // 新增上下课时间保存：填写了时间就和总结一起落到当前课节里
      if (startedAt) {
        lessonContent.startedAt = startedAt;
      }
      if (completedAt) {
        lessonContent.completedAt = completedAt;
      }

      const result = await wx.cloud.callFunction({
        name: 'NEWDL_execution_order',
        data: {
          action: 'update_lesson_content',
          orderId: this.data.orderId,
          lessonIndex: lesson.lesson || (this.data.summaryLessonIndex + 1),
          content: lessonContent,
          envVersion: app.globalData.miniEnvVersion || 'develop'
        }
      });

      wx.hideLoading();
      if (result.result.code === 0) {
        wx.showToast({ title: '保存成功', icon: 'success' });
        const targetLesson = {
          ...lesson,
          summary: summaryInput,
          summaryDate: this.data.summaryDate,
          rating: summaryRating,
          ratingTags: summaryRatingTags,
          dimensionRatings: summaryDimensionRatings,
          startedAt: startedAt || lesson.startedAt,
          completedAt: completedAt || lesson.completedAt
        };
        const lessonStr = encodeURIComponent(JSON.stringify(targetLesson));
        const lessonIndex = this.data.summaryLessonIndex;
        const lessonNo = targetLesson.lesson || (lessonIndex + 1);

        // 新增保存后跳转：总结保存成功后直接进入对应课节详情页，详情页会自行刷新最新数据
        setTimeout(() => {
          wx.navigateTo({
            url: `/pages/task/progress/progress_specialOperation/progress_classdetailed/progress_classdetailed?lesson=${lessonStr}&index=${lessonIndex}&lessonNo=${lessonNo}&orderId=${this.data.orderId}&sourcePage=publish_summary`
          });
        }, 300);
        return;
      }

      wx.showToast({ title: result.result.msg || '保存失败', icon: 'none' });
    } catch (error) {
      wx.hideLoading();
      console.error('[publish] [saveSummary] 失败:', error);
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  // 新增结课提交：先填写结语和教练备注，再真正把课程状态改成 closed
  async submitCloseCourse() {
    if (!this.data.canCloseCourse) {
      wx.showToast({ title: '只有课程发布者才能结课', icon: 'none' });
      return;
    }
    if (!this.data.orderId) {
      wx.showToast({ title: '请先进入已有班级', icon: 'none' });
      return;
    }

    const closeSummary = (this.data.closeSummaryInput || '').trim();
    const closeCoachNote = (this.data.closeCoachNoteInput || '').trim();

    if (!closeSummary) {
      wx.showToast({ title: '请先填写结课结语', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '确认结课',
      // 压缩结课确认：保留结果
      content: '确认提交结课？提交后课程变为 closed 状态。',
      success: async (res) => {
        if (!res.confirm) {
          return;
        }

        wx.showLoading({ title: '处理中' });
        try {
          const token = wx.getStorageSync('token');
          const result = await wx.cloud.callFunction({
            name: 'NEWDL_execution_order',
            data: {
              action: 'close',
              orderId: this.data.orderId,
              userId: token,
              closeSummary,
              closeCoachNote,
              envVersion: app.globalData.miniEnvVersion || 'develop'
            }
          });

          wx.hideLoading();
          if (result.result.code === 0) {
            wx.showToast({ title: '结课成功', icon: 'success' });
            this.fetchOrderDetails(this.data.orderId);
            return;
          }

          wx.showToast({ title: result.result.msg || '结课失败', icon: 'none' });
        } catch (error) {
          wx.hideLoading();
          console.error('[publish] [submitCloseCourse] 失败:', error);
          wx.showToast({ title: '网络错误', icon: 'none' });
        }
      }
    });
  },

  handleToProgressDisplay() {
    if (!this.data.orderId) {
      return;
    }

    wx.navigateTo({
      url: `/pages/task/progress/progress_specialOperation/progress_specialOperation?id=${this.data.orderId}`
    });
  },

  // ========== Submit ==========
  onSubmit() {
    if (!this.data.canEditCourseInfo) {
      // 压缩提交编辑 toast：保留阶段+身份关键
      const inProgress = this.data.explicitFulfillState === 'in_progress';
      const msg = inProgress
        ? '进行中课程资料已锁定。'
        : '仅创建者在「待编辑/待接取」可编辑班级资料。';
      wx.showToast({ title: msg, icon: 'none' });
      return;
    }
    if (this.data.isSubmitting) return;

    const rawForm = this.data.form;
    const safeSubPlanName = rawForm.sub_plan_name || this.data.selectedSubName || '';
    const safeTitle = rawForm.title || this.buildAutoCourseTitle(rawForm.category || ((this.data.currentClass || {}).name || ''), safeSubPlanName);
    const safeForm = {
      ...rawForm,
      title: safeTitle,
      sub_plan_name: safeSubPlanName
    };
    const publishType = '发布看看';

    console.log(`[publish_pdd] [onSubmit] 开始发布, 类型: ${publishType}`);

    // 1. Validation
    if (!safeForm.location) {
      wx.showToast({ title: '请选择任务位置', icon: 'none' });
      return;
    }
    if (!safeForm.contact || !String(safeForm.contact).trim()) {
      wx.showToast({ title: '请填写联系方式', icon: 'none' });
      return;
    }
    if (!this.isValidPhone(safeForm.contact)) {
      wx.showToast({ title: '请填写正确的11位手机号', icon: 'none' });
      return;
    }
    // 临时注释必填校验：上面的 agreement-card 已按需求隐藏，如果这里继续拦截会导致页面无法提交
    // if (!rawForm.safety_confirmed) {
    //   wx.showToast({ title: '请先勾选安全与规范', icon: 'none' });
    //   return;
    // }

    const token = wx.getStorageSync('token');
    // 新增环境版本透传：云函数按 develop/trial/release 自动切换集合前缀
    const runtimeEnvVersion = app.globalData.miniEnvVersion || 'develop';
    
    // 2. Build submit data
    const groupedForm = this.buildGroupedSubmitForm(safeForm);
    const firstChildProfile = (groupedForm.child_profiles || [])[0] || { nickname: '', age: '', gender: '', height: '', weight: '' };
    const orderOrganizationInfo = this.buildOrderOrganizationInfo();
    const submitForm = {
      ...safeForm,
      ...groupedForm,
      // 兼容旧字段：继续把第一个孩子平铺到老字段里，避免旧展示链路直接空掉
      child_nickname: firstChildProfile.nickname || '',
      child_age: firstChildProfile.age || '',
      child_gender: firstChildProfile.gender || '',
      child_height: firstChildProfile.height || '',
      child_weight: firstChildProfile.weight || '',
      publish_type: publishType,
      // MVP: 发布后直接进入执行流程；当前所有全新班级统一默认 10 节课
      // 如果教练后续发现这门课前面其实已经上过几节，再去“课节管理”里使用“半途接入”补录历史进度
      class_count: (this.data.currentClass && this.data.currentClass.defaultLessons) || DEFAULT_CLASS_LESSON_COUNT,
      usertoken: token || 'guest_token',
      userInfo: app.globalData.userInfo || { nickName: '发布者', avatarUrl: '' },
      create_time: new Date().toISOString()
    };

    if (orderOrganizationInfo.orgId) {
      // 新增机构课程归属：机构管理层建课时把 orgId 一起提交，后端据此回写 organization_class.class_id_list
      submitForm.order_org_info = orderOrganizationInfo;
      submitForm.orgId = orderOrganizationInfo.orgId;
      submitForm.orgName = orderOrganizationInfo.orgName;
      submitForm.orgMemberRole = orderOrganizationInfo.memberRole;
    }

    // 新增：如果这一单是从"协作码导入（家长 M 码）"路径带进的表单，
    // 则把 get_order_by_course_code 找到的那条 B 原始追踪信息一起挂进 submitForm，
    // 云端 publishOrder 会直接原样透传到这次新建的 A 管理课程文档上——
    // 严格遵循产品约定："发布课程而不是去数据库里面找已有课程做修改"。
    // collaborationMatchedOrderId 仅作为关联引用，不被当成 this.data.orderId，因此 onSubmit
    // 走到的一定是 action='publish'（新增），不会切到 update_order（修改旧桥订单）。
    const hasBBridgeTrace = Boolean(
      this.data.collaborationOriginalFromBCourseId
      || this.data.collaborationOriginalFromBFormId
      || this.data.collaborationOriginalFromBOpenid
      || this.data.collaborationMatchedOrderId
    );
    if (hasBBridgeTrace) {
      submitForm.from_b_course_id = String(this.data.collaborationOriginalFromBCourseId || '').trim();
      submitForm.from_b_form_id = String(this.data.collaborationOriginalFromBFormId || '').trim();
      submitForm.from_b_openid = String(this.data.collaborationOriginalFromBOpenid || '').trim();
      submitForm.bridge_status = String(this.data.collaborationOriginalBridgeStatus || BRIDGE_STATUS_LINKED_BY_COLLAB).trim() || BRIDGE_STATUS_LINKED_BY_COLLAB;
      // 协作导入场景下的 source：
      // - 如果查询到的原桥订单本身就是 B 约课同步过来的 (SOURCE_FROM_B_PARENT/bridged_from_b)，
      //   前端沿用同一个语义，保持"这一单本质是 B 家长约课带过来的"识别位。
      // - 如果没带 source，兜底用 LINKED_BY_COLLAB 字符串，后端识别为通过协作码关联的衍生课。
      const importedSource = String(this.data.collaborationOriginalSource || '').trim();
      submitForm.source = importedSource || 'LINKED_BY_COLLAB';
      // 协作码查询命中的那条桥订单 ID（不是前端正在编辑的 orderId，是被导入的"源桥单"），
      // 一起挂进 other_info，便于日后追溯"这个 A 课是从哪条 B 桥单 / 哪个家长带过来的"。
      const linkedOrderMeta = {
        linked_collaboration_order_id: String(this.data.collaborationMatchedOrderId || '').trim(),
        linked_collaboration_parent_course_code: String(this.data.collaborationOriginalParentCourseCode || '').trim(),
        linked_collaboration_code_displayed: String(this.data.collaborationCode || '').trim(),
        linked_via: 'collaboration_input_row'
      };
      submitForm.other_info = {
        ...(submitForm.other_info || {}),
        linked_collaboration_meta: linkedOrderMeta
      };
      // 兼容：把 linked_collaboration_meta 也同步写到顶层 imported_target_snapshot，
      // 保持旧链路 twowaybinding 写的 other_info.imported_target_snapshot 结构同类，便于 DLforP 那边回查。
      if (submitForm.other_info && !submitForm.other_info.imported_target_snapshot) {
        submitForm.other_info.imported_target_snapshot = { ...linkedOrderMeta };
      }
    }

    // 3. Submit to cloud
    this.setData({ isSubmitting: true });
    wx.showLoading({ title: '发布中...' });
    
    wx.cloud.callFunction({
      name: 'NEWDL_execution_order',
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
        console.log('[publish_pdd] [onSubmit] 发布结果:', res);
        
        const result = res.result || {};
        if (result.code === 0 || result.status === 'success' || result._id) {
            console.log(`[publish_pdd] [onSubmit] 发布成功, OrderID: ${result.orderId || result._id}`);
            if (app.saveUserIdentity) {
              app.saveUserIdentity({
                userRole: 'C',
                needChooseRole: false
              });
            }
            wx.showToast({ title: this.data.isEditMode ? '修改成功' : '发布成功' });
            
            setTimeout(() => {
              const targetId = result.orderId || result._id;
              if (targetId) {
                  // 新增发布后留在教练操作台：直接进入课节管理 tab
                  wx.redirectTo({
                      url: `/pages/task/publish/publish?id=${targetId}&tab=manage`
                  });
              } else {
                  wx.navigateBack();
              }
            }, 1500);
          } else {
          this.setData({ isSubmitting: false });
          console.error(`[publish_pdd] [onSubmit] 发布失败: ${result.msg}`);
          wx.showToast({ 
            title: result.msg || '发布失败，请重试', 
            icon: 'none' 
          });
        }
      },
      fail: (err) => {
        wx.hideLoading();
        this.setData({ isSubmitting: false });
        console.error('[publish_pdd] [onSubmit] 网络请求失败:', err);
        wx.showToast({ title: '网络请求失败', icon: 'none' });
      }
    });
  },

  // 新增：复制「完整接取码（12 位）」到系统剪贴板，方便发布者直接发给执行教练。
  // 只允许在已有课程（编辑态 / orderId 存在）下操作，新建课程发布前还没生成码。
  onCopyPickupFullCode() {
    if (!this.data.canOperatePickupCode) {
      const inProgress = this.data.explicitFulfillState === 'in_progress';
      // 压缩接取码操作 toast：保留阶段+身份关键
      const msg = inProgress
        ? '进行中接取码仅可查看。'
        : '仅创建者在「待编辑/待接取」可复制/重置接取码。';
      wx.showToast({ title: msg, icon: 'none' });
      return;
    }
    const targetId = this.data.orderId || '';
    const fullCode = String(this.data.pickupFullCode || '').trim();
    if (!targetId) {
      wx.showToast({ title: '课程创建后才有接取码', icon: 'none' });
      return;
    }
    if (fullCode.length !== 12) {
      wx.showToast({ title: '接取码数据不完整，请下拉刷新重试', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: fullCode,
      success: () => {
        wx.showToast({ title: '12 位接取码已复制', icon: 'success' });
      },
      fail: () => {
        wx.showToast({ title: '复制失败，请手动抄写', icon: 'none' });
      }
    });
  },

  // 新增：12 位接取码改成由小程序 A 管理层在 publish 页面手动确认后才生成。
  // 这里不改 8 位课程码，只补生成后 4 位确认码和完整 12 位码。
  onConfirmGeneratePickupCode() {
    // 新增：生成接取码只能在 editing + 本人。
    // awaiting（已生成 12 位码的待接取阶段）虽然仍可补资料/调课节，但不再重复“生成接取码”，只能重置。
    if (!this.data.canGeneratePickupCode) {
      const inProgress = this.data.explicitFulfillState === 'in_progress';
      const awaiting = this.data.explicitFulfillState === 'awaiting';
      // 压缩生成接取码 toast：保留阶段关键信息
      const msg = inProgress
        ? '进行中不可再生接取码。'
        : (awaiting ? '「待接取」阶段接取码已生成；如需更换，请点「重置接取码」。'
                    : '仅创建者在「待编辑」阶段可生成接取码。');
      wx.showToast({ title: msg, icon: 'none' });
      return;
    }
    const targetId = this.data.orderId || '';
    if (!targetId) {
      wx.showToast({ title: '请先创建课程', icon: 'none' });
      return;
    }
    if (this.data.pickupFullCode) {
      wx.showToast({ title: '这门课已经生成过接取码', icon: 'none' });
      return;
    }
    if (this.data.isResettingPickupCode) {
      // 修复点击无反应：原来直接 return 导致用户在生成/重置期间再点按钮时"完全没反馈"，
      // 现在改成弹 toast 明确告知当前正在处理，消除"点了没反应"的错觉。
      wx.showToast({ title: '正在处理，请稍候', icon: 'none' });
      return;
    }
    // 新增：前端再次兜底——未先点「完成课程信息编辑，允许教练接单」时，
    // 直接 toast 提示先走第一步，不发起 confirm_generate_pickup_code 请求；
    // 即使前端按钮 disabled 被绕过，后端 confirm_generate_pickup_code 仍有 course_info_ready_at 强校验，保证双保险。
    if (!this.data.pickupCourseInfoReady) {
      // 压缩未走第一步提示：直接说明动作，不重复按钮字面
      wx.showToast({ title: '请先点「允许教练接单」', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认生成 12 位接取码？',
      // 压缩确认 Modal：保留生成后效果 + 下一步队列
      content: '确认后生成 4 位确认码并拼成 12 位完整接取码；课程进入【待接取】队列等待执行教练。',
      confirmText: '确认生成',
      cancelText: '再想想',
      success: (modalRes) => {
        if (!modalRes.confirm) return;
        this.setData({ isResettingPickupCode: true });
        wx.showLoading({ title: '生成接取码中...' });
        const app = getApp();
        const token = (app && app.globalData && app.globalData.userToken) || '';
        const miniEnvVersion = (app && app.globalData) ? (app.globalData.miniEnvVersion || 'develop') : 'develop';
        wx.cloud.callFunction({
          name: 'NEWDL_execution_order',
          data: {
            action: 'confirm_generate_pickup_code',
            orderId: targetId,
            userId: token,
            userRole: 'C',
            envVersion: miniEnvVersion
          },
          success: (res) => {
            wx.hideLoading();
            const result = res && res.result ? res.result : {};
            if (result.code === 0) {
              this.setData({
                pickupConfirmCode: String(result.pickupConfirmCode || '').trim(),
                pickupFullCode: String(result.pickupFullCode || '').trim(),
                pickupFinalCode: '',
                isResettingPickupCode: false
              });
              // 新增：管理层确认生成 12 位接取码后，成功提示同时告诉用户两件事：
              // 1) 完整的 12 位码（前 8 班级码 + 后 4 确认码，用空格分隔便于人眼核对）；
              // 2) 后端已经把这门课推进到「待接取」状态，去课程管理页的「待接取」Tab 就能看到它。
              const nextFullCode = String(result.pickupFullCode || '').trim();
              const displayFull = nextFullCode.length === 12
                ? `${nextFullCode.slice(0, 8)} ${nextFullCode.slice(8, 12)}`
                : nextFullCode;
              // 压缩生成成功 Modal：保留接取码 + 状态 + 复制引导
              wx.showModal({
                title: '接取码已生成',
                content: `${displayFull}\n课程已进入【待接取】，可在课程管理页看到。是否立刻复制给执行教练？`,
                confirmText: '立即复制',
                cancelText: '知道了',
                success: (copyModal) => {
                  if (copyModal.confirm && nextFullCode.length === 12) {
                    wx.setClipboardData({
                      data: nextFullCode,
                      success: () => wx.showToast({ title: '12 位接取码已复制', icon: 'success' }),
                      fail: () => wx.showToast({ title: '复制失败，请手动抄写', icon: 'none' })
                    });
                  }
                }
              });
            } else {
              this.setData({ isResettingPickupCode: false });
              wx.showToast({ title: result.msg || '生成失败，请稍后重试', icon: 'none' });
            }
          },
          fail: (err) => {
            wx.hideLoading();
            this.setData({ isResettingPickupCode: false });
            console.error('[publish] confirm generate pickup code fail:', err);
            wx.showToast({ title: '网络错误，请稍后重试', icon: 'none' });
          }
        });
      }
    });
  },

  // 新增：publish 页「第一步：完成课程信息编辑，允许教练接单」按钮。
  // 点击后先做前端最轻量的基础校验（标题、手机号、地点、总课时），再弹二次确认避免误触；
  // 成功后写 course_info_ready_at，同时把 pickupCourseInfoReady 置 true 以解锁第二步的生成 12 位接取码按钮。
  // 即使前端校验被绕过，后端 markCourseInfoReady 内部也会再做同样的必填检查 + 发布者权限校验，保证双保险。
  onMarkCourseInfoReady() {
    // 新增：mark_ready 只能在 editing + 本人；awaiting/in_progress 已经过了这一步，不再允许重复点。
    if (!this.data.canMarkCourseInfoReady) {
      const inProgress = this.data.explicitFulfillState === 'in_progress';
      const awaiting = this.data.explicitFulfillState === 'awaiting';
      // 压缩 mark_ready toast：保留阶段关键
      const msg = inProgress
        ? '进行中不可改「允许教练接单」状态。'
        : (awaiting ? '「待接取」阶段已确认过允许接单，无需再操作。'
                    : '仅创建者在「待编辑」阶段可允许教练接单。');
      wx.showToast({ title: msg, icon: 'none' });
      return;
    }
    const targetId = this.data.orderId || '';
    if (!targetId) {
      wx.showToast({ title: '请先创建课程', icon: 'none' });
      return;
    }
    if (this.data.isMarkingCourseInfoReady || this.data.isResettingPickupCode) {
      // 修复点击无反应：之前直接 return 无任何提示，用户以为按钮没触发。
      // 改为弹 toast 明确告知当前处于请求处理中，避免重复点击产生"点了没反应"的感受。
      wx.showToast({ title: '正在处理，请稍候再试', icon: 'none' });
      return;
    }
    const form = this.data.form || {};
    const courseBasic = form.course_basic || {};
    const courseTarget = form.course_target || {};
    const title = String(courseTarget.title || form.title || this.data.title || '').trim();
    const contact = String(
      courseBasic.contact
      || form.contact
      || this.data.contact
      || this.data.collaborationContactText
      || ''
    ).trim();
    const location = String(
      courseBasic.location
      || form.location
      || this.data.location
      || this.data.collaborationLocationText
      || ''
    ).trim();
    const totalLessons = Number(
      (this.data.setTotalLessonsInput && Number(this.data.setTotalLessonsInput))
      || (form.class_count || this.data.class_count || 0)
    ) || 0;
    if (!title) {
      wx.showToast({ title: '请先补充课程标题', icon: 'none' });
      return;
    }
    if (!/^1[3-9]\d{9}$/.test(contact)) {
      wx.showToast({ title: '请先填写正确的 11 位联系电话', icon: 'none' });
      return;
    }
    if (!location) {
      wx.showToast({ title: '请先填写上课地点', icon: 'none' });
      return;
    }
    if (totalLessons <= 0) {
      wx.showToast({ title: '请先排好至少 1 节课时', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认允许教练接单？',
      // 压缩确认弹窗：保留解锁效果 + 进入队列路径
      content: '确认后解锁「生成 12 位接取码」按钮；生成后课程进入【待接取】队列，教练可输接取码接单。',
      confirmText: '确认允许接单',
      cancelText: '再改改',
      success: (modalRes) => {
        if (!modalRes.confirm) return;
        this.setData({ isMarkingCourseInfoReady: true });
        wx.showLoading({ title: '确认资料中...' });
        const app = getApp();
        const token = (app && app.globalData && app.globalData.userToken) || '';
        const miniEnvVersion = (app && app.globalData) ? (app.globalData.miniEnvVersion || 'develop') : 'develop';
        wx.cloud.callFunction({
          name: 'NEWDL_execution_order',
          data: {
            action: 'mark_course_info_ready',
            orderId: targetId,
            userId: token,
            userRole: 'C',
            envVersion: miniEnvVersion
          },
          success: (res) => {
            wx.hideLoading();
            const result = res && res.result ? res.result : {};
            if (result.code === 0) {
              const readyAt = result.courseInfoReadyAt ? ((new Date(result.courseInfoReadyAt)).toLocaleString()) : (this.data.pickupCourseInfoReadyAt || '');
              this.setData({
                isMarkingCourseInfoReady: false,
                pickupCourseInfoReady: true,
                pickupCourseInfoReadyAt: readyAt
              });
              if (result.alreadyReady) {
                wx.showToast({ title: '已确认过，已解锁接取码', icon: 'success' });
              } else {
                wx.showToast({ title: '确认成功，现在可以生成接取码', icon: 'success' });
              }
            } else {
              this.setData({ isMarkingCourseInfoReady: false });
              wx.showModal({
                title: '确认失败',
                content: result.msg || '确认失败，请稍后重试',
                showCancel: false,
                confirmText: '知道了'
              });
            }
          },
          fail: (err) => {
            wx.hideLoading();
            this.setData({ isMarkingCourseInfoReady: false });
            console.error('[publish] mark course info ready fail:', err);
            wx.showToast({ title: '网络错误，请稍后重试', icon: 'none' });
          }
        });
      }
    });
  },

  // 新增：发布者点击重置 4 位确认码，旧完整接取码失效。
  // 二次确认后，调用 reset_pickup_confirm_code；成功后把新码回填 data，并提示复制新码给新教练。
  onResetPickupConfirmCode(e) {
    // 新增：重置接取码允许在 editing + awaiting（管理者本人）。
    // 进行中之后教练已接取，管理者全部锁死，不能再换码。
    if (!this.data.canResetPickupCode) {
      const inProgress = this.data.explicitFulfillState === 'in_progress';
      // 压缩重置 toast：保留阶段+身份关键
      const msg = inProgress
        ? '进行中教练已接取，不可重置接取码。'
        : '仅创建者在「待编辑/待接取」可重置接取码。';
      wx.showToast({ title: msg, icon: 'none' });
      return;
    }
    const targetId = this.data.orderId || '';
    if (!targetId) {
      wx.showToast({ title: '课程创建后才能重置', icon: 'none' });
      return;
    }
    const keepCoach = !!((e && e.currentTarget && e.currentTarget.dataset) ? e.currentTarget.dataset.keepCoach : false);
    // 压缩重置确认框文案：保留核心效果，不重复长句
    const modalTitle = keepCoach ? '保留教练并更换确认码？' : '重置确认码并清空教练？';
    const modalContent = keepCoach
      ? '生成新 4 位确认码，教练不变；旧完整接取码作废。'
      : '生成新 4 位确认码并清空已接取教练；旧完整接取码作废。';
    wx.showModal({
      title: modalTitle,
      content: modalContent,
      confirmText: '确认重置',
      cancelText: '再想想',
      success: (modalRes) => {
        if (!modalRes.confirm) return;
        if (this.data.isResettingPickupCode) {
          // 修复点击无反应：原来直接 return 无任何提示，用户可能在重置期间连点两次却什么都没看到。
          // 增加 toast 反馈，明确告知"正在处理中"。
          wx.showToast({ title: '正在更换确认码，请稍候', icon: 'none' });
          return;
        }
        this.setData({ isResettingPickupCode: true });
        wx.showLoading({ title: '更换确认码中...' });
        const app = getApp();
        const token = (app && app.globalData && app.globalData.userToken) || '';
        const miniEnvVersion = (app && app.globalData) ? (app.globalData.miniEnvVersion || 'develop') : 'develop';
        wx.cloud.callFunction({
          name: 'NEWDL_execution_order',
          data: {
            action: 'reset_pickup_confirm_code',
            orderId: targetId,
            userId: token,
            userRole: 'C',
            envVersion: miniEnvVersion,
            keepCoach: !!keepCoach
          },
          success: (res) => {
            wx.hideLoading();
            const result = res && res.result ? res.result : {};
            if (result.code === 0) {
              const newFullCode = String(result.pickupFullCode || '').trim();
              const newConfirmCode = String(result.pickupConfirmCode || '').trim();
              const newFinalCode = String(result.pickupFinalCode || '').trim();
              const nextAssignedCoach = keepCoach ? (this.data.assignedCoachName || '') : '';
              const nextAssignedAt = keepCoach ? (this.data.assignedCoachAt || '') : '';
              this.setData({
                pickupConfirmCode: newConfirmCode,
                pickupFullCode: newFullCode,
                pickupFinalCode: newFinalCode,
                assignedCoachName: nextAssignedCoach,
                assignedCoachAt: nextAssignedAt,
                isResettingPickupCode: false
              });
              // 压缩重置成功提示：保留新码 + 状态变化 + 是否复制
              const displayNewFull = newFullCode.length === 12
                ? `${newFullCode.slice(0, 8)} ${newFullCode.slice(8, 12)}`
                : newFullCode;
              const resetStateHint = keepCoach
                ? '\n教练不变，课程保持【进行中】；旧码作废。'
                : '\n已清空教练，课程回到【待接取】；旧码作废。';
              wx.showModal({
                title: '接取码已更换',
                content: `${displayNewFull}${resetStateHint}\n是否立刻复制新 12 位接取码？`,
                confirmText: '立即复制',
                cancelText: '知道了',
                success: (copyModal) => {
                  if (copyModal.confirm && newFullCode.length === 12) {
                    wx.setClipboardData({
                      data: newFullCode,
                      success: () => wx.showToast({ title: '新接取码已复制', icon: 'success' }),
                      fail: () => wx.showToast({ title: '复制失败，请手动抄', icon: 'none' })
                    });
                  }
                }
              });
            } else {
              this.setData({ isResettingPickupCode: false });
              wx.showToast({ title: result.msg || '重置失败，请稍后重试', icon: 'none' });
            }
          },
          fail: (err) => {
            wx.hideLoading();
            this.setData({ isResettingPickupCode: false });
            console.error('[publish] reset pickup code fail:', err);
            wx.showToast({ title: '网络错误，请稍后重试', icon: 'none' });
          }
        });
      }
    });
  },

  onPullDownRefresh() {
    if (this.data.orderId) {
      this.fetchOrderDetails(this.data.orderId).finally(() => {
        wx.stopPullDownRefresh();
      });
      return;
    }

    wx.stopPullDownRefresh();
  }
});
