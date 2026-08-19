const app = getApp();

// 旧课节状态文案映射保留注释，不删除；当前详情页不再依赖课程状态决定内容显示
// const LESSON_STATUS_TEXT_MAP = {
//   PENDING: '待上课',
//   COACH_READY: '待确认',
//   PARENT_CONFIRMED: '上课中',
//   DONE: '已完成'
// };

Page({
  data: {
    lesson: {},
    orderSnapshot: {},
    lessonIndex: 0,
    lessonNo: 0,
    displayIndex: 0,
    orderId: '',
    isShareEntry: false,
    pageMode: 'normal',
    entryFrom: 'normal',
    sharerOpenid: '',
    sourcePage: '',
    hasRecordedEnter: false
  },

  // 新增详情页进入日志：和主展示页保持同一套分享标记与来源记录
  recordEntryLog(extra = {}) {
    if (!this.data.orderId || this.data.hasRecordedEnter) {
      return Promise.resolve();
    }

    this.setData({ hasRecordedEnter: true });

    return wx.cloud.callFunction({
      name: 'NEWDL_execution_order',
      data: {
        action: 'add_entry_log',
        orderId: this.data.orderId,
        from: this.data.entryFrom || 'normal',
        page: 'progress_classdetailed',
        pageMode: this.data.pageMode || 'normal',
        sharerOpenid: this.data.sharerOpenid || '',
        extra,
        envVersion: app.globalData.miniEnvVersion || 'develop'
      }
    }).catch(error => {
      console.error('[progress_classdetailed] [recordEntryLog] 记录失败', error);
    });
  },

  // 新增日期格式化：详情页基本信息卡片按设计稿使用纯日期展示
  formatDateOnly(dateStr) {
    if (!dateStr) {
      return '';
    }

    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}.${month}.${day}`;
  },

  // 新增月日时分格式：基础信息第一个格子直接展示训练发生的具体时间
  formatMonthDayHourMinute(dateStr) {
    if (!dateStr) {
      return '';
    }

    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    const hour = `${date.getHours()}`.padStart(2, '0');
    const minute = `${date.getMinutes()}`.padStart(2, '0');
    return `${month}月${day}日 ${hour}时${minute}分`;
  },

  // 新增课节时长计算：优先按上下课时间差计算分钟
  buildDurationText(lesson = {}) {
    if (!lesson.startedAt || !lesson.completedAt) {
      return '未记录';
    }

    const startedAt = new Date(lesson.startedAt).getTime();
    const completedAt = new Date(lesson.completedAt).getTime();
    if (Number.isNaN(startedAt) || Number.isNaN(completedAt) || completedAt <= startedAt) {
      return '未记录';
    }

    const durationMinutes = Math.round((completedAt - startedAt) / (1000 * 60));
    return durationMinutes > 0 ? `${durationMinutes}分钟` : '未记录';
  },

  // 新增评分星级整理：MVP 直接按四舍五入后的整数颗星展示
  buildRatingStars(ratingValue) {
    const rating = Number(ratingValue || 0);
    const activeCount = Math.max(0, Math.min(5, Math.round(rating)));

    return new Array(5).fill('').map((_, index) => ({
      active: index < activeCount
    }));
  },

  // 新增多维评分列表：把每个维度的具体分数整理成展示数组
  buildDimensionRatingList(dimensionRatings = {}) {
    if (!dimensionRatings || typeof dimensionRatings !== 'object') {
      return [];
    }

    return Object.keys(dimensionRatings)
      .map(label => ({
        label,
        value: Number(dimensionRatings[label] || 0)
      }))
      .filter(item => item.value > 0);
  },

  // 新增评分概览整理：让详情页直接展示“已评几项”和“总分是多少”
  buildRatingSummaryList(ratingText, dimensionRatingList = []) {
    return [
      {
        label: '已评维度',
        value: `${dimensionRatingList.length}项`
      },
      {
        label: '综合评分',
        value: ratingText === '暂无' ? '暂未评分' : `${ratingText}分`
      }
    ];
  },

  // 新增订单字段整理：详情页需要从订单里拿学员名、课程名、教练信息一起展示
  normalizeOrderSnapshot(orderData = {}) {
    const courseTarget = orderData.course_target || {};
    const childProfile = orderData.child_profile || {};
    const publisherInfo = orderData.publisherInfo || ((orderData.other_info || {}).publisherInfo) || {};
    const fallbackUserInfo = orderData.userInfo || ((orderData.other_info || {}).userInfo) || {};
    const coachInfo = Object.keys(publisherInfo || {}).length ? publisherInfo : fallbackUserInfo;
    const coachName = coachInfo.nickName || '陈教练';
    const childProfiles = this.normalizeChildProfiles(
      (Array.isArray(orderData.child_profiles) && orderData.child_profiles.length)
        ? orderData.child_profiles
        : [{
            nickname: childProfile.nickname || orderData.child_nickname || '',
            age: childProfile.age || orderData.child_age || '',
            gender: childProfile.gender || orderData.child_gender || '',
            height: childProfile.height || orderData.child_height || '',
            weight: childProfile.weight || orderData.child_weight || ''
          }]
    );
    const childNames = childProfiles.map(item => item.nickname).filter(Boolean);
    const childName = childNames.length ? childNames.join('、') : '未填写';
    const courseName = courseTarget.title || orderData.title || '未填写';
    const categoryName = courseTarget.category || orderData.category || '';

    return {
      childProfiles,
      childCount: childProfiles.filter(item => item.nickname || item.age || item.gender || item.height || item.weight).length,
      childName,
      childInitial: childNames.length ? childNames[0].slice(0, 1) : '学',
      courseName,
      coachName,
      coachInitial: coachName ? coachName.slice(0, 1) : '教',
      coachAvatar: coachInfo.avatarUrl || '',
      coachRole: categoryName ? `${categoryName}训练师` : '体能训练师'
    };
  },

  // 新增多孩子展示收口：详情页和展示页统一按数组读取孩子信息
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

    return filteredList.length
      ? filteredList
      : [{ nickname: '', age: '', gender: '', height: '', weight: '' }];
  },

  onLoad(options) {
    if (!options.lesson) {
      return;
    }

    try {
      const lesson = JSON.parse(decodeURIComponent(options.lesson));
      const lessonIndex = parseInt(options.index || 0, 10);
      const lessonNo = parseInt(options.lessonNo || lesson.lesson || (lessonIndex + 1), 10);
      const displayIndex = Number.isNaN(lessonNo) || lessonNo < 1 ? (lessonIndex + 1) : lessonNo;

      this.setData({
        lesson: this.buildLessonView(lesson),
        orderSnapshot: this.normalizeOrderSnapshot(),
        lessonIndex,
        lessonNo: displayIndex,
        displayIndex,
        orderId: options.orderId || '',
        isShareEntry: options.isShareEntry === '1' || options.from === 'share',
        pageMode: options.pageMode || 'normal',
        entryFrom: options.from || 'normal',
        sharerOpenid: options.shareOpenid || '',
        sourcePage: options.sourcePage || ''
      });

      wx.setNavigationBarTitle({
        title: `第 ${displayIndex} 课详情`
      });

      this.recordEntryLog({
        lessonIndex: displayIndex,
        sourcePage: options.sourcePage || ''
      });
    } catch (error) {
      console.error('解析课程详情失败', error);
    }
  },

  onShow() {
    if (this.data.orderId) {
      this.refreshLessonData();
    }
  },

  onPullDownRefresh() {
    if (!this.data.orderId) {
      wx.stopPullDownRefresh();
      return;
    }

    this.refreshLessonData().finally(() => {
      wx.stopPullDownRefresh();
    });
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

  // 新增课节展示字段整理：基本信息和教练评价统一在这里补齐
  buildLessonView(lesson, orderData = {}) {
    const safeLesson = lesson || {};
    const orderSnapshot = this.normalizeOrderSnapshot(orderData);
    const ratingValue = Number(safeLesson.rating || 0);
    const safeRatingValue = Number.isNaN(ratingValue) ? 0 : Number(ratingValue.toFixed(1));
    const lessonDateTimeText = this.formatMonthDayHourMinute(safeLesson.startedAt || safeLesson.completedAt || safeLesson.summaryDate);
    const lessonDateText = this.formatDateOnly(safeLesson.summaryDate || safeLesson.startedAt || safeLesson.completedAt);
    const recordDateText = this.formatDateOnly(safeLesson.summaryUpdatedAt || safeLesson.completedAt || safeLesson.startedAt);
    const dimensionRatingList = this.buildDimensionRatingList(safeLesson.dimensionRatings);
    const ratingText = safeRatingValue > 0 ? safeRatingValue.toFixed(1) : '暂无';

    return {
      ...safeLesson,
      ...orderSnapshot,
      // 旧状态映射保留注释，不删除；当前详情页统一按课节记录展示
      // statusText: LESSON_STATUS_TEXT_MAP[safeLesson.status] || safeLesson.status || '待处理',
      statusText: '课节记录',
      startedAtText: safeLesson.startedAt ? this.formatTime(safeLesson.startedAt) : '',
      completedAtText: safeLesson.completedAt ? this.formatTime(safeLesson.completedAt) : '',
      summaryUpdatedAtText: safeLesson.summaryUpdatedAt ? this.formatTime(safeLesson.summaryUpdatedAt) : '',
      lessonDateTimeText: lessonDateTimeText || '未记录',
      lessonDateText: lessonDateText || '未记录',
      recordDateText: recordDateText || '未记录',
      durationText: this.buildDurationText(safeLesson),
      completeStatusText: safeLesson.summary ? '已完成' : '未填写',
      ratingValue: safeRatingValue,
      ratingText,
      ratingStars: this.buildRatingStars(safeRatingValue),
      dimensionRatingList,
      ratingSummaryList: this.buildRatingSummaryList(ratingText, dimensionRatingList),
      hasRatingDetail: safeRatingValue > 0 || dimensionRatingList.length > 0,
      ratingTags: Array.isArray(safeLesson.ratingTags) ? safeLesson.ratingTags : []
    };
  },

  // MVP: 只刷新当前课节的时间、状态和总结
  async refreshLessonData() {
    wx.showLoading({ title: '刷新中' });

    try {
      const res = await wx.cloud.callFunction({
        name: 'NEWDL_execution_order',
        data: {
          action: 'get_oneorder',
          orderId: this.data.orderId,
          envVersion: getApp().globalData.miniEnvVersion || 'develop'
        }
      });

      if (res.result.code !== 0) {
        wx.showToast({ title: res.result.msg || '刷新失败', icon: 'none' });
        return;
      }

      const order = res.result.data || {};
      // 新增按课节编号刷新：publish 页面会按展示排序跳转，不能再依赖数组下标定位详情
      const lesson = (order.schedule || []).find(item => item.lesson == this.data.lessonNo)
        || (order.schedule || [])[this.data.lessonIndex];
      if (!lesson) {
        return;
      }

      this.setData({
        orderSnapshot: this.normalizeOrderSnapshot(order),
        lesson: this.buildLessonView(lesson, order)
      });
    } catch (error) {
      console.error('刷新失败', error);
      wx.showToast({ title: '网络错误', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

});
