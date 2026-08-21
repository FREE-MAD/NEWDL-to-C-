// pages/task/publish/publish_pdd/publish_pdd.js
const app = getApp();
const DEFAULT_CLASS_LESSON_COUNT = 10;

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
    const info = wx.getSystemInfoSync();
    const h = (info.statusBarHeight || 20) + 40; // Adjust safe-top height
    const targetOrderId = options.id || options.taskId || '';
    const selectedTab = options.tab || 'create';
    this.setData({
      statusBarHeight: info.statusBarHeight,
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
            title: '仅教练可创建课程',
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
            title: '仅教练可创建课程',
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
        title: '仅教练可创建课程',
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
    const appRole = app.globalData.userRole || wx.getStorageSync('userRole') || 'V';
    return appRole === 'C';
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
    const lessonPlanLockText = lessonPlanLocked
      ? `当前课程在接入后已记录 ${recordedLessonCount} 节课，已达到“三节后锁定”规则，不再支持修改总课时或重新半途接入。`
      : (historySync
        ? `当前是半途接入课程，历史 ${historySync.syncedCount || 0} 节不计入锁定统计；从接入后的课节开始，累计再记录 ${remainingEditableCount} 节后将自动锁定。`
        : `当前课程从第 1 节开始统计；累计记录满 3 节课后，将自动锁定“设置总课时 / 半途接入”，目前还可再记录 ${remainingEditableCount} 节。`);

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
      const myOpenid = app.globalData.openid || wx.getStorageSync('openid') || '';
      const myToken = app.globalData.token || wx.getStorageSync('token') || '';
      const isOwner = (orderData.publisher_openid && orderData.publisher_openid === myOpenid)
        || (orderData.publisher_Id && orderData.publisher_Id === myToken);

      // 新增所属教练校验：管理页只允许课程所属教练进入，其他用户统一回班级展示页
      if (!isOwner) {
        wx.showToast({
          title: '仅课程所属教练可管理',
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

      this.setData({
        orderId,
        isEditMode: true,
        order: orderData,
        schedule,
        displaySchedule,
        setTotalLessonsInput: `${orderData.progress_total || 1}`,
        syncTotalLessonsInput: `${orderData.progress_total || 1}`,
        syncHistoryCountInput: `${historyCount || 0}`,
        closeSummaryInput: (((orderData || {}).course_flow_info || {}).close_summary) || '',
        closeCoachNoteInput: (((orderData || {}).course_flow_info || {}).close_coach_note) || '',
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
      content: '确认提交结课吗？提交后课程会进入 closed 状态。',
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
