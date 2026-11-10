# 云环境与部署

当前产品为「Dr. July 的早睡计划」，包括今晚关灯 M1、一次性订阅提醒及 2026-11-10 授权的四项 M2。作者已授权本地 / 云端部署及必要联调，后续同范围 MCP 操作无需逐项再问；正式公开发布仍由作者执行。各阶段的已验证部署与待验收项分开记录。

2026-11-08 后续增加一次性订阅提醒。新增索引、发送函数、模板字段和定时触发器的配置与实际结果见[提醒开发与交付](reminder-development.md)。M1 原本不需要定时任务；本次独立增量只发送用户主动预约的提醒，不承担统计。上传代码不能替代上传并核验触发器。

## M1 与提醒的已验证部署

- AppID：`wxd489f0523662b0ea`；云环境：`cloudbase-d0gcfmrvdb974536e`。
- `bedtimeNight` 已部署，九个动作（M1 六项及提醒三项）；Nodejs16.13、15 秒超时。客户端 8 秒进入未知态，不会取消云端事务。
- `bedtimeReminderDispatch` 已部署，15 秒超时，nightReminderMinute 每分钟触发已实际验证；订阅提醒启用，临时测试许可已撤销，普通消息入口为 formal。作者确认开发版真机收信、进入小程序及退出成功；正式版消息入口待发布后验证。
- M1 原四集合 n_users / n_nights / n_phrases / n_events 已创建。用户在控制台设置仅管理端可读写后，真实小程序身份对四集合分别直读、直写均被拒绝（8 项，-502003）；探针没有写入成功。M2 新四集合的部署与权限验证不能沿用这八项旧证据。
- 四个自定义索引已创建并回读：n_nights.uid ASC + nightId DESC、n_nights.nightId ASC、n_events.receivedDateKey ASC，以及 n_users.reminder.status ASC + reminder.dueAt ASC。
- 四个旧领域函数已部署无依赖停用包。旧集合保留，未迁移或删除。临时 bedtimeNightAcceptance 的隔离数据已清空，函数已替换为停用包。
- SDK 会附加 userInfo 和 tcbContext；请求校验接受这些传输字段，但身份仍只取 SDK 微信上下文。严格拒绝客户端 uid 等额外业务字段，解决了先前首页反复确认的问题。
- 实际数据库冲突可能被包装为 -501001 / ResourceUnavailable.TransactionConflict。已增加明确冲突的有限退避重试，并通过真实双提交、偏好合并、归档与事件并发复测。

实际云测试使用单独测试身份与 1980 年受控日期，夜句加测试前缀，未修改正式函数时钟。34 条测试夜签、4 条测试事件、1 个测试用户和 34 份测试夜句已删除并回读为空。这证明云事务与查询行为，不能替代两个真实微信账号或夜间真机主流程。详见 [交付记录](refactor-m1-delivery.md)。

## M2 部署目标与验证状态

新增 `bedtimeGrowth`，提供公共灯迹、公开卡、渠道和看板十个动作；不部署统计触发器，不改变 reminder 定时发送。新增 `n_cards / n_card_keys / n_attributions / n_channels`，当前目标共八集合全部禁止客户端直读直写。新增索引为 n_nights 的 `nightId ASC + _id ASC` 扫描索引，以及 n_cards、n_card_keys 的 uid 索引；其余索引保留。

**2026-11-10 M2 已部署并完成真实云验收。** bedtimeGrowth 回读 Active、Nodejs16.13、15 秒；四个新集合和三个新索引已回读，新集合八项小程序直接读写均返回 -502003。真实管理员与灯迹/渠道/看板接口返回 OK；14 项隔离云验收通过，测试数据已精确清理并回读为空，临时 bedtimeGrowthAcceptance 已换为最小停用包且实际调用返回 RETIRED。细项与证据边界统一见 [M2 交付记录](m2-development.md#本轮交付记录)，不把 M1 历史回读扩写为本轮复测。

## M2 管理员配置与部署

管理员只能来自项目负责人确认的真实微信账号。使用该账号真实 `getState` 返回的身份，在仓库外计算 SHA-256；不得接受页面传入的 uid、昵称或自报账号来授予权限。管理员自动从看板剔除，其他测试账号由单独排除名单补入。

云函数环境变量 `NIGHT_ADMIN_OPENID_HASHES`、`NIGHT_ANALYTICS_EXCLUDE_HASHES` 的值是 JSON 哈希数组。若当前官方部署工具没有环境变量设置入口，可使用部署专用 `cloudfunctions/bedtimeGrowth/private-config.json`；原件放在仓库外，文件结构如下，空数组表示没有相应账号：

```json
{
  "adminHashes": [],
  "excludeHashes": []
}
```

数组元素必须是经核验账号 OPENID 的 64 位小写 SHA-256 字符串。环境变量存在时逐字段覆盖文件，即使变量值为 `[]`；不把空数组当作“请继续读取旧文件”。没有管理员配置则所有管理请求拒绝。坏管理员数组拒绝全部管理权限；坏排除数组拒绝输出统计。私有 JSON 无法解析或非缺失的文件读取错误会停止该函数入口，先修正配置再上传，不能降级到默认开放。

部署顺序：

1. 核对当前账号授权与排除名单，仓库外配置原件设为权限 600。不要打印账号、哈希清单或文件全文。
2. 运行 `yarn cloud:preview bedtimeGrowth`、`yarn cloud:prepare bedtimeGrowth`，确认当前依赖已准备，包内 common 与源码一致。
3. 准备后把原件复制到 `cloudfunctions/bedtimeGrowth/private-config.json` 并设权限 600。该路径由 `.gitignore` 持续忽略；用 `git check-ignore cloudfunctions/bedtimeGrowth/private-config.json` 核对，不强制添加到 Git。上传副本可以保留供本机后续部署，但仓库外原件是恢复来源，换机器不能假定它会随代码出现。准备依赖只处理依赖目录，不生成、刷新或授予管理员权限。
4. 创建新增集合，单独应用八集合规则和新增索引并回读；随后只部署 `bedtimeGrowth`，设置并回读 15 秒超时。开发者工具选择已准备本地依赖的上传方式，不能丢弃 file:../common 依赖。部署副本必须位于本次实际上传的函数目录；仅更新 Git 或另一个准备目录不改变云端配置。
5. 真实管理员调用 getGrowthAccess 应为 true，独立普通身份应为 false，且直接调用 getChannels/getDashboard/saveChannel 被拒绝。核对没有客户端指定身份可绕过；八集合客户端直接读写均拒绝。配置、索引、权限、函数 Active 与真实接口结果分别记录。
6. 用限时独立 namespace 的 `tests/cloud/growth-acceptance.cjs` 检查云事务、公开投影、阈值、归因和成熟分母；按清单清理测试数据并回读，随后将临时验收函数替换成 RETIRED。受控 1980 年数据和测试身份不代表真实微信好友分享或实际留存。

修改管理员或排除名单需要重新部署含最新配置的 `bedtimeGrowth`（若使用云环境变量则由平台更新相应配置），不更新客户端权限字段。不再授权的账号从白名单删除后核验管理接口拒绝。旧云部署不会替新上传包保留本地缺失的私有文件；不能在缺文件时静默声称管理员已配置。

隔离验收可使用 `scripts/night-growth-cloud-qa.mjs`：先运行 `node scripts/night-growth-cloud-qa.mjs --prepare --appid wxd489f0523662b0ea --env cloudbase-d0gcfmrvdb974536e`，只在仓库外生成验收包、停用包和权限 600 的 session 文件，不部署。审阅并上传输出的验收包后，依次用 `--session <该私有session绝对路径> --action run`、`--action cleanup`、`--action retire` 执行。会话绑定明确环境；run 失败仍须 cleanup，cleanup 回读为空后才能 retire。停用返回 pending 时继续查询原会话任务，不重新部署；最后必须实际调用得到 RETIRED。令牌和原始结果留在私有目录，勿复制进交付文档。

## 日常构建与部署

```sh
yarn install --frozen-lockfile
yarn verify
yarn build:release
yarn cloud:preview bedtimeNight
yarn cloud:prepare bedtimeNight
# 按已授权范围上传；普通构建不会上传
yarn upload:cloudfunctions bedtimeNight
```

构建与部署共用 scripts/cloud-env.cjs：终端 CLOUD_ENV_ID 优先于 .env.local；没有默认环境，显式离线构建不能上传。准备依赖会复制 common 与生产依赖，不读取或更新部署缓存、不上传。使用开发工具独立上传前必须先准备当前依赖；不要上传遗留包。共享模块变化后核对打包源码，函数更新成功后再发前端。

规则和索引文件只是目标配置，普通函数部署不会应用。新环境先创建集合、应用 [规则](../cloudfunctions/night-database-rules.json)与 [索引](../cloudfunctions/night-database-indexes.json)，然后部署并实际验证权限。不得恢复旧通用数据库代理。

## 发布与回退

首发图片使用无码模板，正式发布后再取固定 scene=0 的通用 release 码并按规格补入后续版本；不生成个人码。M2 的随机公开卡链接不替代该通用图片码。公开发布前在微信公众平台完成对应隐私保护指引（保存用户主动选择的图片到相册、记录 / 偏好 / 最少事件、主动公开分享与来源统计用途）及用户隐私接口声明，并在 iOS / Android 真机验证同意、拒绝、取消和再次保存。

代码、云函数部署、预览 / 体验版上传、公开发布分别记录。正式发布由作者操作；不能把开发工具中的成功当作已公开可访问。发布与真机待验项见 [交付记录](refactor-m1-delivery.md)。

回退以代码版本和对应函数包为单位，不回写已冻结的私人历史。M2 回退前端不能恢复已撤销/到期公开卡或删除新数据；管理员白名单缺失按拒绝处理，不能为恢复页面而临时开放所有人。停用旧入口后不重新开启旧代理；旧数据和资源的永久删除另列明确清单，不作为本轮重构的隐含操作。当前本人删除须重新导出、预演 version 2 六集合清单，旧三集合清单不可直接扩大；维护操作见 [数据维护](night-operations.md)。

## 历史资源证据的边界

2026-11-08 初次清点有 21 个旧函数、8 个旧集合；当时函数详情工具没有返回触发器清单。2026-11-07 曾实际看到 slotRollup / gnReactionsConsume 的触发器为空，本轮不把历史结果写成新回读。关键旧入口的当前停用调用结果以交付记录为准。

以下保留旧产品当日记录，不代表当前接口或待办。

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
