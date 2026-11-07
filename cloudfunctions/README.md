# 云函数与数据库说明

本目录包含 BedTime 的微信云开发函数与共享模块。小程序通过专用云函数和 `databaseProxy` 访问云数据库。部署入口见[云开发与部署](../docs/cloud-deployment.md)，业务路径及权限边界见[业务链路](../docs/checkin-and-friends-backend.md)。

## 数据库结构

| 集合 | 主键 | 说明 | 主要写入入口 |
| --- | --- | --- | --- |
| `users` | `_id = OPENID` | 用户档案、目标作息与统计字段 | `userEnsure`, `checkinSubmit`, `databaseProxy (users)` |
| `checkins` | `_id = {uid}#{yyyymmdd}`（每日打卡）/ `{uid}`（旧格式） | 每日记录保存状态、时间戳和心语 ID，旧格式汇总文档保存 `info[]` | `checkinSubmit`, `ensureCheckinsDoc`, `databaseProxy (checkins)` |
| `goodnight_messages` | `_id = {uid}_{yyyymmdd}` | 晚安心语正文、打分与随机抽取字段 | `gnSubmit`, `databaseProxy (goodnight_messages)` |
| `gn_reactions_dedupe` | `_id = md5({uid}#{messageId})` | 点赞/点踩去重与增量累积 | `gnReact` 写入，`gnReactionsConsume` 消费并清理 |
| `friend_requests` | `_id` 自动生成 | 好友申请队列 | `friendRequestSend`, `friendRequestUpdate` |
| `friendships` | `_id = {minUid}#{maxUid}` | 好友无向边 | `friendRequestUpdate`, `friendFinish`, `friendRemove` |
| `public_profiles` | `_id = uid` | 用户公开资料快照（昵称、睡眠时段、连续打卡、今日状态） | `databaseProxy (public_profiles)`，前端 `refreshPublicProfile` |
| `slot_daily` | `_id = {slotKey}#{yyyymmdd}` | 按睡眠时间段统计打卡人数与命中率 | `slotRollup` 定时写入 |

### 字段约定

- 日期使用 `yyyymmdd` 字符串。打卡提交读取前端传入的周期日期，部分接口在日期缺省时根据用户 `tzOffset` 计算。
- `uid` 为 8–10 位短码，创建用户时会查重。`slotKey` 量化为 `HH:00` / `HH:30`。
- 打卡状态仅允许 `hit` 或 `late`（前端 `miss/pending` 处理为只读状态）。
- 晚安心语参与随机抽选字段：`status`, `slotKey`, `rand`, `score`。
- 去重表中的 `deltaLikes/deltaDislikes/deltaScore` 会被批量消费，消费成功后删除对应记录。

## 晚安心语（GN）流程速览

1. **投稿（`gnSubmit`）** 按 `uid` 和日期生成文档 ID，记录初始随机值和得分。
2. **抽取（`gnGetRandom` / `checkinSubmit`）** 调用 `common/goodnight.pickRandomMessage`，根据 `slotKey`、`score` 与避让规则抽取，结果可以为空。
3. **打卡奖励（`checkinSubmit`）** 创建打卡记录时写入 `gnMsgId`。心语投稿和打卡奖励目前由各自的操作触发。
4. **互动（`gnReact`）** 将点赞或点踩写入 `gn_reactions_dedupe`，记录待消费的增量。
5. **增量消费（`gnReactionsConsume`）** 定时把增量合并到 `goodnight_messages`，成功后清理对应的去重记录。

## 云函数清单

以下每个小节列出函数的职责、参数、返回值、关联集合以及前端调用入口，便于排查。

### login
- **作用**：从云函数上下文获取 `OPENID` 并返回。
- **主要入参**：无。
- **返回**：`{ code: 'OK', openid }`。
- **数据库**：无。
- **前端调用**：`src/services/cloud.ts#getCurrentOpenId`。

### userEnsure
- **作用**：确保 `users` 集合存在当前用户，必要时创建默认档案。
- **主要入参**：可选的 `nickname`、`targetHM`、`tzOffset` 覆写。
- **返回**：用户投影（`uid`, `nickname`, `slotKey`, `todayStatus` 等）。
- **数据库**：读取/写入 `users`。
- **前端调用**：`src/services/user.ts#ensureCurrentUser`。

### checkinStatus
- **作用**：读取某日打卡状态与关联的 `gnMsgId`。
- **主要入参**：可选 `date`（`yyyymmdd`）。
- **返回**：`{ checkedIn, date, status, gnMsgId, timestamp }`。
- **数据库**：`users`（校验）与 `checkins`。
- **前端调用**：`src/services/checkin.ts#fetchTodayCheckinStatus`。

### checkinRange
- **作用**：按 `_id = {uid}#{date}` 范围分页读取打卡记录。
- **主要入参**：`from`、`to`、`limit`、`cursor`。
- **返回**：`{ list, nextCursor }`。
- **数据库**：`checkins`。
- **前端调用**：`src/services/checkin.ts#fetchCheckinPageViaCloud`、`#fetchCheckinViaCloudFunction`。

### checkinSubmit
- **作用**：按 `{uid}#{date}` 检查已有记录，写入打卡记录后更新用户统计。
- **主要入参**：`status ('hit'|'late')`、`date`、可选 `gnMsgId`。
- **返回**：成功时 `{ code: 'OK', date, status, gnMsgId, streak, totalDays, todayStatus, slotKey }`；重复时 `code: 'ALREADY_EXISTS'` 与现有记录。
- **数据库**：`checkins`, `users`, `goodnight_messages`（抽奖）。
- **前端调用**：`src/services/checkin.ts#submitCheckinRecord`。

### ensureCheckinsDoc
- **作用**：确保 `checkins` 集合中存在 `_id = uid` 的汇总文档，并迁移老结构。
- **主要入参**：同用户 `uid`（可选，默认当前）。
- **返回**：`{ ok: true, data: { documentId, uid, ownerOpenid, info[], createdAt, updatedAt } }`。
- **数据库**：`checkins`, `users`。
- **前端调用**：`src/services/checkin.ts#ensureCheckinsDocument`（云函数缺失时通过 `databaseProxy` 处理旧格式）。

### databaseProxy
- **作用**：代理部分集合的读写操作，反序列化命令描述符并根据集合和操作检查权限。
- **主要入参**：`collection`、`action`、`id/query`、`data`。
- **返回**：包裹在 `{ ok, result | error }` 中。
- **数据库**：代理 `users`、`checkins`、`public_profiles`、`goodnight_messages`。
- **前端调用**：`src/services/cloud.ts#createDatabaseProxy`（间接被所有服务模块使用）。

### friendRequestSend
- **作用**：发起好友申请并做幂等校验。
- **主要入参**：`toUid`。
- **返回**：`{ code: 'OK', requestId }`。
- **数据库**：`friend_requests`，读取 `users` 校验 UID。
- **前端调用**：`src/services/friends.ts#sendFriendRequest`。

### friendRequestUpdate
- **作用**：好友申请接收方处理申请，接受时写入 `friendships`。
- **主要入参**：`requestId`、`decision ('accepted'|'rejected')`。
- **返回**：`{ code: 'OK', status }`。
- **数据库**：事务内操作 `friend_requests` 与 `friendships`。
- **前端调用**：`src/services/friends.ts#respondFriendRequest`。

### friendFinish
- **作用**：申请发起方确认结果，补写缺失的好友边。
- **主要入参**：`requestId`。
- **返回**：`{ code: 'OK', added: boolean }`。
- **数据库**：`friend_requests`, `friendships`。
- **前端调用**：`src/services/friends.ts#confirmFriendRequest`。

### friendRemove
- **作用**：按主键移除好友关系（幂等，不存在时忽略）。
- **主要入参**：`targetUid`。
- **返回**：`{ code: 'OK', removed: true }`。
- **数据库**：`friendships`。
- **前端调用**：`src/services/friends.ts#removeFriend`。

### friendsPage
- **作用**：整合好友列表、待处理申请与分页游标。
- **主要入参**：`limit`（默认 20）、可选 `cursor`（ISO 字符串）。
- **返回**：`{ list, nextCursor, requests: { incoming, outgoing } }`。
- **数据库**：`friendships`, `friend_requests`, `users`（批量读取好友档案）。
- **前端调用**：`src/services/friends.ts#fetchFriendsOverview`。

### gnSubmit
- **作用**：提交指定日期的晚安心语，按 `(uid, date)` 检查重复投稿。
- **主要入参**：`text`，以及可选的 `date`。
- **返回**：`{ code: 'OK', messageId }` 或 `{ code: 'ALREADY_EXISTS', messageId }`。
- **数据库**：`goodnight_messages`。
- **前端调用**：`src/services/goodnight.ts#submitGoodnightMessage`。

### gnGetRandom
- **作用**：默认按用户 `slotKey` 筛选晚安心语并避开本人投稿。该时段无合格消息时可返回空。
- **主要入参**：`preferSlot`（默认 `true`）、`avoidSelf`（默认 `true`）、`minScore`。
- **返回**：`{ code: 'OK', messageId, text, score }`。
- **数据库**：`goodnight_messages`。
- **前端调用**：`src/services/goodnight.ts#fetchRandomGoodnightMessage`，`src/pages/home/index.tsx` 打卡前奖励。

### gnReact
- **作用**：记录点赞/点踩请求，合并增量到去重表。
- **主要入参**：`messageId`、`value`（`1` 点赞 / `-1` 点踩）。
- **返回**：`{ code: 'OK', queued, firstVote | updated | dedup }`。
- **数据库**：`gn_reactions_dedupe`。
- **前端调用**：`src/services/goodnight.ts#voteGoodnightMessage`。

### gnReactionsConsume
- **作用**：定时任务，批量读取去重表并把累积增量写回 `goodnight_messages`。
- **主要入参**：无。
- **返回**：`{ code: 'OK', consumed, grouped }`。
- **数据库**：`gn_reactions_dedupe`, `goodnight_messages`。
- **触发**：见下方仓库定时配置。

### slotRollup
- **作用**：统计指定日期各 `slotKey` 的参与人数与命中率。
- **主要入参**：可选 `date`（默认统计前一日）。
- **返回**：`{ code: 'OK', date, slots }`。
- **数据库**：`checkins`, `users`, `slot_daily`。
- **触发**：见下方仓库定时配置。

## 仓库定时配置

| 函数 | 类型 | Cron | 说明 |
| --- | --- | --- | --- |
| `gnReactionsConsume` | 定时触发 | `0 0 3 * * * *` | 每天 03:00 消费投票增量 |
| `slotRollup` | 定时触发 | `0 0 3 * * * *` | 每天 03:00 汇总睡眠时段 |

实际触发器的安装状态和时区以云开发控制台为准。

## 共享模块

- `common/cloud.js`：封装 `cloud.init`、获取 `OPENID`、`db` 实例。
- `common/users.js`：用户创建、UID 生成与 streak 计算。
- `common/checkins.js`：打卡文档 ID 规范化、创建与日期工具。
- `common/goodnight.js`：随机抽样与 ID 校验，被 `gnGetRandom` / `checkinSubmit` 共用。
- `common/friends.js`：好友边主键与防重校验。
- `common/response.js` / `common/errors.js`：统一成功/错误响应格式。
- `common/time.js`：睡眠时间量化、日期转换工具。

以上信息覆盖了每个云函数的职责、调用链与数据库交互，便于在前端与云端之间进行排错或扩展。
