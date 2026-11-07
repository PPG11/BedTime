# 云环境与部署

构建和部署共用 [`scripts/cloud-env.cjs`](../scripts/cloud-env.cjs)。`CLOUD_ENV_ID` 的读取优先级为终端环境变量、仓库根目录 `.env.local`；没有默认环境，也不读取旧的 `TARO_APP_CLOUD_ENV_ID`。首次配置可复制 `.env.example`，已有 `.env.local` 不要覆盖；本地配置不入库。

普通构建缺少环境会失败并保留旧产物。只有显式 `ENABLE_CLOUD=false` 才能离线预览；`yarn build:release`、云函数依赖准备、部署预演和真实部署均要求启用云开发并配置环境。配置语法检查不能证明环境存在或账号有权限。

BedTime 的 AppID 为 `wxd489f0523662b0ea`。本机 `.env.local` 已配置用户提供的新环境 `cloudbase-d0gcfmrvdb974536e`；测试和发布前仍须核对微信开发者工具中的 AppID 关联。

## 验证与上传

```sh
yarn verify
yarn build:release
yarn cloud:preview bedtimeUser bedtimeCheckin bedtimeGoodnight bedtimeFriends
# 当前授权覆盖上传时执行
yarn upload:cloudfunctions bedtimeUser bedtimeCheckin bedtimeGoodnight bedtimeFriends
```

部署预演只核对本地目标和上传范围。通过脚本上传需要已登录的微信开发者工具、开启服务端口及目标环境权限。终端可用 `CLOUD_ENV_ID=your-test-env-id` 临时覆盖本地配置；切换后重新构建前端。[微信开发者工具命令行](https://developers.weixin.qq.com/miniprogram/dev/devtools/cli.html)

使用官方微信开发者工具能力 `wechatide.cloud_fn_deploy` 上传时，先准备本地依赖：

```sh
yarn cloud:prepare bedtimeUser bedtimeCheckin bedtimeGoodnight bedtimeFriends
```

`cloud:prepare` 按指定函数打包当前依赖及 `common`，不上传、不读取或更新部署缓存，也不要求安装或启动微信 CLI。准备成功后再调用官方工具上传这些函数；工具请求已发起或等待确认不代表部署成功，需检查结果与云端实际版本。

四个业务函数均依赖 `cloudfunctions/common/`。脚本上传会自动完成同样的依赖准备；缺少必需依赖时停止该函数上传，先通过 `yarn install --frozen-lockfile` 修复依赖。不要直接上传函数目录中遗留的 `node_modules/`，应先执行 `cloud:prepare` 或使用部署脚本。修改 `common/` 后核对所有受影响函数的上传范围。

查询索引单独维护在 [`cloudfunctions/database-indexes.json`](../cloudfunctions/database-indexes.json)。该文件供审阅和官方 CloudBase 数据库工具应用，普通构建、部署预演和云函数上传均不会变更索引。按[查询索引说明](../cloudfunctions/README.md#查询索引)核对并应用后，读取云端实际索引确认结果；提交配置文件不能视为索引已创建。

集合访问规则维护在 [`cloudfunctions/database-rules.json`](../cloudfunctions/database-rules.json)：五个业务集合禁止客户端直接读写，业务数据只通过云函数访问。按[访问规则说明](../cloudfunctions/README.md#访问规则)在云控制台逐集合设置并回读核验；普通部署不会自动应用这些规则。

## 环境验收

1. 核对 AppID、环境 ID、四个函数的部署状态、运行时与超时。确保旧业务入口停止执行，特别是 `databaseProxy` 与旧定时任务 `gnReactionsConsume`、`slotRollup`。
2. 核对 [集合、查询索引、读写权限与心语审核权限](../cloudfunctions/README.md)。
3. 在获准写入的测试环境使用两个微信测试账号，验证建档、资料保存、跨午夜打卡、请求重试、空池、心语审核与投票、好友接受和解除。区分模拟器验证、真机联调、云函数部署和小程序版本发布。

## 2026-11-07 核验记录

本次通过微信开发者工具读取关联环境，确认 AppID `wxd489f0523662b0ea` 对应 `cloudbase-d0gcfmrvdb974536e`。以下是当日核验结果，后续发布仍需回读实际配置。

| 项目 | 已完成操作与证据 |
| --- | --- |
| 本地验证 | `yarn verify` 通过：类型检查、65 项测试及原生构建；`yarn build:release` 通过。开发监听已恢复，使用相同云环境。 |
| 云函数 | 重新准备四个函数的生产依赖，逐文件核对打包的 `common` 与源码一致；经开发工具确认后更新 `bedtimeUser`、`bedtimeCheckin`、`bedtimeGoodnight`、`bedtimeFriends`，四项部署均返回成功，回读状态均为 `Active`。当前运行时仍为 `Nodejs16.13`，执行超时为 3 秒。 |
| 查询索引 | 添加配置清单中的 6 个索引，回读确认字段顺序、排序方向及 `users.uid` 唯一约束；保留默认索引。 |
| 数据库权限 | 五个业务集合原为“所有用户可读，仅创建者可读写”，已逐个改成“所有用户不可读写”。通过小程序身份查询不存在的文档键，五个集合均返回权限拒绝；未对业务文档执行测试写入。 |
| 业务读取 | 在模拟器真实微信身份下，用户初始化摘要、打卡状态与历史、好友概览、本人心语及回赠查询返回 `OK`；权限收紧后再次核验四个业务函数均返回 `OK`。当时好友、打卡和心语集合为空，结果仅证明这些读取路径和空状态。 |
| 旧入口 | 云端仍保留 17 个旧函数；`databaseProxy` 对无效操作返回 `RETIRED`，`slotRollup` 与 `gnReactionsConsume` 的定时触发器列表均为空。本次未删除旧函数或历史集合。 |

本次未发布小程序版本，未执行真实打卡、投稿、投票或双账号好友写入流程。心语函数包保留 `security.msgSecCheck` 配置，但内容审核的线上权限与完整投稿链路仍需实际联调；控制台最后一次详情读取出现窗口访问错误，不能据此宣称已核验审核权限。真机分享、输入交互及双账号写入验收仍按上方清单执行。
