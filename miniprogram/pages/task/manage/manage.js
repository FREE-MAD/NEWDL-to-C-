// pages/demand/manage/manage.js
const app = getApp();

Page({
  data: {
    // Top-level category: 'public' (大众健身练) or 'coach' (教练跟踪练)
    currentCategory: 'public',
    
    // Data for Mass Fitness Practice
    publicExercises: [
      {
        id: 1,
        title: '基础体能训练',
        desc: '适合所有人的入门级体能训练，包含开合跳、深蹲等。',
        duration: 30,
        difficulty: '入门',
        imageUrl: 'https://img.yzcdn.cn/vant/cat.jpeg' // Placeholder
      },
      {
        id: 2,
        title: '核心力量强化',
        desc: '针对腹部和背部核心肌群的强化训练。',
        duration: 45,
        difficulty: '中级',
        imageUrl: 'https://img.yzcdn.cn/vant/cat.jpeg'
      },
      {
        id: 3,
        title: '柔韧性拉伸',
        desc: '全身主要肌群的拉伸放松，适合运动后进行。',
        duration: 20,
        difficulty: '入门',
        imageUrl: 'https://img.yzcdn.cn/vant/cat.jpeg'
      }
    ],

    // Data for Coach Tracking Practice
    coachExercises: [],
    
    // Original data (kept for reference or if needed)
    demands: [],
    activeTab: 0,
    tabs: ['已发布', '进行中', '已完成'],
    stats: {
      published: 0,
      ongoing: 0,
      completed: 0
    }
  },

  onLoad() {
    this.loadData();
  },

  onShow() {
    this.loadData();
  },

  // Switch top-level category
  switchCategory(e) {
    const category = e.currentTarget.dataset.category;
    this.setData({ currentCategory: category });
    this.loadData();
  },

  loadData() {
    if (this.data.currentCategory === 'public') {
      // Load public exercises (already mocked in data, but could be an API call)
    } else {
      this.loadCoachExercises();
    }
  },

  // Load Coach Tracking Exercises (Mock implementation)
  loadCoachExercises() {
    // In a real implementation, this would fetch from the backend based on user's orders
    // where a coach has assigned exercises.
    const userId = wx.getStorageSync('userId');
    
    // Mock data simulation
    this.setData({
      coachExercises: [
        {
          id: 101,
          coachName: '李教练',
          title: '针对性膝盖康复训练',
          desc: '根据你的膝盖情况，定制的康复训练计划。',
          status: 'pending', // pending, completed
          assignDate: '2023-10-27'
        },
        {
          id: 102,
          coachName: '王教练',
          title: '高强度减脂计划 - 第1周',
          desc: '本周重点在于提高心率，保持燃脂区间。',
          status: 'completed',
          assignDate: '2023-10-20'
        }
      ]
    });
  },

  // Navigate to exercise detail
  onExerciseDetail(e) {
    const id = e.currentTarget.dataset.id;
    const type = this.data.currentCategory;
    wx.showToast({
      title: `查看${type === 'public' ? '大众' : '教练'}练习详情: ${id}`,
      icon: 'none'
    });
    // wx.navigateTo({ url: `/pages/exercise/detail/detail?id=${id}&type=${type}` });
  },

  // --- Original methods below (kept if needed, can be cleaned up later) ---

  onTabChange(e) {
    const index = e.currentTarget.dataset.index;
    this.setData({ activeTab: index });
    // this.loadDemands(); 
  },

  // ... (Other methods can be kept or removed based on final decision)
});
