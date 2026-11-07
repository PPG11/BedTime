# 云开发与部署

## 云环境

BedTime 使用微信云开发（腾讯云 CloudBase）。[前端云配置](../src/config/cloud.ts) 当前指向 `cloud1-0gw1plhs593190e1`，[微信项目配置](../project.config.json) 的 AppID 是 `wxd489f0523662b0ea`。客户端通过 `Taro.cloud.callFunction` 调用云函数。云函数通过 `wx-server-sdk` 取得调用用户的 `OPENID`，并通过 `DYNAMIC_CURRENT_ENV` 连接函数所在环境的数据库。 [云端初始化](../cloudfunctions/common/cloud.js)

使用单独的测试云环境进行带写入的联调。先在云开发控制台确认测试环境已关联相应 AppID，再用 `TARO_APP_CLOUD_ENV_ID` 让前端构建与部署脚本指向同一个环境。`CLOUD_ENV_ID` 是部署脚本仍支持的旧变量，优先级低于 `TARO_APP_CLOUD_ENV_ID`，对前端构建无效。默认环境的用途和线上状态以有权限的控制台为准。 [官方云函数接入说明](https://docs.cloudbase.net/recipes/add-cloud-function-wechat-miniprogram)

```sh
TARO_APP_CLOUD_ENV_ID=your-test-env-id yarn dev:weapp
```

把示例环境 ID 换成真实测试环境。切换环境后重新构建，并在微信开发者工具刷新小程序。

## 部署流程

在仓库根目录安装依赖。运行上传前，打开微信开发者工具，用具有云环境权限的账号登录，并在安全设置中启用命令行调用所需的服务端口。部署脚本会查找 macOS 默认安装路径下的 CLI，非默认路径可通过 `WECHAT_CLI_PATH` 指定。 [微信开发者工具命令行文档](https://developers.weixin.qq.com/miniprogram/dev/devtools/cli.html)

先预览环境和要上传的函数目录名。

```sh
TARO_APP_CLOUD_ENV_ID=your-test-env-id yarn cloud:preview checkinStatus
yarn cloud:preview --all
```

预览只在本地计算上传范围，无需安装或登录微信开发者工具。获得该环境的上传授权后，使用实际环境 ID 和具体函数名执行上传。

```sh
TARO_APP_CLOUD_ENV_ID=your-test-env-id yarn upload:cloudfunctions checkinStatus
```

上传命令需要指定函数名或 `--all`。多个函数可以在命令末尾逐个列出。共享包 `cloudfunctions/common/` 通过 `file:../common` 被各函数引用，部署脚本会为相应函数准备依赖。修改共享模块后，上传范围应包括受影响的函数。部署记录按环境分别缓存，函数上传与小程序前端发布各自执行。 [部署脚本](../cloudfunctions/deploy.js)

## 控制台核验

1. 确认 AppID 关联、目标环境、函数列表、更新时间与版本。
2. 核对实际使用的数据库集合、查询索引和访问权限。集合和字段说明见[云函数与数据库](../cloudfunctions/README.md)。
3. 确认 `gnReactionsConsume` 和 `slotRollup` 的定时触发器是否已启用。仓库里的两个配置均为 `0 0 3 * * * *`，即按触发器时区每天 03:00。 [官方定时触发器说明](https://docs.cloudbase.net/cloud-function/timer-trigger)
4. 在指定测试环境从小程序调用受影响的业务，查看函数日志和写入结果，再记录环境、函数名与验证结果。

仓库配置和部署预演可以说明本地准备上传的内容。实际函数版本、部署地域、数据库规则和触发器状态需要从云开发控制台读取。
