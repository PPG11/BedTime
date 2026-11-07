# BedTime 云函数契约

小程序只调用以下四个云函数。请求包含 `action` 和该操作的业务参数。服务端从微信上下文获取身份，成功返回 `{ code: 'OK', data }`，业务失败返回 `{ code, message }`。数据库文档、集合名和操作符由服务端决定。

| 云函数 | 操作 | 输入与结果 |
| --- | --- | --- |
| `bedtimeUser` | `bootstrap` | 首次按 `tzOffset` 建档，已有档案不重建。返回个人资料和按当前周期计算的打卡摘要 |
|  | `updateProfile` | 只更新 `nickname` 和 `targetHM`，返回最新资料 |
| `bedtimeCheckin` | `status` | 返回服务端当前周期日期及对应记录，未打卡时记录为 null |
|  | `history` | 按周期日期倒序分页，接收可选 `cursor` 和 `limit` |
|  | `submit` | 接收页面显示的 `date` 供周期校验。返回 `{ record, created }` |
| `bedtimeGoodnight` | `ownSubmission` | 接收 `date`，返回本人投稿或 null |
|  | `submit` | 接收 `date` 和 1 至 80 字的 `text`，审核通过后保存。重复提交返回原稿 |
|  | `reward` | 接收 `date`，返回本人打卡关联的奖励或 null |
|  | `vote` | 接收 `date` 和 `value`（1 或 -1），仅评价该晚领取的心语。重复调用返回已有结果 |
| `bedtimeFriends` | `overview` | 接收可选 `cursor` 和 `limit`，返回好友分页与待处理申请 |
|  | `send` | 接收 `toUid`，同一关系同时只有一条待处理申请 |
|  | `respond` | 接收 `requestId` 和 `decision`，只有接收方可接受或拒绝 |
|  | `remove` | 接收 `targetUid` 和 `relationshipId`，解除对应关系 |

## 集合

| 集合 | 主键与用途 |
| --- | --- |
| `users` | 微信身份，保存公开好友码、个人设置和打卡摘要 |
| `checkins` | `{uid}#{yyyymmdd}`，记录该周期状态、发生时间、当时的时段及奖励 ID |
| `goodnight_messages` | `{uid}_{yyyymmdd}`，保存审核通过的投稿与评分 |
| `gn_reactions_dedupe` | 用户与消息的哈希，每条投票永久保留 |
| `friendships` | 两个好友码排序后以 `#` 拼接，单条文档保存申请与关系状态 |

心语审核需要 `security.msgSecCheck` 权限，见 [函数配置](bedtimeGoodnight/config.json)。提交与写入规则见 [业务链路](../docs/checkin-and-friends-backend.md)。

## 访问规则

[`database-rules.json`](database-rules.json) 以集合名映射目标规则：五个业务集合均为 `read: false`、`write: false`，小程序客户端不可直接读写，业务访问统一经过云函数及其身份、数据归属校验。此文件供审阅与逐集合配置，普通云函数部署不会自动应用；在云控制台设置后回读实际权限，不能只凭本地文件认定规则已生效。

## 查询索引

[`database-indexes.json`](database-indexes.json) 按当前查询定义 6 个索引。它是版本控制中的目标配置，云端实际状态以回读为准；普通云函数部署不会自动应用它。

| 集合 | 索引字段顺序 | 对应查询 |
| --- | --- | --- |
| `users` | `uid` 升序，唯一 | 好友码查找与批量资料查询 |
| `friendships` | `aUid`、`status`、`_id` 升序；`bUid`、`status`、`_id` 升序 | 好友关系查询的两个成员分支，按 `_id` 分页 |
| `friendships` | `toUid`、`status` 升序，`createdAt` 降序；`fromUid`、`status` 升序，`createdAt` 降序 | 收到和发出的待处理申请 |
| `goodnight_messages` | `status`、`slotKey`、`rand` 升序 | 按审核状态与时段筛选、随机值范围抽样；仍需过滤本人和低分消息 |

应用前核对目标环境、现有索引和 `users.uid` 唯一性。文件中 `collections` 的每个对象是官方 `writeNoSqlDatabaseStructure` 的 `action: updateCollection` 参数，包含 `updateOptions.CreateIndexes`；使用 [CloudBase 官方工具](https://docs.cloudbase.net/ai/cloudbase-ai-toolkit/mcp-tools) 逐集合应用，再以 `readNoSqlDatabaseStructure` 的 `listIndexes` 核验结果。不要重建已有等价索引或删除默认索引。部署步骤见[云环境与部署](../docs/cloud-deployment.md)。
