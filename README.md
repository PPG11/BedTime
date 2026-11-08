# BedTime · 今晚关灯

微信原生 **TypeScript + WXML + WXSS + CloudBase** 小程序。给舍不得结束今天的人，一个轻轻关灯的动作。

M1 已实现真实单夜记录、重试恢复、私人夜签归档、详情与本地图片导出、声音 / 震动 / 动效设置、隐私与数据删除联系入口。业务云函数 `bedtimeNight` 已部署，四个新集合禁止客户端直读直写。当前交付证据与真机、发布边界见 [M1 交付记录](docs/refactor-m1-delivery.md)。

M1 后续增量为[一次性关灯提醒](docs/reminder-development.md)：主动选时并订阅、查询与取消，定时发送独立于关灯业务。预约保存在本人用户资料中；已启用，作者确认开发版真机收信、点击进入小程序和「放下手机」退出通过，完整验收边界见增量交付记录。

每晚 **20:00—次日 06:00（北京时间）** 开放，一晚一条记录。长按 800ms，标准留白 800ms；常规字号、系统无衬线、正常动效，声音默认关闭。演示始终标注、不留记录、不上报事件、不震动。首页一屏显示，以主流 iPhone / Android 竖屏为重点。

旧打卡、目标时间、好友、心语及其前端代码已移除；四个旧云入口仅返回停用提示。没有兼容层、数据迁移或新旧双写。旧云集合保留，不作为新产品的数据源。正式公开发布由作者操作。

## 开始开发

使用 Node.js 22、Yarn Classic 1.22.22：

```sh
yarn install --frozen-lockfile
# 仅首次创建；不要覆盖已有配置
cp -n .env.example .env.local
# 填入已关联的 CLOUD_ENV_ID 后
yarn verify
yarn dev:weapp
```

微信开发者工具导入仓库根目录，读取生成的 `dist/` 与 `cloudfunctions/`。修改 `miniprogram/` 源码，不直接修改产物。前端没有运行时 npm 依赖。终端的 `CLOUD_ENV_ID` 优先于 `.env.local`；离线预览须显式 `ENABLE_CLOUD=false`，发布构建禁止离线。在线 `getState` 会幂等创建用户档案。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `yarn verify` | 类型检查、自动化测试、原生构建 |
| `yarn build:release` | 构建启用云开发的上传产物，不会自行上传 |
| `yarn dev:weapp` | 监听源码和本地环境配置 |
| `yarn cloud:preview bedtimeNight` | 只预演上传范围 |
| `yarn cloud:prepare bedtimeNight` | 准备云函数依赖，不上传 |
| `yarn upload:cloudfunctions bedtimeNight` | 向明确配置的环境部署 |
| `yarn night:export / night:report / night:maintenance` | 私有导出、只读汇总、预演后维护；参数见维护指南 |

## 代码与文档

- 页面：`miniprogram/pages/{night,me,archive,receipt,about,reminder}/`。
- 交互与状态：`pages/night/night-controller.ts`、`state/create-night-store.ts`、`state/night-events.ts`。
- 云契约：`services/night.ts` → `bedtimeNight` → `common/nights.js`；时间、句子、事件和冲突重试各有独立模块。
- [产品规格](docs/product-plan-tonight-lights-out-v1.1.md) · [架构](docs/architecture.md) · [开发](docs/local-development.md) · [云部署](docs/cloud-deployment.md) · [接口](cloudfunctions/README.md)
- [交付与验收](docs/refactor-m1-delivery.md) · [数据维护](docs/night-operations.md) · [句子与素材审阅](docs/night-content-review.md) · [仓库指南](AGENTS.md)
- [M0 体验记录](docs/refactor-m0-review.md)与 [M1 第一段记录](docs/refactor-m1-core.md)保留历史证据。

## 许可

本项目仅供学习与内部交流使用，如需商用请联系项目所有者。
