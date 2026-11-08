# BedTime 仓库指南

当前产品是「今晚关灯」M1，采用原生 **TypeScript + WXML + WXSS + CloudBase**。真实关灯、恢复、私有归档、夜签图片、偏好和最少观测已实现；实际验收和仍需真机确认的项目以 [M1 交付记录](docs/refactor-m1-delivery.md)为准。旧打卡、好友、心语前端与业务规则已移除，不建设兼容或迁移层。

后续增量为[一次性订阅提醒](docs/reminder-development.md)：独立 reminder 页面、bedtimeNight 的三个提醒动作、bedtimeReminderDispatch 定时发送。预约留在 n_users，无新集合。仅用户主动订阅后安排一次，未知发送不重试；实际启用与验证状态见增量记录。

## 从哪里开始

- [README](README.md)、[架构](docs/architecture.md)、[产品规格](docs/product-plan-tonight-lights-out-v1.1.md)。
- [本地开发](docs/local-development.md)、[云部署](docs/cloud-deployment.md)、[云契约](cloudfunctions/README.md)、[维护指南](docs/night-operations.md)。
- 功能开发和联调使用 [.agents/skills/bedtime-development/SKILL.md](.agents/skills/bedtime-development/SKILL.md)。M0 与 M1 第一段记录为历史材料，不将当时未部署状态当作当前状态。

## 代码入口

| 范围 | 入口 |
| --- | --- |
| 页面和路由 | `miniprogram/pages/{night,me,archive,receipt,about}/`、`app.json` |
| 唯一体验参数 | `config/night-experience.ts` |
| 手势、仪式、平台恢复 | `components/`、`utils/hold-gesture.ts`、`pages/night/{night-controller,ceremony}.ts`、`utils/night-platform.ts` |
| 共享状态和事件队列 | `state/{create-night-store,night-store,night-events}.ts` |
| 云调用与校验 | `services/{night,cloud}.ts`、`types/night.ts` |
| 图片 | `utils/night-card.ts`、`pages/receipt/` |
| 云业务 | `cloudfunctions/bedtimeNight/`、`common/{nights,night-time,night-phrases,night-events,night-transaction}.js` |
| 构建、环境、部署 | `scripts/build.mjs`、`scripts/cloud-env.cjs`、`cloudfunctions/deploy.js` |
| 私有维护 | `scripts/night-{export,report,maintenance}.mjs` |

## 已确认的产品决定

- 作者在 iPhone 体验和 Android 简测后已放行 M1，不重复请求 M0 放行。长按 800ms、暗屏 400ms、留白 800ms、出句 400ms；减少动效黑色 800ms、零过渡。常规字号、系统无衬线、正常动效，声音默认关闭、震动默认开启。原型 250ms 不是线上延迟。
- 演示始终标注、无记录 / 事件 / 震动，结束只返回普通页；真实「放下手机」才尝试退出。恢复不续按压、不补播。
- 首页一屏不滚动，重点覆盖主流 iPhone / Android 竖屏；保留窄屏基本可用性，不深入优化极短屏。
- 2026-11-08 作者明确授权本地与云端全部开发、部署、权限 / 索引设置和必要联调，后续 MCP 操作不用逐项再问。此前 read 是 ready 的误解。已确认 AppID `wxd489f0523662b0ea`、环境 `cloudbase-d0gcfmrvdb974536e`。正式公开发布由作者决定。

## 实现约定

- 页面负责交互与生命周期，服务负责调用与校验，store 负责共享状态，纯工具负责规则。Page data 只放可序列化字段；隐藏停止定时器 / 音频，卸载取消订阅；异步结果检查身份与代际。
- 修改 `miniprogram/`，不直接修改生成的 `dist/`。不引入 Taro、React、H5 或未说明打包方式的运行时依赖。原生 v2 按钮显式宽度 / 外边距 / border-box；窄屏断点用 px。
- 服务端只从微信上下文鉴权。微信附加的 userInfo / tcbContext 可接受但不可用作身份；其它额外业务字段拒绝。四集合禁止客户端直读直写。
- 北京时间 20:00—06:00，正午翻夜。closeLight 先读原记录，非事务读空后事务再读，已有记录优先，只有新建才查窗口；每次重试重新取时。发布稿、私人记录、首末摘要同事务。
- 只有明确事务冲突可有限重试；未知提交必须查原记录。记录的句子、时间、方式不可被重试修改。客户端超时不是业务失败，恢复查原夜，只有本次新建且前台有效才播放仪式。
- 新句池必须通过未来生效版本接续，不能修改已冻结记录。事件仅固定枚举 / 布尔属性，禁止原句、自由文本和精确客户端时间；事件失败不能影响业务。
- 私有导出、OPENID 排除名单、维护清单只存仓库外，权限 600；默认维护仅预演。个人删除先核对本人并暂停使用，明确三集合范围，结束回读验证。公共夜句不随个人删除。

## 验证与交付

- Node.js 22、Yarn Classic，`yarn install --frozen-lockfile`。整体交付执行 `yarn verify`；上传前 `yarn build:release`。构建 / 部署共享 CLOUD_ENV_ID，终端优先于 .env.local；离线须显式 ENABLE_CLOUD=false，禁止离线发布。
- 页面必须在微信模拟器实际打开，检查有数据、长句、空列表与保存失败；编译不能替代界面验证。模拟器、受控服务、真实云库、真机联调和实际发布分别报告。
- 后端覆盖同夜并发、跨午夜 / 正午 / 20:00 / 06:00、原夜恢复、事务冲突 / 部分失败、身份隔离、30 条游标分页、事件预算。客户端覆盖超时、晚到、身份切换、设置乱序与生命周期。
- 使用官方开发工具前准备对应云函数依赖；共享模块变化后核对部署包与源码。临时云验收使用限时令牌、独立测试身份和夜句前缀，最后清理并停用验收函数；不得把受控时间当作真实夜间真机证明。
- 文档与代码同步；流程变化更新开发 skill。凭据、本地配置、依赖、产物、部署缓存不入库。尊重共享工作区和用户暂存文件，未要求时不提交 / 推送 / 发布。
