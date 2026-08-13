// app.js
App({
  onLaunch: function () {
    
    this.globalData = {
      // env 参数说明：
      //   env 参数决定接下来小程序发起的云开发调用（wx.cloud.xxx）会默认请求到哪个云环境的资源
      //   此处请填入环境 ID, 环境 ID 可打开云控制台查看
      //   如不填则使用默认环境（第一个创建的环境）
      env: "cloud1-6gh7jgl8c5b16a83"
      // cloud.init({ env: 'cloud1-6gh7jgl8c5b16a83' })
    };
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

    if (nickname) this.globalData.nickname = nickname;
    if (token) this.globalData.token = token;
    if (avatarUrl) this.globalData.avatarUrl = avatarUrl;
    if (openid) this.globalData.openid = openid;

    if (role && token) {
      this.globalData.userRole = role;
      this.globalData.needChooseRole = false;
      console.log("App 启动：身份已绑定 →", role);
    } else {
      this.globalData.needChooseRole = true;
      console.log("App 启动：需要选择身份");
    }

    // MVP: 暂时绕过登录页，统一使用静默教练身份
    this.ensureSilentLogin();
    // 新增静默登录补库：启动后补调登录云函数，自动创建/更新 users 集合中的当前用户
    this.ensureCloudUserRecord();

    if (this.globalData.token) {
      this.refreshUserInfo();
    }
  },

  // MVP: 如果本地没有登录态，则自动补一份默认 C 身份
  ensureSilentLogin: function () {
    if (this.globalData.token && this.globalData.userRole && this.globalData.nickname) {
      return;
    }

    const silentUser = {
      token: 'silent_c_user',
      userRole: 'C',
      nickname: '默认教练',
      avatarUrl: '',
      needChooseRole: false
    };

    this.globalData.token = silentUser.token;
    this.globalData.userRole = silentUser.userRole;
    this.globalData.nickname = silentUser.nickname;
    this.globalData.avatarUrl = silentUser.avatarUrl;
    this.globalData.needChooseRole = silentUser.needChooseRole;

    wx.setStorageSync('token', silentUser.token);
    wx.setStorageSync('userRole', silentUser.userRole);
    wx.setStorageSync('nickname', silentUser.nickname);
    wx.setStorageSync('avatarUrl', silentUser.avatarUrl);

    console.log('App 启动：已启用静默登录，默认身份为 C');
  },

  // 新增静默登录补库方法：保留本地静默登录，同时把当前微信用户同步到云端 users 集合
  ensureCloudUserRecord: function () {
    if (!wx.cloud) {
      return;
    }

    wx.cloud.callFunction({
      name: 'NEWDL_login_fun',
      data: {
        nickname: this.globalData.nickname || '默认教练',
        role: this.globalData.userRole || 'C',
        avatarUrl: this.globalData.avatarUrl || '',
        envVersion: this.globalData.miniEnvVersion || 'develop'
      },
      success: (res) => {
        const result = res && res.result;
        if (!result || result.status !== 'success') {
          console.error('静默登录补库失败', result);
          return;
        }

        // 新增同步成功回填：把云端真实用户信息写回本地，后续业务统一使用真实 token
        this.globalData.token = result.token || this.globalData.token;
        this.globalData.userRole = result.role || this.globalData.userRole;
        this.globalData.nickname = result.nickname || this.globalData.nickname;
        this.globalData.avatarUrl = result.avatarUrl || this.globalData.avatarUrl || '';
        this.globalData.needChooseRole = false;

        wx.setStorageSync('token', this.globalData.token);
        wx.setStorageSync('userRole', this.globalData.userRole);
        wx.setStorageSync('nickname', this.globalData.nickname);
        wx.setStorageSync('avatarUrl', this.globalData.avatarUrl);

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
  }
});
