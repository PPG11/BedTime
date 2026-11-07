# 原生小程序架构

前端采用微信原生 `App`、`Page`、WXML、WXSS，逻辑使用 TypeScript。CloudBase 云函数继续运行 Node.js / CommonJS。两端共享业务契约，通过微信云函数调用衔接，不引入新的后端框架。

## 目录与依赖方向

```text
miniprogram/
  app.ts / app.json / app.wxss     应用生命周期、路由、全局样式
  pages/home/                     打卡、统计和晚安心语
  pages/friends/                  好友、申请、备注和邀请
  pages/profile/                  昵称、目标时间和 UID
  state/app-data.ts               绑定真实服务，导出共享状态实例
  state/create-app-store.ts       用户、作息、打卡状态与订阅实现
  services/cloud.ts              微信云初始化与统一调用
  services/                      各业务请求与响应转换
  utils/                         日期、统计、缓存、存储和分享
  types/                         业务类型
  config/                        云环境配置
  assets/                        图标等静态资源
cloudfunctions/
  <函数名>/index.js               可独立部署的云函数入口
  common/                        服务端共享规则与数据工具
scripts/                         构建及验证脚本
```

调用方向为 **页面 → 共享状态 / 服务 → 云连接 → 云函数 → 数据库**。纯工具模块不调用页面；云函数不依赖前端产物。页面内专用的交互或视图计算放在对应页面目录，需要跨页复用时再提取模块，避免先建一套通用框架。

## 页面、状态与生命周期

`Page` 的 `data` 供 WXML 使用，保存字符串、数字、布尔值、普通数组和对象。`Date`、订阅回调、定时器句柄、请求标识等不直接放入视图数据。统计、日期格式化和按钮文案在 TypeScript 中计算后通过 `setData` 更新。

[`state/app-data.ts`](../miniprogram/state/app-data.ts) 绑定真实服务并导出共享实例，替代原来的 React Context；[`state/create-app-store.ts`](../miniprogram/state/create-app-store.ts) 实现快照、订阅、刷新与跨页更新，可注入服务做独立测试。页面通过订阅获得用户与打卡变动；云端完成的资料更新再同步到共享状态，其他 Tab 无需各自维护一份用户副本。初始化与并发刷新合并，避免页面同时出现时重复读取。

页面显示时恢复需要的状态与时钟，隐藏时停止页面定时器，卸载时释放订阅。异步返回需确认仍属于当前页面、用户与打卡周期。WXML 事件通过 `bindtap`、`bindinput`、`bindchange` 等调用页面方法，事件参数从 `detail` 或 `currentTarget.dataset` 取值。

## 云服务边界

[`services/cloud.ts`](../miniprogram/services/cloud.ts) 初始化微信云并统一处理调用错误。业务请求通过用户、打卡、心语和好友四个领域函数处理。服务端基于微信身份鉴权，校验输入和所属关系，再调用数据库。页面及服务层仅接触业务响应。

## 日期与持久化

打卡采用周期日期，而非直接取设备当前日历日期。服务端从 [周期规则](../cloudfunctions/common/time.js) 决定实际周期和状态，前端从 [`utils/checkin.ts`](../miniprogram/utils/checkin.ts) 的 `resolveCheckInCycle` 取得周期、目标时间与窗口。默认开放时间为目标前 12 小时、关闭时间为目标后 6 小时，使用包含开始、不含结束的区间。

例如目标 22:30 时，次日 01:00 和 04:29 仍属于前一晚，04:30 起窗口关闭并切换下一周期。目标 00:30 时，前一晚 23:30 属于次日的目标周期。首页按钮、状态恢复、统计和心语关联应使用同一周期；请求及返回值见[云函数契约](../cloudfunctions/README.md)。

用户资料与打卡由云端持久化，本地好友备注使用微信存储。保留既有存储键，避免框架迁移丢失本地备注。客户端缓存不能替代云端幂等与权限检查。

## 构建与发布边界

[`scripts/build.mjs`](../scripts/build.mjs) 编译 TypeScript 并复制原生资源到 `dist/`。微信开发者工具读取 `dist/`，源码目录保持为 `miniprogram/`。前端零运行时 npm 依赖，微信官方类型声明只用于开发期校验。

云环境在构建时解析，前端和部署使用同一 `CLOUD_ENV_ID` 约定。配置与部署细节见[云环境与部署](cloud-deployment.md)。微信自带的 `wcc` / `wcsc` 可以独立检查 WXML / WXSS 编译，但不执行页面生命周期、微信 API 或云调用。测试、构建、模板编译、模拟器运行、真机联调和发布需分别记录结果。
