# 云函数与数据库重构说明

本目录包含微信小程序·云开发（TCB）环境的云函数实现。新版后端按照以下目标设计：

- **统一入口**：客户端所有读写均调用云函数，杜绝直接访问数据库。
- **高可维护性**：数据结构清晰，核心业务流程具备幂等保障。
- **性能与安全**：针对高频查询建立主键或二级索引，所有写入路径均校验 `OPENID`。

## 数据库结构

| 集合 | 主键 | 说明 |
| --- | --- | --- |
| `users` | `_id = openid` | 用户档案与统计摘要 |
| `checkins` | `_id = {uid}#{yyyymmdd}` | 每日打卡记录（每日一条） |
| `goodnight_messages` | `_id` | 晚安心语，含随机抽取所需字段 |
| `gn_reactions_dedupe` | `_id = {userId}#{messageId}` | 投票去重表 |
| `gn_reaction_events` | `_id` | 点赞异步增量队列 |
| `friend_requests` | `_id` | 好友申请记录 |
| `friendships` | `_id = {minUid}#{maxUid}` | 好友无向边 |
| `slot_daily` | `_id = {slotKey}#{yyyymmdd}` | 打卡时段聚合指标 |

### 关键字段约定

- 日期统一使用 `yyyymmdd` 字符串，按用户时区 `tzOffset` 计算。
- `uid` 为 8–10 位短码，在 `users` 集合内唯一。
- `slotKey` 为 `HH:00` 或 `HH:30`，由目标睡觉时间量化而来。
- `checkins.status` 仅允许 `hit` 或 `pending`。
- 晚安心语随机抽取使用字段：`status`, `slotKey`, `rand`, `score`。

### 建议索引

| 集合 | 索引 |
| --- | --- |
| `users` | `uid` 唯一索引 |
| `goodnight_messages` | `(userId ASC, date ASC)` 唯一；`(status ASC, slotKey ASC, rand ASC)`；`score` 单列 |
| `gn_reaction_events` | `(status ASC, createdAt ASC)` |
| `friend_requests` | `(toUid ASC, fromUid ASC)` |
| `slot_daily` | `(slotKey ASC, date ASC)` |
| `checkins` | 仅使用主键 `_id` 进行范围查询 |

## 云函数一览

| 名称 | 描述 |
| --- | --- |
| `authCode2Session` | 交换 `js_code` 获取 `openid` |
| `userEnsure` | 确保用户档案存在并返回摘要 |
| `checkinSubmit` | 提交当日打卡，幂等返回已有记录 |
| `checkinRange` | 按 `_id` 范围分页读取打卡历史 |
| `friendRequestSend` | 发送好友申请（去重校验） |
| `friendRequestUpdate` | 接收方处理申请，接受时写入好友边 |
| `friendFinish` | 发送方确认结果，幂等补写好友边 |
| `friendRemove` | 按边主键删除好友，幂等 |
| `friendsPage` | 分页返回好友列表与基础状态 |
| `gnSubmit` | 提交当日晚安心语，唯一约束 `(userId,date)` |
| `gnGetRandom` | 按两段式随机算法抽取晚安心语 |
| `gnReact` | 点赞/点踩写入去重表并入队增量事件 |
| `gnReactionsConsume` | 定时消费增量队列并合并写回 |
| `slotRollup` | 统计昨日各 `slotKey` 的参与与命中率 |

## 触发器建议

| 函数 | 类型 | 示例 Cron |
| --- | --- | --- |
| `gnReactionsConsume` | 定时触发 | `*/30 * * * * *`（每 30 秒） |
| `slotRollup` | 定时触发 | `0 1 * * *`（每天 01:00） |

## 部署提示

1. 确认已在项目入口初始化云开发：`Taro.cloud.init({ env })`，云函数内使用 `cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })`。
2. 按上表创建集合并配置权限：除 `slot_daily` 外全部仅云函数可读写。
3. 为 `users.uid` 等字段创建索引以保证高并发读写性能。
4. 在微信开发者工具中依次右键上传各函数，选择「云端安装依赖」。
5. 若从旧结构迁移，请补齐 `uid`、合并旧打卡记录，并补全 `goodnight_messages` 缺失字段。

## 返回值约定

- 成功：`{ code: 'OK', ...payload }`
- 常见错误码：`INVALID_ARG`、`UNAUTHORIZED`、`NOT_FOUND`、`ALREADY_EXISTS`、`RATE_LIMITED`、`INTERNAL`
- 幂等情况例如重复打卡、重复投稿时，返回 `code: 'ALREADY_EXISTS'` 并附带已有记录或 `messageId`。

更多细节可参考各函数源码及 `common/` 目录中的共享工具模块。
