// ============================================================
// 业务积木：表单提交 - publish_dailysummary 模块（每日总结 tab）
// 所属页面：pages/task/publish/publish
// 说明：原 publish 页面 selectedTab === 'summary' 分支整体迁移为本组件。
//       所有事件方法位于 methods 内，组件 schedule 变化时自动同步编辑器。
// 拆分说明（2026-09-20）：publish 页面按表单提交职责拆为 classcreate / dailysummary / classoff 三个组件，
//       本组件对应【每日总结】tab。
// ============================================================

const app = getApp();

Component({
  // 组件外部入参：由宿主页面 publish 下发
  properties: {
    orderId: { type: String, value: '' },
    schedule: { type: Array, value: [] },
    displaySchedule: { type: Array, value: [] },
    canWriteSummary: { type: Boolean, value: false },
    orderProgress: { type: Object, value: { progress_done: 0, progress_total: 0 } }
  },

  data: {
    selectedLessonIndex: 0,
    summaryLessonIndex: 0,
    manageLessonScrollIntoView: 'manage-lesson-0',
    summaryLessonScrollIntoView: 'summary-lesson-0',
    summaryInput: '',
    summaryDate: '',
    summaryStartTime: '',
    summaryEndTime: '',
    summaryTimeAutoFilled: false,
    summaryDimensionOptions: ['专注', '动作完成', '课堂配合', '训练状态'],
    summaryDimensionRatings: {},
    summaryDimensionInputMap: {},
    summaryDimensionCardList: [
      { label: '专注', value: 0, displayValue: '未选择', hasValue: false, inputValue: '' },
      { label: '动作完成', value: 0, displayValue: '未选择', hasValue: false, inputValue: '' },
      { label: '课堂配合', value: 0, displayValue: '未选择', hasValue: false, inputValue: '' },
      { label: '训练状态', value: 0, displayValue: '未选择', hasValue: false, inputValue: '' }
    ],
    summarySelectedDimensionCount: 0,
    summaryAverageRatingText: '未生成',
    // 每日记录之后不可更改：当前课节已记录则锁定所有编辑控件
    summaryLocked: false
  },

  // 监听 schedule 变化：重新同步编辑器到当前课节
  observers: {
    'schedule': function (schedule) {
      if (schedule && schedule.length) {
        this.syncSelectedLesson(schedule);
        this.syncSummaryEditor(schedule);
      }
    }
  },

  methods: {
    formatTime(dateStr) {
      if (!dateStr) return '';
      const date = new Date(dateStr);
      const month = `${date.getMonth() + 1}`.padStart(2, '0');
      const day = `${date.getDate()}`.padStart(2, '0');
      const hour = `${date.getHours()}`.padStart(2, '0');
      const minute = `${date.getMinutes()}`.padStart(2, '0');
      return `${month}-${day} ${hour}:${minute}`;
    },

    formatPickerDate(dateInput) {
      if (!dateInput) return '';
      const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
      if (Number.isNaN(date.getTime())) return '';
      const year = date.getFullYear();
      const month = `${date.getMonth() + 1}`.padStart(2, '0');
      const day = `${date.getDate()}`.padStart(2, '0');
      return `${year}-${month}-${day}`;
    },

    formatPickerTime(dateInput) {
      if (!dateInput) return '';
      const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
      if (Number.isNaN(date.getTime())) return '';
      const hour = `${date.getHours()}`.padStart(2, '0');
      const minute = `${date.getMinutes()}`.padStart(2, '0');
      return `${hour}:${minute}`;
    },

    buildLessonScrollViewState(index = 0) {
      const safeIndex = Math.max(0, Number(index) || 0);
      return {
        selectedLessonIndex: safeIndex,
        summaryLessonIndex: safeIndex,
        manageLessonScrollIntoView: `manage-lesson-${safeIndex}`,
        summaryLessonScrollIntoView: `summary-lesson-${safeIndex}`
      };
    },

    buildSummaryTimeEditorData(lesson = {}) {
      const startedAt = lesson.startedAt || '';
      const completedAt = lesson.completedAt || '';
      const fallbackDate = this.formatPickerDate(lesson.summaryDate || startedAt || completedAt || new Date());
      return {
        summaryDate: fallbackDate,
        summaryStartTime: this.formatPickerTime(startedAt),
        summaryEndTime: this.formatPickerTime(completedAt),
        summaryTimeAutoFilled: !!(startedAt && completedAt)
      };
    },

    parseSummaryDurationMinutes(rawValue) {
      const cleanedValue = String(rawValue || '').replace(/[^\d]/g, '');
      const parsedValue = Number(cleanedValue);
      if (!cleanedValue || !Number.isFinite(parsedValue) || parsedValue <= 0) return 0;
      return Math.min(parsedValue, 1440);
    },

    calculateSummaryDurationMinutes(startInput, endInput) {
      if (!startInput || !endInput) return 0;
      const startedAt = startInput instanceof Date ? startInput : new Date(startInput);
      const completedAt = endInput instanceof Date ? endInput : new Date(endInput);
      if (Number.isNaN(startedAt.getTime()) || Number.isNaN(completedAt.getTime())) return 0;
      const diffMinutes = Math.round((completedAt.getTime() - startedAt.getTime()) / 60000);
      return diffMinutes > 0 ? diffMinutes : 0;
    },

    shiftSummaryTime(dateValue, timeValue, offsetMinutes) {
      if (!dateValue || !timeValue) return { date: dateValue || '', time: '' };
      const shiftedDate = new Date(`${dateValue}T${timeValue}:00`);
      if (Number.isNaN(shiftedDate.getTime())) return { date: dateValue || '', time: '' };
      shiftedDate.setMinutes(shiftedDate.getMinutes() + offsetMinutes);
      return { date: this.formatPickerDate(shiftedDate), time: this.formatPickerTime(shiftedDate) };
    },

    buildLessonDateTime(dateValue, timeValue) {
      if (!dateValue || !timeValue) return '';
      const date = new Date(`${dateValue}T${timeValue}:00`);
      if (Number.isNaN(date.getTime())) return '';
      return date.toISOString();
    },

    normalizeSummaryDimensionRatings(rawRatings = {}) {
      const nextRatings = {};
      (this.data.summaryDimensionOptions || []).forEach(label => {
        const rawValue = rawRatings[label];
        if (rawValue === '' || rawValue === null || typeof rawValue === 'undefined') return;
        const score = Number(rawValue);
        if (Number.isNaN(score)) return;
        const safeScore = Math.max(0, Math.min(5, Number(score.toFixed(2))));
        if (safeScore > 0) nextRatings[label] = safeScore;
      });
      return nextRatings;
    },

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

    buildSummaryDimensionCardList(ratings = {}, inputMap = {}) {
      const safeRatings = this.normalizeSummaryDimensionRatings(ratings);
      const cardList = (this.data.summaryDimensionOptions || []).map(label => {
        const value = Number(safeRatings[label] || 0);
        return {
          label, value,
          displayValue: value > 0 ? `${value}分` : '未选择',
          hasValue: value > 0,
          inputValue: String(inputMap[label] || '')
        };
      });
      const selectedValues = cardList.filter(item => item.value > 0).map(item => item.value);
      const averageRating = selectedValues.length ? (selectedValues.reduce((sum, value) => sum + value, 0) / selectedValues.length) : 0;
      return {
        cardList,
        selectedCount: selectedValues.length,
        averageRating,
        averageRatingText: selectedValues.length ? averageRating.toFixed(1) : '未生成'
      };
    },

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

    buildSummaryRatingTagsFromDimensions(ratings = {}) {
      const safeRatings = this.normalizeSummaryDimensionRatings(ratings);
      return Object.keys(safeRatings);
    },

    buildAverageSummaryRating(ratings = {}) {
      const safeRatings = this.normalizeSummaryDimensionRatings(ratings);
      const values = Object.values(safeRatings);
      if (!values.length) return 0;
      const average = values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
      return Number(average.toFixed(1));
    },

    handleSummaryDimensionInput(e) {
      // 每日记录之后不可更改：已记录课节禁用多维评分输入
      if (this.data.summaryLocked) return;
      const label = String(e.currentTarget.dataset.label || '').trim();
      if (!label) return;
      const rawValue = String((e.detail || {}).value || '');
      let nextInputValue = rawValue.replace(/[^\d.]/g, '');
      if (nextInputValue.indexOf('.') !== -1) {
        const parts = nextInputValue.split('.');
        nextInputValue = `${parts[0]}.${parts.slice(1).join('').slice(0, 2)}`;
      }
      if (nextInputValue.startsWith('.')) nextInputValue = '';
      if (nextInputValue !== '') {
        const numericValue = Number(nextInputValue);
        if (!Number.isNaN(numericValue) && numericValue > 5) nextInputValue = '5';
      }
      const nextInputMap = { ...(this.data.summaryDimensionInputMap || {}), [label]: nextInputValue };
      const currentRatings = this.normalizeSummaryDimensionRatings(this.data.summaryDimensionRatings);
      const numericValue = Number(nextInputValue);
      if (nextInputValue === '' || Number.isNaN(numericValue) || numericValue <= 0) {
        delete currentRatings[label];
      } else {
        currentRatings[label] = Math.max(0, Math.min(5, Number(numericValue.toFixed(2))));
      }
      this.applySummaryDimensionRatings(currentRatings, nextInputMap);
    },

    handleSummaryDimensionBlur() {
      this.applySummaryDimensionRatings(this.data.summaryDimensionInputMap);
    },

    clearSummaryDimensionScore(e) {
      // 每日记录之后不可更改：已记录课节禁用清空评分
      if (this.data.summaryLocked) return;
      // 【2026-09-21 权限口径调整】管理层 / 机构 admin 是只读查看态（canWriteSummary=false），
      // wxml 里的「清空」只是加了 disabled 样式，bindtap 仍会触发，这里补一道硬拦截。
      if (!this.data.canWriteSummary) return;
      const label = String(e.currentTarget.dataset.label || '').trim();
      if (!label) return;
      const currentRatings = this.normalizeSummaryDimensionRatings(this.data.summaryDimensionRatings);
      delete currentRatings[label];
      this.applySummaryDimensionRatings(currentRatings);
    },

    buildSummaryDimensionRatingsFromLesson(lesson = {}) {
      if (lesson && typeof lesson.dimensionRatings === 'object' && lesson.dimensionRatings) {
        return this.normalizeSummaryDimensionRatings(lesson.dimensionRatings);
      }
      return {};
    },

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

    // 每日记录之后不可更改：依据课节是否已完成记录，返回锁定状态
    // 判定与 buildLessonDisplayMeta 保持一致：已有总结内容且存在上课日期即视为已记录
    buildSummaryLockedState(lesson = {}) {
      const meta = this.buildLessonDisplayMeta(lesson);
      return { summaryLocked: !!meta.isCompleted };
    },

    buildScheduleView(schedule) {
      return (schedule || [])
        .map(item => ({
          ...item,
          ...this.buildLessonDisplayMeta(item),
          startedAtText: item.startedAt ? this.formatTime(item.startedAt) : '',
          completedAtText: item.completedAt ? this.formatTime(item.completedAt) : ''
        }))
        .sort((a, b) => {
          if (a.isCompleted === b.isCompleted) return (a.lesson || 0) - (b.lesson || 0);
          return a.isCompleted ? 1 : -1;
        });
    },

    getRecordedLessonCount(schedule = []) {
      return (schedule || []).filter(item => this.buildLessonDisplayMeta(item).isCompleted).length;
    },

    syncSummaryEditor(schedule) {
      const lessonIndex = this.data.summaryLessonIndex || 0;
      const targetLesson = (schedule || [])[lessonIndex] || {};
      const targetSummaryIndex = targetLesson.lesson ? lessonIndex : 0;
      const safeLesson = (schedule || [])[targetSummaryIndex] || {};
      const dimensionRatings = this.buildSummaryDimensionRatingsFromLesson(safeLesson);
      this.setData({
        ...this.buildLessonScrollViewState(targetSummaryIndex),
        ...this.buildSummaryLockedState(safeLesson),
        summaryInput: safeLesson.summary || '',
        ...this.buildSummaryTimeEditorData(safeLesson)
      });
      this.applySummaryDimensionRatings(dimensionRatings);
    },

    syncSelectedLesson(schedule) {
      const lessonIndex = this.data.selectedLessonIndex || 0;
      const targetLesson = (schedule || [])[lessonIndex] || {};
      this.setData({
        ...this.buildLessonScrollViewState(targetLesson.lesson ? lessonIndex : 0)
      });
    },

    // 暴露给宿主页面调用：流转 tab「去记录」按钮跳转总结编辑器
    goRecordSummaryFromFlow(index) {
      const schedule = this.data.schedule || [];
      const lesson = schedule[index] || {};
      const dimensionRatings = this.buildSummaryDimensionRatingsFromLesson(lesson);
      this.setData({
        ...this.buildLessonScrollViewState(index),
        ...this.buildSummaryLockedState(lesson),
        summaryInput: lesson.summary || '',
        ...this.buildSummaryTimeEditorData(lesson)
      });
      this.applySummaryDimensionRatings(dimensionRatings);
    },

    selectManageLesson(e) {
      if (Number(e.currentTarget.dataset.history || 0) === 1) return;
      const index = Number(e.currentTarget.dataset.index || 0);
      const lesson = this.data.schedule[index] || {};
      const dimensionRatings = this.buildSummaryDimensionRatingsFromLesson(lesson);
      this.setData({
        ...this.buildLessonScrollViewState(index),
        ...this.buildSummaryLockedState(lesson),
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
        ...this.buildLessonScrollViewState(index),
        ...this.buildSummaryLockedState(lesson),
        summaryInput: lesson.summary || '',
        ...this.buildSummaryTimeEditorData(lesson)
      });
      this.applySummaryDimensionRatings(dimensionRatings);
    },

    // 当前操作课节的「去记录」按钮：定位到总结编辑区
    goRecordSummary(e) {
      const index = Number(e.currentTarget.dataset.index || this.data.selectedLessonIndex || 0);
      const lesson = this.data.schedule[index] || {};
      const dimensionRatings = this.buildSummaryDimensionRatingsFromLesson(lesson);
      this.setData({
        summaryLessonIndex: index,
        summaryLessonScrollIntoView: `summary-lesson-${index}`,
        ...this.buildSummaryLockedState(lesson),
        summaryInput: lesson.summary || '',
        ...this.buildSummaryTimeEditorData(lesson)
      });
      this.applySummaryDimensionRatings(dimensionRatings);
    },

    handleSummaryInput(e) {
      // 每日记录之后不可更改：已记录课节禁用总结文本编辑
      if (this.data.summaryLocked) return;
      this.setData({ summaryInput: e.detail.value });
    },

    handleSummaryDateChange(e) {
      // 每日记录之后不可更改：已记录课节禁用上课日期变更
      if (this.data.summaryLocked) return;
      this.setData({ summaryDate: e.detail.value });
    },

    handleSummaryStartTimeChange(e) {
      // 每日记录之后不可更改：已记录课节禁用上课时间变更
      if (this.data.summaryLocked) return;
      const summaryStartTime = e.detail.value;
      const summaryDate = this.data.summaryDate || this.formatPickerDate(new Date());
      const nextData = { summaryDate, summaryStartTime };
      if (!this.data.summaryEndTime) {
        const shifted = this.shiftSummaryTime(summaryDate, summaryStartTime, 60);
        nextData.summaryEndTime = shifted.time || this.data.summaryEndTime;
        nextData.summaryTimeAutoFilled = true;
      } else {
        nextData.summaryTimeAutoFilled = false;
      }
      this.setData(nextData);
    },

    handleSummaryEndTimeChange(e) {
      // 每日记录之后不可更改：已记录课节禁用下课时间变更
      if (this.data.summaryLocked) return;
      const summaryEndTime = e.detail.value;
      const summaryDate = this.data.summaryDate || this.formatPickerDate(new Date());
      const nextData = { summaryDate, summaryEndTime };
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

    handleSummaryDurationInput(e) {
      // 每日记录之后不可更改：已记录课节禁用时长推导时间
      if (this.data.summaryLocked) return;
      const rawValue = String(e.detail.value || '').replace(/[^\d]/g, '');
      const summaryDurationMinutes = rawValue.slice(0, 4);
      const durationMinutes = this.parseSummaryDurationMinutes(summaryDurationMinutes);
      const summaryDate = this.data.summaryDate || this.formatPickerDate(new Date());
      const nextData = { summaryDurationMinutes };
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
      // 每日记录之后不可更改：已记录课节直接拦截保存请求
      if (this.data.summaryLocked) {
        wx.showToast({ title: '该课节已记录，不可更改', icon: 'none' });
        return;
      }
      if (!this.data.canWriteSummary) {
        wx.showToast({ title: '当前身份不可填总结。', icon: 'none' });
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
          summaryDate: this.data.summaryDate,
          rating: summaryRating,
          ratingTags: summaryRatingTags,
          dimensionRatings: summaryDimensionRatings
        };
        if (startedAt) lessonContent.startedAt = startedAt;
        if (completedAt) lessonContent.completedAt = completedAt;
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
          // 每日记录之后不可更改：保存成功后立即锁定编辑器，避免跳转前 300ms 窗口内被改动
          this.setData({ summaryLocked: true });
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
          // 通知宿主页面保存成功（宿主页面 onShow 返回时也会刷新，此处为即时通知）
          this.triggerEvent('summary-saved', { lesson: targetLesson, index: lessonIndex, lessonNo, orderId: this.data.orderId });
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
        console.error('[publish_dailysummary] [saveSummary] 失败:', error);
        wx.showToast({ title: '保存失败', icon: 'none' });
      }
    }
  }
});
