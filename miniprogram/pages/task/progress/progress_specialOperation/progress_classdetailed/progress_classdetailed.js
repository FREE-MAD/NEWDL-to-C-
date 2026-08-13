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
    lessonIndex: 0,
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

  // 新增课节展示字段整理：统一补齐上下课时间与教练总结文案
  buildLessonView(lesson) {
    const safeLesson = lesson || {};
    return {
      ...safeLesson,
      // 旧状态映射保留注释，不删除；当前详情页统一按课节记录展示
      // statusText: LESSON_STATUS_TEXT_MAP[safeLesson.status] || safeLesson.status || '待处理',
      statusText: '课节记录',
      startedAtText: safeLesson.startedAt ? this.formatTime(safeLesson.startedAt) : '',
      completedAtText: safeLesson.completedAt ? this.formatTime(safeLesson.completedAt) : '',
      summaryUpdatedAtText: safeLesson.summaryUpdatedAt ? this.formatTime(safeLesson.summaryUpdatedAt) : ''
    };
  },

  onLoad(options) {
    if (!options.lesson) {
      return;
    }

    try {
      const lesson = JSON.parse(decodeURIComponent(options.lesson));
      const lessonIndex = parseInt(options.index || 0, 10);

      this.setData({
        lesson: this.buildLessonView(lesson),
        lessonIndex,
        displayIndex: lessonIndex + 1,
        orderId: options.orderId || '',
        isShareEntry: options.isShareEntry === '1' || options.from === 'share',
        pageMode: options.pageMode || 'normal',
        entryFrom: options.from || 'normal',
        sharerOpenid: options.shareOpenid || '',
        sourcePage: options.sourcePage || ''
      });

      wx.setNavigationBarTitle({
        title: `第 ${lessonIndex + 1} 课详情`
      });

      this.recordEntryLog({
        lessonIndex: lessonIndex + 1,
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
      const lesson = (order.schedule || [])[this.data.lessonIndex];
      if (!lesson) {
        return;
      }

      this.setData({
        lesson: this.buildLessonView(lesson)
      });
    } catch (error) {
      console.error('刷新失败', error);
      wx.showToast({ title: '网络错误', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

});
