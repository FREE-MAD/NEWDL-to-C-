// pages/index/do_certification/do_certification.js
Page({
  data: {
    pageTitle: '低价办证',
    // 新增办证页 tab 数据：把原先单一说明卡片拆成“套餐选择 / 具体操作”两个页签
    activeTab: 'package',
    tabList: [
      { key: 'package', label: '套餐选择' },
      { key: 'operation', label: '具体操作' }
    ],
    // 新增套餐展示数据：先把价格和适合场景讲清楚，用户一眼能看懂该选哪个
    packageList: [
      {
        title: '基础套餐',
        price: '¥99',
        desc: '适合先了解办理流程、材料要求和基础咨询的用户。'
      },
      {
        title: '标准套餐',
        price: '¥199',
        desc: '适合想直接按流程推进、减少来回沟通成本的用户。'
      },
      {
        title: '加急套餐',
        price: '¥299',
        desc: '适合时间比较赶，希望优先确认材料并尽快安排办理的用户。'
      }
    ],
    // 新增操作步骤图片：按用户提供的顺序展示在“具体操作”页签里
    operationImageList: [
      {
        title: '步骤 1',
        src: 'cloud://cloud1-6gh7jgl8c5b16a83.636c-cloud1-6gh7jgl8c5b16a83-1398046944/NEWDL/yemian_ui_show/do_certification_adv/操作步骤/切开_edited.png'
      },
      {
        title: '步骤 2',
        src: 'cloud://cloud1-6gh7jgl8c5b16a83.636c-cloud1-6gh7jgl8c5b16a83-1398046944/NEWDL/yemian_ui_show/do_certification_adv/操作步骤/切开 (1)-600d8dc7-daa2-40c3-bd86-ec9f60b7feb5.jpg'
      },
      {
        title: '步骤 3',
        src: 'cloud://cloud1-6gh7jgl8c5b16a83.636c-cloud1-6gh7jgl8c5b16a83-1398046944/NEWDL/yemian_ui_show/do_certification_adv/操作步骤/切开 (2)-ffd714b0-65e0-4d1d-af94-b78df25f7777.jpg'
      },
      {
        title: '步骤 4',
        src: 'cloud://cloud1-6gh7jgl8c5b16a83.636c-cloud1-6gh7jgl8c5b16a83-1398046944/NEWDL/yemian_ui_show/do_certification_adv/操作步骤/切开 (3) - 副本-eaf8c86e-0c29-46e6-8da8-524fd4ad9fd6.jpg'
      },
      {
        title: '步骤 5',
        src: 'cloud://cloud1-6gh7jgl8c5b16a83.636c-cloud1-6gh7jgl8c5b16a83-1398046944/NEWDL/yemian_ui_show/do_certification_adv/操作步骤/切开 (4)_edited.png'
      },
      {
        title: '步骤 6',
        src: 'cloud://cloud1-6gh7jgl8c5b16a83.636c-cloud1-6gh7jgl8c5b16a83-1398046944/NEWDL/yemian_ui_show/do_certification_adv/操作步骤/切开 (5)_edited.png'
      }
    ]
  },

  // 新增 tab 切换：让卡片区域支持在套餐和操作说明之间来回切换
  onTabChange(e) {
    const nextTab = e.currentTarget.dataset.tab;
    if (!nextTab || nextTab === this.data.activeTab) {
      return;
    }

    this.setData({
      activeTab: nextTab
    });
  },

  // 新增返回操作：给用户一个明确的回到首页入口
  goBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => {
        wx.switchTab({
          url: '/pages/index/index'
        });
      }
    });
  }
});
