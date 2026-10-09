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
    // 广告轮播图列表：从云存储 do_certification_adv/轮播广告 目录动态拉取，套餐选择 tab 直接轮播这些图
    advImageList: [],
    // 轮播加载状态：用于在数据未返回时展示占位，避免空白闪烁
    advLoading: true,
    // 新增弹性高度支持：每张广告图按真实宽高比算出的显示高度（px），
    // swiperHeight 为当前轮播高度，advCurrent 记录当前滑到第几张
    advItemHeights: [],
    swiperHeight: 300,
    advCurrent: 0,
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

  // 页面加载时拉取广告轮播图：直接列举云存储 do_certification_adv/轮播广告 目录下的全部图片
  onLoad() {
    this.fetchAdvImages();
  },

  // 拉取广告图：调用 NEWDL_list_storage 云函数列举目录，把返回的 fileID 列表喂给 swiper
  // 调整（2026-09-06）：按用户要求只轮播「轮播广告」子文件夹下的图片，不再包含根目录和其他子文件夹
  fetchAdvImages() {
    this.setData({ advLoading: true });
    wx.cloud.callFunction({
      name: getApp().getFnName('NEWDL_list_storage'),
      data: {
        prefix: 'NEWDL/yemian_ui_show/do_certification_adv/轮播广告/'
      }
    }).then((res) => {
      const result = (res && res.result) || {};
      const files = Array.isArray(result.files) ? result.files : [];
      // 只取 fileID，swiper 里直接当 src 用
      const advImageList = files.map((f) => f.fileID).filter(Boolean);
      this.setData({
        advImageList,
        advLoading: false
      });
      // 新增：图片多为长图，加载完列表后按真实宽高比逐张计算轮播显示高度，实现弹性高度轮播
      if (advImageList.length > 0) {
        this.calcAdvItemHeights(advImageList);
      }
    }).catch((err) => {
      console.error('[do_certification] 拉取广告图失败：', err);
      this.setData({ advLoading: false });
    });
  },

  // 新增：按图片真实宽高比计算每张轮播图的显示高度（px）
  // 微信 swiper 组件高度不能被内容撑开，只能显式设定；这里在渲染后取轮播实际宽度，
  // 再用 wx.getImageInfo 读每张图的宽高比，换算出各自的显示高度，
  // 切换轮播时同步更新 swiperHeight，长图完整展示不裁剪（弹性效果）。
  calcAdvItemHeights(fileIdList) {
    // 先等 swiper 渲染出来再量实际宽度（页面左右 padding + 卡片内边距都已含在实测值里）
    wx.nextTick(() => {
      const query = wx.createSelectorQuery();
      query.select('.adv-swiper').boundingClientRect();
      query.exec((rectRes) => {
        const boxWidth = (rectRes && rectRes[0] && rectRes[0].width) || 300;
        // 并发读取每张图的真实宽高；读取失败按 1:1 兜底，避免整组轮播卡死
        Promise.all(fileIdList.map((src) => new Promise((resolve) => {
          wx.getImageInfo({
            src,
            success: (info) => resolve(info.height / info.width),
            fail: () => resolve(1)
          });
        }))).then((ratios) => {
          const advItemHeights = ratios.map((r) => Math.round(boxWidth * r));
          this.setData({
            advItemHeights,
            // 默认显示第一张图对应的高度
            swiperHeight: advItemHeights[0] || 300
          });
        });
      });
    });
  },

  // 新增：轮播切换时让 swiper 高度跟随当前图片的比例变化
  onSwiperChange(e) {
    const current = e.detail.current;
    const heights = this.data.advItemHeights;
    if (!heights || !heights.length) {
      return;
    }
    this.setData({
      advCurrent: current,
      swiperHeight: heights[current] || this.data.swiperHeight
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
