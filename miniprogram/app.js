// app.js
const {
  BIZ_ROLE_VISITOR,
  createEmptyOrganizationProfile,
  normalizeOrganizationProfile,
  resolveBusinessRole
} = require('./utils/bizRole');

// 新增全局普通分享开关：给所有页面补默认 onShareAppMessage，并自动打开右上角普通分享按钮
const originalPage = Page;

// 新增全局默认分享标题：普通页面没有自定义分享文案时，统一走这一份兜底文案
const GLOBAL_DEFAULT_SHARE_TITLE = '运动云';

// 新增页面路径拼装：普通分享默认回到当前页，并尽量保留当前页 query 参数
function buildGlobalSharePath(pageInstance) {
  const route = (pageInstance && pageInstance.route) || 'pages/index/index';
  const pageOptions = ((pageInstance && pageInstance.options) || {});
  const queryString = Object.keys(pageOptions)
    .filter(key => pageOptions[key] !== undefined && pageOptions[key] !== null && String(pageOptions[key]).trim() !== '')
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(pageOptions[key])}`)
    .join('&');

  return `/${route}${queryString ? `?${queryString}` : ''}`;
}

// 新增普通分享菜单展示：页面加载和回显时都补一次，避免部分页面右上角不出现“转发”
function ensureGlobalShareMenu() {
  if (!wx.showShareMenu) {
    return;
  }

  wx.showShareMenu({
    menus: ['shareAppMessage']
  });
}

// 新增全局 Page 包装：没有自定义分享逻辑的页面自动补默认分享，已有页面继续走原来的业务分享逻辑
Page = function(pageOptions = {}) {
  const wrappedPageOptions = { ...pageOptions };
  const originalOnLoad = wrappedPageOptions.onLoad;
  const originalOnShow = wrappedPageOptions.onShow;
  const originalOnShareAppMessage = wrappedPageOptions.onShareAppMessage;

  wrappedPageOptions.onLoad = function(...args) {
    ensureGlobalShareMenu();

    if (typeof originalOnLoad === 'function') {
      return originalOnLoad.apply(this, args);
    }
  };

  wrappedPageOptions.onShow = function(...args) {
    ensureGlobalShareMenu();

    if (typeof originalOnShow === 'function') {
      return originalOnShow.apply(this, args);
    }
  };

  wrappedPageOptions.onShareAppMessage = function(...args) {
    if (typeof originalOnShareAppMessage === 'function') {
      const customShareConfig = originalOnShareAppMessage.apply(this, args);
      if (customShareConfig) {
        return customShareConfig;
      }
    }

    return {
      title: GLOBAL_DEFAULT_SHARE_TITLE,
      path: buildGlobalSharePath(this)
    };
  };

  return originalPage(wrappedPageOptions);
};

App({
  onLaunch: function (options) {
    
    this.globalData = {
      // env 参数说明：
      // env 参数决定接下来小程序发起的云开发调用（wx.cloud.xxx）会默认请求到哪个云环境的资源
      //   此处请填入环境 ID, 环境 ID 可打开云控制台查看
      //   如不填则使用默认环境（第一个创建的环境）
      env: "cloud1-6gh7jgl8c5b16a83",
      // 新增业务角色缓存：在不打断原有 C / V 权限链路的前提下，为机构模式补一层业务分流
      bizRole: BIZ_ROLE_VISITOR,
      organizationProfile: createEmptyOrganizationProfile()
      // cloud.init({ env: 'cloud1-6gh7jgl8c5b16a83' })
    };
    // 新增唤起来源记录：分享预览态是否继续生效，统一看本次 onShow 的进入来源
    this.globalData.enterSource = 'normal';
    this.globalData.enterScene = 0;
    this.globalData.enterPath = '';
    this.globalData.enterQuery = {};
    this.globalData.shareSessionActive = false;
    // 新增环境版本识别：develop 使用 NDLdev_，trial/release 使用 NDLreal_
    const miniEnvVersion = this.getMiniEnvVersion();
    this.globalData.miniEnvVersion = miniEnvVersion;
    this.globalData.dataPrefix = this.getDataPrefix(miniEnvVersion);
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      wx.cloud.init({
        env: this.globalData.env,
        traceUser: true,
      });
    }
    const role = wx.getStorageSync('userRole');
    const nickname = wx.getStorageSync('nickname');
    const token = wx.getStorageSync('token');
    const avatarUrl = wx.getStorageSync('avatarUrl');
    const openid = wx.getStorageSync('openid');
    const cachedBizRole = wx.getStorageSync('bizRole');
    const cachedOrganizationProfile = normalizeOrganizationProfile(wx.getStorageSync('organizationProfile') || {});

    if (nickname) this.globalData.nickname = nickname;
    if (token) this.globalData.token = token;
    if (avatarUrl) this.globalData.avatarUrl = avatarUrl;
    if (openid) this.globalData.openid = openid;
    if (cachedBizRole) this.globalData.bizRole = cachedBizRole;
    this.globalData.organizationProfile = cachedOrganizationProfile;

    if (role && token) {
      this.globalData.userRole = role;
      this.globalData.needChooseRole = false;
      console.log("App 启动：身份已绑定 →", role);
    } else {
      this.globalData.needChooseRole = true;
      console.log("App 启动：需要选择身份");
    }

    // 新增首次启动来源初始化：冷启动时就先记住当前是不是分享唤起
    this.updateEnterContext(options);
    // MVP: 暂时绕过登录页，统一使用静默访客身份；后续再按资料/发课行为自动升级成 C
    this.ensureSilentLogin();
    // 新增静默登录补库：启动后补调登录云函数，自动创建/更新 users 集合中的当前用户
    this.ensureCloudUserRecord();

    if (this.globalData.token) {
      this.refreshUserInfo();
    }
  },

  onShow: function (options) {
    this.updateEnterContext(options);
  },

  // MVP: 如果本地没有登录态，则自动补一份默认 V 身份；是否升级成 C 交给业务痕迹判断
  ensureSilentLogin: function () {
    if (this.globalData.token && this.globalData.userRole && this.globalData.nickname) {
      return;
    }

    const silentUser = {
      token: 'silent_v_user',
      userRole: 'V',
      bizRole: BIZ_ROLE_VISITOR,
      nickname: '微信用户',
      avatarUrl: '',
      needChooseRole: false
    };

    this.saveUserIdentity(silentUser);

    console.log('App 启动：已启用静默登录，默认身份为 V');
  },

  // 新增静默登录补库方法：保留本地静默登录，同时把当前微信用户同步到云端 users 集合
  ensureCloudUserRecord: function () {
    if (!wx.cloud) {
      return;
    }

    wx.cloud.callFunction({
      name: 'NEWDL_login_fun',
      data: {
        nickname: this.globalData.nickname || '微信用户',
        role: this.globalData.userRole || 'V',
        avatarUrl: this.globalData.avatarUrl || '',
        // 新增启动补库标记：让云函数识别为轻量建档，不在首屏阶段跑重型审核和角色重算
        bootstrapLogin: true,
        envVersion: this.globalData.miniEnvVersion || 'develop',
        // 新增首次进入来源：onLaunch 解析出的场景值/启动路径/来源类型/启动 query，仅用于新建用户时写入 firstLoginFrom
        firstLoginFrom: {
          scene: this.globalData.enterScene || 0,
          path: this.globalData.enterPath || '',
          source: this.globalData.enterSource || 'normal',
          query: this.globalData.enterQuery || {}
        }
      },
      success: (res) => {
        const result = res && res.result;
        if (!result || result.status !== 'success') {
          console.error('静默登录补库失败', result);
          return;
        }

        // 新增同步成功回填：把云端真实用户信息写回本地，再按资料/发课痕迹重算最终角色
        this.saveUserIdentity({
          token: result.token || this.globalData.token,
          userRole: result.role || this.globalData.userRole || 'V',
          bizRole: this.globalData.bizRole || BIZ_ROLE_VISITOR,
          nickname: result.nickname || this.globalData.nickname || '微信用户',
          avatarUrl: result.avatarUrl || this.globalData.avatarUrl || '',
          openid: result.openid || this.globalData.openid || wx.getStorageSync('openid') || '',
          needChooseRole: false
        });
        this.resolveUserRoleByBusiness(true);

        console.log('App 启动：静默登录补库成功');
      },
      fail: (error) => {
        console.error('静默登录补调 NEWDL_login_fun 失败', error);
      }
    });
  },

  refreshUserInfo: function() {
    // 这里可以添加从云端刷新用户信息的逻辑
    // 刷新完成后，执行回调通知
    if (this.globalDataReadyCallback) {
      this.globalDataReadyCallback(this.globalData)
    }
  },

  // 新增环境版本工具：优先读取小程序当前版本，读不到时默认 develop
  getMiniEnvVersion: function () {
    try {
      const accountInfo = wx.getAccountInfoSync();
      return (accountInfo && accountInfo.miniProgram && accountInfo.miniProgram.envVersion) || 'develop';
    } catch (error) {
      return 'develop';
    }
  },

  // 新增数据库前缀工具：开发版走 NDLdev_，体验版和正式版走 NDLreal_
  getDataPrefix: function (envVersion) {
    const runtimeEnvVersion = envVersion || this.globalData.miniEnvVersion || 'develop';
    return runtimeEnvVersion === 'develop' ? 'NDLdev_' : 'NDLreal_';
  },

  // 新增当前唤起来源判断：课程分享用 from=share / shareEntry=1，资料分享用 fromShare=1，三者都算本次分享进入
  buildEnterContext: function (options = {}) {
    const query = (options && options.query) || {};
    const from = String(query.from || '').trim();
    const shareEntry = String(query.shareEntry || '').trim();
    const fromShare = String(query.fromShare || '').trim();
    const isShareEnter = from === 'share' || shareEntry === '1' || fromShare === '1';

    return {
      enterSource: isShareEnter ? 'share' : 'normal',
      enterScene: Number((options && options.scene) || 0),
      enterPath: String((options && options.path) || '').trim(),
      // 新增启动 query 透传：用于首次登录来源记录原始参数（如 from/shareEntry/id 等）
      enterQuery: query,
      shareSessionActive: isShareEnter,
      lastEnterAt: Date.now()
    };
  },

  // 新增全局唤起来源写入：分享页 onShow 时会据此判断旧分享态是否已经失效
  updateEnterContext: function (options = {}) {
    const enterContext = this.buildEnterContext(options);
    this.globalData.enterSource = enterContext.enterSource;
    this.globalData.enterScene = enterContext.enterScene;
    this.globalData.enterPath = enterContext.enterPath;
    this.globalData.enterQuery = enterContext.enterQuery;
    this.globalData.shareSessionActive = enterContext.shareSessionActive;
    this.globalData.lastEnterAt = enterContext.lastEnterAt;
    return enterContext;
  },

  // 新增统一身份回填：token / role / nickname / avatar / openid 全部从这里落全局和缓存
  saveUserIdentity: function (identity = {}) {
    const nextToken = typeof identity.token === 'string' ? identity.token : (this.globalData.token || '');
    const explicitRole = typeof (identity.userRole || identity.role) === 'string'
      ? (identity.userRole || identity.role)
      : (this.globalData.userRole || 'V');
    const nextOrganizationProfile = normalizeOrganizationProfile(
      identity.organizationProfile || identity.orgProfile || this.globalData.organizationProfile || {}
    );
    const nextBizRole = resolveBusinessRole({
      ...identity,
      userRole: explicitRole,
      organizationProfile: nextOrganizationProfile,
      bizRole: identity.bizRole || this.globalData.bizRole
    });
    const nextRole = nextBizRole === BIZ_ROLE_VISITOR ? 'V' : 'C';
    const nextNickname = typeof identity.nickname === 'string' ? identity.nickname : (this.globalData.nickname || '微信用户');
    const nextAvatarUrl = typeof identity.avatarUrl === 'string' ? identity.avatarUrl : (this.globalData.avatarUrl || '');
    const nextOpenid = typeof identity.openid === 'string' ? identity.openid : (this.globalData.openid || '');
    const nextNeedChooseRole = typeof identity.needChooseRole === 'boolean'
      ? identity.needChooseRole
      : false;

    this.globalData.token = nextToken;
    this.globalData.userRole = nextRole || 'V';
    this.globalData.bizRole = nextBizRole || BIZ_ROLE_VISITOR;
    this.globalData.organizationProfile = nextOrganizationProfile;
    this.globalData.nickname = nextNickname || '微信用户';
    this.globalData.avatarUrl = nextAvatarUrl || '';
    this.globalData.needChooseRole = nextNeedChooseRole;

    wx.setStorageSync('token', this.globalData.token || '');
    wx.setStorageSync('userRole', this.globalData.userRole || 'V');
    wx.setStorageSync('bizRole', this.globalData.bizRole || BIZ_ROLE_VISITOR);
    wx.setStorageSync('organizationProfile', this.globalData.organizationProfile || createEmptyOrganizationProfile());
    wx.setStorageSync('nickname', this.globalData.nickname || '微信用户');
    wx.setStorageSync('avatarUrl', this.globalData.avatarUrl || '');

    if (nextOpenid) {
      this.globalData.openid = nextOpenid;
      wx.setStorageSync('openid', nextOpenid);
    }

    if (this.globalDataReadyCallback) {
      this.globalDataReadyCallback(this.globalData);
    }
  },

  // 新增业务身份读取：页面统一从这里拿“平台身份 + 业务角色 + 机构信息”，避免各页自己拼装
  getBusinessIdentity: function () {
    const organizationProfile = normalizeOrganizationProfile(
      this.globalData.organizationProfile || wx.getStorageSync('organizationProfile') || {}
    );
    const userRole = this.globalData.userRole || wx.getStorageSync('userRole') || 'V';
    const bizRole = resolveBusinessRole({
      userRole,
      bizRole: this.globalData.bizRole || wx.getStorageSync('bizRole') || '',
      organizationProfile
    });

    return {
      userRole,
      bizRole,
      organizationProfile
    };
  },

  // 新增业务模式切换：当前先用本地身份切换承接机构分流，后续接真实机构接口时仍可复用
  switchBusinessRole: function (bizRole, organizationProfile = {}) {
    const nextOrganizationProfile = normalizeOrganizationProfile(organizationProfile);
    this.saveUserIdentity({
      userRole: bizRole === BIZ_ROLE_VISITOR ? 'V' : 'C',
      bizRole,
      organizationProfile: nextOrganizationProfile,
      needChooseRole: false
    });
  },

  // 新增教练资料痕迹判断：用户自己填写过对外展示资料，即可升级成 C
  hasCoachProfile: function (profile = {}) {
    const profileKeys = [
      'avatarUrl',
      'phone',
      'experienceLevel',
      'studentCountLevel',
      'city',
      'address',
      'basicPhotoProof',
      'aboutMe',
      'workExperience',
      'education',
      'educationPhotoProof',
      'skills',
      'languages',
      'honors',
      'relatedCertificates',
      'honorShowcase'
    ];

    return profileKeys.some(key => String(profile[key] || '').trim());
  },

  // 新增业务角色重算：当前用户只要有资料痕迹或发课痕迹，就自动视为 C，否则统一视为 V
  resolveUserRoleByBusiness: function (forceRefresh = false) {
    if (this.roleResolvePromise) {
      return this.roleResolvePromise;
    }

    if (!wx.cloud) {
      return Promise.resolve(this.globalData.userRole || 'V');
    }

    const currentToken = this.globalData.token || wx.getStorageSync('token') || '';

    this.roleResolvePromise = Promise.all([
      wx.cloud.callFunction({
        name: 'NEWDL_mine_user',
        data: {
          action: 'getProfile',
          envVersion: this.globalData.miniEnvVersion || 'develop'
        }
      }).catch(() => null),
      wx.cloud.callFunction({
        name: 'NEWDL_execution_order',
        data: {
          action: 'list_myself',
          page: 1,
          limit: forceRefresh ? 50 : 20,
          userId: currentToken,
          envVersion: this.globalData.miniEnvVersion || 'develop'
        }
      }).catch(() => null)
    ]).then(([profileRes, orderRes]) => {
      const profile = (profileRes && profileRes.result && profileRes.result.profile) || {};
      const orderList = (orderRes && orderRes.result && orderRes.result.data) || [];
      const myOpenid = this.globalData.openid || wx.getStorageSync('openid') || '';
      const myToken = this.globalData.token || currentToken;
      const hasCoachProfile = this.hasCoachProfile(profile);
      const hasPublishedCourse = (orderList || []).some(item => {
        const publisherOpenid = String((item && item.publisher_openid) || '').trim();
        const publisherId = String((item && item.publisher_Id) || '').trim();
        return (myOpenid && publisherOpenid === myOpenid) || (myToken && publisherId === myToken);
      });
      const currentIdentity = this.getBusinessIdentity();
      const nextRole = currentIdentity.organizationProfile.orgId || hasCoachProfile || hasPublishedCourse ? 'C' : 'V';

      if (nextRole !== (this.globalData.userRole || 'V')) {
        this.saveUserIdentity({
          userRole: nextRole,
          bizRole: currentIdentity.bizRole,
          organizationProfile: currentIdentity.organizationProfile,
          needChooseRole: false
        });
      }

      return nextRole;
    }).finally(() => {
      this.roleResolvePromise = null;
    });

    return this.roleResolvePromise;
  }
});
