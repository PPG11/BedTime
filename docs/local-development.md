# 本地开发指南

## 工具链

- Node.js 22 和 Yarn Classic 1.22.22。`.nvmrc` 指定 Node.js 主版本。仓库根目录的 `yarn.lock` 是 Yarn 1 格式，通过工作区统一安装前端与云函数依赖。
- 微信开发者工具。macOS 安装包按本机芯片选择 Apple 芯片或 Intel 版本。需要联调云端时，用已加入对应小程序项目并有云环境访问权限的微信账号登录。 [官方安装页面](https://developers.weixin.qq.com/miniprogram/dev/devtools/stable.html)
- Taro CLI 随项目依赖安装，使用 `yarn` 执行脚本即可调用。

macOS 上已安装 Homebrew 时，可以用下面的命令准备工具。将 `node@22` 路径放在前面，确保项目使用指定版本。新终端需要重新配置路径，使用 nvm 的环境可以在仓库根目录执行 `nvm use`。 [Node.js 公式](https://formulae.brew.sh/formula/node@22) · [Yarn 公式](https://formulae.brew.sh/formula/yarn) · [微信开发者工具安装包](https://formulae.brew.sh/cask/wechatwebdevtools)

```sh
brew install node@22 yarn
export PATH="$(brew --prefix node@22)/bin:$PATH"
brew install --cask wechatwebdevtools
```

## 安装和构建

在仓库根目录执行。

```sh
node --version
yarn --version
yarn install --frozen-lockfile
yarn typecheck
yarn build:weapp
```

开发时可用 `yarn dev:weapp` 监听文件变化。`dist/` 是生成目录，页面源码从 `src/` 修改。改动后重新构建并在开发者工具中编译或刷新。

用微信开发者工具导入仓库根目录。小程序目录 `dist/`、云函数目录 `cloudfunctions/` 和 AppID 由项目配置指定。编译可在本地完成，云端联调还依赖 AppID 关联、函数部署和数据库集合。用 `TARO_APP_CLOUD_ENV_ID` 指向测试环境，并在控制台核对实际选中的环境。 [项目配置](../project.config.json) · [云开发与部署](cloud-deployment.md)

## 改动后的检查

| 改动范围 | 检查 |
| --- | --- |
| 前端 | 执行 `yarn typecheck` 和 `yarn build:weapp`，确认 `dist/app.json` 已生成，再用开发者工具打开受影响页面 |
| 云函数 | 对修改过的入口和共享模块执行 `node --check <文件路径>`，用模拟数据核验业务分支；如需核对上传范围，执行 `yarn cloud:preview <函数目录名>` |
| 打卡周期 | 用 22:30 和 00:30 等目标时间覆盖窗口开启、过目标、跨午夜、窗口关闭和重复提交 |
| 心语和好友 | 在获准写入的测试环境中使用两个测试账号，覆盖空心语池、重复投稿、重进后奖励恢复、好友申请和解除 |

类型检查覆盖项目源码，跳过第三方 `.d.ts` 文件的内部校验。构建检查覆盖本地编译，模拟测试覆盖业务逻辑，微信开发者工具与真机检查覆盖运行时行为。云端联调时先确认环境和测试账号，记录本次实际完成的检查。

## 常见问题

- 工具提示找不到小程序入口时，先确认 `yarn build:weapp` 已完成，再检查导入目录是否为仓库根目录。
- macOS 上依赖下载若报 `unable to get local issuer certificate`，检查当前网络的证书配置。系统证书文件可用时，可以用 `NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem yarn install --frozen-lockfile` 加载额外的信任证书。若问题来自代理，在网络允许直连的情况下对本次安装使用直连。
- H5 能构建但无法加载业务数据时，切换到微信小程序调试。云服务层只支持 `WEAPP`，无云时应用会提示并清空已加载的用户数据。 [云服务平台判断](../src/services/cloud.ts)
- 启动提示云函数不存在或环境不可用时，核对本地 AppID 和环境 ID，再在控制台查看小程序关联和实际部署的函数。 [官方排错说明](https://docs.cloudbase.net/recipes/add-cloud-function-wechat-miniprogram)
