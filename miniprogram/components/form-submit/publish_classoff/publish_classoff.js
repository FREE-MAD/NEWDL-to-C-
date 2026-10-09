// ============================================================
// 业务积木：表单提交 - publish_classoff 模块（结课 tab）
// 所属页面：pages/task/publish/publish
// 说明：原 publish 页面 selectedTab === 'close' 分支整体迁移为本组件。
//       所有事件方法位于 methods 内，组件 attached 时按 properties 初始化输入框。
// 拆分说明（2026-09-20）：publish 页面按表单提交职责拆为 classcreate / dailysummary / classoff 三个组件，
//       本组件对应【结课】tab。
// ============================================================

const app = getApp();

Component({
  // 组件外部入参：由宿主页面 publish 下发
  properties: {
    // 课程订单 ID；无值时显示空态提示
    orderId: { type: String, value: '' },
    // 是否拥有结课写入权限。
    // 【2026-09-21 权限口径调整】原规则是「仅发布者本人可结课」；现改为「教练接取后由执行教练本人结课」，
    // 管理层 / 机构 admin 只读不可写（宿主页面 publish.js 已按新口径下发，此处只做兜底拦截）。
    canCloseCourse: { type: Boolean, value: false },
    // 结课结语初始值（编辑态从 order.course_flow_info.close_summary 回填）
    initialCloseSummary: { type: String, value: '' },
    // 教练备注初始值（编辑态从 order.course_flow_info.close_coach_note 回填）
    initialCloseCoachNote: { type: String, value: '' }
  },

  data: {
    closeSummaryInput: '',
    closeCoachNoteInput: ''
  },

  // 监听外部入参变化：编辑态回填结语/备注
  observers: {
    'initialCloseSummary, initialCloseCoachNote': function (summary, note) {
      this.setData({
        closeSummaryInput: summary || '',
        closeCoachNoteInput: note || ''
      });
    }
  },

  lifetimes: {
    attached() {
      // 组件挂载时按 properties 初始化一次输入框
      this.setData({
        closeSummaryInput: this.data.initialCloseSummary || '',
        closeCoachNoteInput: this.data.initialCloseCoachNote || ''
      });
    }
  },

  methods: {
    // 新增结课输入：记录面向家长/课程的结语内容
    handleCloseSummaryInput(e) {
      this.setData({ closeSummaryInput: e.detail.value });
    },

    // 新增结课教练备注：仅在教练管理页内部可见，不对外展示
    handleCloseCoachNoteInput(e) {
      this.setData({ closeCoachNoteInput: e.detail.value });
    },

    // 新增结课提交：先填写结语和教练备注，再真正把课程状态改成 closed
    async submitCloseCourse() {
      if (!this.data.canCloseCourse) {
        wx.showToast({ title: '结课由接取的执行教练提交', icon: 'none' });
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
              name: getApp().getFnName('NEWDL_execution_order'),
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
              // 通知宿主页面重新拉取订单详情（刷新权限/状态）
              this.triggerEvent('course-closed', { orderId: this.data.orderId });
              return;
            }

            wx.showToast({ title: result.result.msg || '结课失败', icon: 'none' });
          } catch (error) {
            wx.hideLoading();
            console.error('[publish_classoff] [submitCloseCourse] 失败:', error);
            wx.showToast({ title: '网络错误', icon: 'none' });
          }
        }
      });
    }
  }
});
