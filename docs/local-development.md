# 本地开发

## 工具链与安装

使用 Node.js 22、Yarn Classic 1.22.22 和微信开发者工具。`.nvmrc` 记录 Node 主版本，`package.json` 记录 Yarn 版本，根目录 `yarn.lock` 统一锁定开发工具和云函数工作区依赖。

```sh
node --version
yarn --version
yarn install --frozen-lockfile
```

首次将 `.env.example` 复制为 `.env.local`，填入与小程序关联的 `CLOUD_ENV_ID`；已有本地配置不要覆盖。配置完成后执行 `yarn verify`。`.env.local` 已被 Git 忽略，模板不包含实际环境或凭据。

微信开发者工具从[官方安装页面](https://developers.weixin.qq.com/miniprogram/dev/devtools/stable.html)下载。联调云端时，使用具有该小程序和云环境权限的账号登录。

## 原生构建与日常开发

```sh
# 单次构建
yarn build:weapp
# 监听源码变化
yarn dev:weapp
```

构建入口是 [`scripts/build.mjs`](../scripts/build.mjs)。TypeScript 编译为小程序可运行的 JavaScript，WXML、WXSS、JSON 和图片按目录复制到 `dist/`。应用入口是 `miniprogram/app.ts` 与 `app.json`，页面各自使用 `index.ts`、`index.wxml`、`index.wxss`、`index.json`。修改源码后由监听任务重建，再在微信开发者工具中编译。

监听覆盖源码新增、修改、删除，以及 `tsconfig.json` 和 `.env.local` 的变化；系统文件事件不可用时会自动改为定期检查。构建失败时保留上一次成功产物，修正错误后会重新构建。

前端没有运行时 npm 包，不需要点击「构建 npm」。云函数依赖由工作区与部署脚本管理，不能与前端 npm 构建混用。

用微信开发者工具导入**仓库根目录**，保留仓库中的 `project.config.json`：小程序目录是 `dist/`，云函数目录是 `cloudfunctions/`，AppID 也从该文件读取。个人模拟器等设置保存在已忽略的 `project.private.config.json`。不要把开发者工具根目录改成 `miniprogram/`，该目录仍包含待编译的 TypeScript。

云环境在构建时确定。构建和部署共用 `scripts/cloud-env.cjs`：先读取终端环境变量，再读取 `.env.local`，只使用 `CLOUD_ENV_ID`，没有默认环境或旧变量别名。临时指定测试环境：

```sh
CLOUD_ENV_ID=your-test-env-id yarn dev:weapp
```

修改 `.env.local` 会触发监听重建；修改终端环境变量需停止旧监听任务并重新启动。切换后在开发者工具重新编译小程序。

未配置环境时普通构建也会失败并保留旧 `dist/`，不会自动降级为离线版。只检查离线界面时使用 `ENABLE_CLOUD=false yarn dev:weapp`。上传小程序前执行 `yarn build:release`；该命令要求云能力启用，即使存在环境 ID 也拒绝 `ENABLE_CLOUD=false`。云函数部署使用同一配置且同样拒绝离线设置，详见[云环境与部署](cloud-deployment.md)。

## 原生布局检查

`app.json` 启用了 `style: "v2"`。原生按钮带有默认宽度和外边距，单个类选择器可能覆盖不了 `button:not([size='mini'])`。自定义主按钮可使用 `button.<类名>:not([size='mini'])`，显式设置所需的 `width`、`margin`、`padding` 和文字对齐；不要只依赖父级 flex 对齐。提高基础选择器优先级后，也要核对按钮变体和禁用状态，避免基础颜色覆盖它们。

带宽度和内边距的卡片、输入框与 Picker 使用一致的 `box-sizing: border-box`。横向表单固定标签列，内容列允许收缩；长昵称、时间和状态文案要核对换行后的边界。屏幕宽度断点用 `px`，不用随视口同步缩放的 `rpx`。

页面样式改动后必须在微信模拟器检查实际渲染，并查看至少一个窄屏尺寸。需要有数据的列表或弹层时，可以注入仅影响当前页面展示的样例数据，覆盖长文本、空列表和操作区；这类检查不能记作真实云端业务联调。模板编译通过不足以证明按钮宽度、文字换行或控件对齐正确。

## 检查命令与覆盖范围

| 命令 / 操作 | 能证明什么 |
| --- | --- |
| `yarn typecheck` | 前端源码满足 TypeScript 约束 |
| `yarn test` | 本地测试覆盖的纯逻辑和模拟调用行为 |
| `yarn build:weapp` | TS 编译和资源输出成功；产物可供微信工具读取 |
| `yarn build:release` | 生成启用云开发的产物；不证明环境在线可用或已发布 |
| `yarn verify` | 依次完成上述三项 |
| 微信 `wcc` / `wcsc` 编译 | 原生 WXML / WXSS 能通过对应编译器，不证明页面运行正常 |
| 微信开发者工具模拟器运行 | 页面生命周期、界面交互与模拟器中的微信 API 行为 |
| 指定环境的双账号 / 真机联调 | 微信 API、权限、云函数和持久化的实际行为 |

类型检查跳过第三方声明内部校验。测试使用本地模拟时不连接 CloudBase。原生模板编译成功不等于已在模拟器中运行；模拟器检查也不能替代真机与双账号联调。构建不是发布，也不证明线上函数版本正确。

涉及后端时，对改过的 JavaScript 执行 `node --check <路径>`，对受影响处理器做本地模拟；通过 `yarn cloud:preview <函数名>` 核对上传范围。完整的页面手工检查清单见[原生迁移说明](migration-native.md)。

## 常见问题

- **找不到小程序入口**：先运行构建，确认存在 `dist/app.json`，再检查导入的是仓库根目录。
- **源码改了但界面没变化**：确认监听任务正常、没有编译报错；再重新编译开发者工具。不要直接修改 `dist/`。
- **提示缺少云环境**：填写 `.env.local` 的 `CLOUD_ENV_ID`，并核对终端没有空值覆盖它；失败构建保留的 `dist/` 仍是上次产物。
- **云函数不存在或环境不可用**：核对构建环境、AppID 关联和云控制台中实际部署的函数。构建不会自动创建云环境。[官方排错说明](https://docs.cloudbase.net/recipes/add-cloud-function-wechat-miniprogram)
- **无法加载微信 API**：页面需在微信小程序运行时运行；普通浏览器与 Node 测试环境都不提供真实的 `wx`。
- **依赖下载证书错误**：检查当前网络的代理与信任证书配置。系统证书有效时可临时使用 `NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem yarn install --frozen-lockfile`，不要关闭证书校验。
