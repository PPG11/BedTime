# 本地开发

## 今晚关灯 M1 的开发入口

当前 `pages/night/index` 为默认入口，两个 Tab 是「今晚 / 我的」，另有归档、回执详情与关于页。作者已确认 800ms 留白、常规字号、系统无衬线与正常动效；声音首次默认关闭。M0 的体验对比页和五种模拟确认已移除。

后续提醒页为 `pages/reminder/index`，入口由 getState.reminderAvailable 控制。模拟器先注入 `tests/fixtures/night-simulator.js`，再注入 `tests/fixtures/reminder-simulator.js`，检查选时、同意 / 拒绝、取消和未知回执；两个夹具共同截断真实业务与发送，仅影响当前运行时。结束后重新编译，确认两个夹具均不存在，不把模拟订阅当成手机真实授权。

启用云连接时，今晚与我的在显示时调用 `bedtimeNight.getState`，该动作会幂等建档，不能当作纯只读接口。云端尚未部署或只有只读授权时，使用 `ENABLE_CLOUD=false yarn dev:weapp`。离线首页会明确显示无法确认；正式演示入口只在成功确认窗口外状态后显示；不产生本地假记录，设置开关在状态未确认时禁用。不要将离线构建用于发布。

模拟器可以通过自动化工具注入隔离的服务依赖，运行真实页面、控制器和 store；这是本地受控测试，不是云端落库。完成后刷新模拟器恢复真实服务绑定。测试用数据不要写入源码、个人历史或云集合。正式云函数与四集合已部署；实际云库隔离验收与真机边界见 [M1 交付记录](refactor-m1-delivery.md)。临时云验收须使用独立身份和可清理的测试前缀，不写入真实用户历史。

本地演示始终标注、固定示例句、不提交、不震动；退出演示返回普通首页。真实完成态的「放下手机」才调用退出 API。详细真机音频、后台 / 锁屏、系统大字号检查仍需补齐；Android 简测不代表这些项目全部通过。

静态素材由 `scripts/generate-night-assets.swift` 创建。只有修改素材时才需在 macOS 执行 `swift -module-cache-path /tmp/bedtime-swift-cache scripts/generate-night-assets.swift`；正常构建直接复制已入库的 PNG / WAV，不依赖 Swift。来源与图层参数见 [素材说明](../miniprogram/assets/night/README.md)。

## 工具链与安装

M2 新增 lights / public-card / dashboard / channels 页面，云函数为 bedtimeGrowth。页面联调先在今晚注入 `night-simulator.js`，再注入 `growth-simulator.js`；fixture 截断关灯、事件和 M2 调用。通过 `getApp().__growthFixture` 可切换 empty、suppressed、isAdmin、mode 和 status，覆盖空样本、隐私抑制、权限、网络错误、未知回执和失效。结束重新编译，恢复真实服务。部署前运行 `yarn cloud:prepare bedtimeGrowth`；配置和边界见 [M2 记录](m2-development.md)。

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

手动构建与开发监听共用本机进程锁，避免互相清空构建暂存目录；等待超过 30 秒明确报错。普通退出会释放锁。如果进程异常中断留下 `.native-build.lock`，先确认没有构建正在执行，再删除该锁重试；脚本不会按时长强占，也不会竞争回收旧锁。构建脚本自身变更后需重启已有监听，它不会热加载自己的实现。

前端没有运行时 npm 包，不需要点击「构建 npm」。云函数依赖由工作区与部署脚本管理，不能与前端 npm 构建混用。

用微信开发者工具导入**仓库根目录**，保留仓库中的 `project.config.json`：小程序目录是 `dist/`，云函数目录是 `cloudfunctions/`，AppID 也从该文件读取。个人模拟器等设置保存在已忽略的 `project.private.config.json`。不要把开发者工具根目录改成 `miniprogram/`，该目录仍包含待编译的 TypeScript。

云环境在构建时确定。构建和部署共用 `scripts/cloud-env.cjs`：先读取终端环境变量，再读取 `.env.local`，只使用 `CLOUD_ENV_ID`，没有默认环境或旧变量别名。临时指定测试环境：

```sh
CLOUD_ENV_ID=your-test-env-id yarn dev:weapp
```

修改 `.env.local` 会触发监听重建；修改终端环境变量需停止旧监听任务并重新启动。切换后在开发者工具重新编译小程序。

未配置环境时普通构建也会失败并保留旧 `dist/`，不会自动降级为离线版。只检查离线界面时使用 `ENABLE_CLOUD=false yarn dev:weapp`。上传小程序前执行 `yarn build:release`；该命令要求云能力启用，即使存在环境 ID 也拒绝 `ENABLE_CLOUD=false`。云函数部署使用同一配置且同样拒绝离线设置，详见[云环境与部署](cloud-deployment.md)。

## 原生布局检查

布局检查以主流 iPhone / Android 竖屏为重点，窄屏保留基本可用性；依作者 2026-11-08 补充，极短外屏不再作为深入优化或阶段放行条件。

`app.json` 启用了 `style: "v2"`。原生按钮带有默认宽度和外边距，单个类选择器可能覆盖不了 `button:not([size='mini'])`。自定义主按钮可使用 `button.<类名>:not([size='mini'])`，显式设置所需的 `width`、`margin`、`padding` 和文字对齐；不要只依赖父级 flex 对齐。提高基础选择器优先级后，也要核对按钮变体和禁用状态，避免基础颜色覆盖它们。

带宽度和内边距的卡片、输入框与 Picker 使用一致的 `box-sizing: border-box`。横向表单固定标签列，内容列允许收缩；长昵称、时间和状态文案要核对换行后的边界。屏幕宽度断点用 `px`，不用随视口同步缩放的 `rpx`。

页面样式改动后必须在微信模拟器检查实际渲染，并查看至少一个窄屏尺寸。需要有数据的列表或弹层时，可以注入仅影响当前页面展示的样例数据，覆盖长文本、空列表和操作区；这类检查不能记作真实云端业务联调。模板编译通过不足以证明按钮宽度、文字换行或控件对齐正确。

「今晚」普通首页固定在原生页面可用视口内，关闭整页滚动；原生 Tab 已处理底部安全区，页面不重复增加底部安全区高度。空间不足时缩减插画与重复说明，保留状态、真实 / 演示标识和操作。验证主流 iPhone / Android 与基础窄屏，覆盖长句回执、未知结果和返回恢复，用节点边界与实际滚动确认无溢出。我的、归档、详情、关于允许自然滚动。

`tests/fixtures/night-simulator.js` 仅供工具临时注入内存服务；同时替换事件发送，避免视觉样例污染真实事件。夹具不在小程序包中；检查完重新编译模拟器，确认恢复真实云服务。

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

涉及后端时，对改过的 JavaScript 执行 `node --check <路径>`，对受影响处理器做本地模拟；通过 `yarn cloud:preview <函数名>` 核对上传范围。当前检查清单见 [M1 交付记录](refactor-m1-delivery.md)。

## 常见问题

- **找不到小程序入口**：先运行构建，确认存在 `dist/app.json`，再检查导入的是仓库根目录。
- **源码改了但界面没变化**：确认监听任务正常、没有编译报错；再重新编译开发者工具。不要直接修改 `dist/`。
- **提示缺少云环境**：填写 `.env.local` 的 `CLOUD_ENV_ID`，并核对终端没有空值覆盖它；失败构建保留的 `dist/` 仍是上次产物。
- **云函数不存在或环境不可用**：核对构建环境、AppID 关联和云控制台中实际部署的函数。构建不会自动创建云环境。[官方排错说明](https://docs.cloudbase.net/recipes/add-cloud-function-wechat-miniprogram)
- **无法加载微信 API**：页面需在微信小程序运行时运行；普通浏览器与 Node 测试环境都不提供真实的 `wx`。
- **依赖下载证书错误**：检查当前网络的代理与信任证书配置。系统证书有效时可临时使用 `NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem yarn install --frozen-lockfile`，不要关闭证书校验。
