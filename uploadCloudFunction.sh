# 新增发布前同步：开发入口统一写在 dev_index.js，发布前先覆盖到 true_index.js。
node "./cloudfunctions/NEW_DL_fun/sync-dev-to-true.js"

${installPath} cloud functions deploy --e ${envId} --n quickstartFunctions --r --project ${projectPath}
