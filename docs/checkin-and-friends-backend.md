# 打卡与好友功能后端交互说明

本文档梳理了小程序内「每日打卡」与「添加好友」功能与云开发数据库之间的主要交互逻辑，便于后续对业务流程进行调整与扩展。

## 数据集合概览

| 集合 | 作用 | 关键字段 |
| ---- | ---- | -------- |
| `users` | 保存用户主档信息与打卡摘要 | `uid`、`nickname`、`tzOffset`、`targetHM`、`slotKey`、`todayStatus`、`streak`、`totalDays`、`lastCheckinDate`、`createdAt` |
| `checkins` | 以用户维度聚合打卡状态 | `_id`（用户 UID）、`uid`、`ownerOpenid`、`info[]`（`date`、`status`、`message`、`tzOffset`、`ts`）、`createdAt`、`updatedAt` |
| `public_profiles` | 好友列表展示所需的公开资料与状态 | `_id`、`uid`、`nickname`、`sleeptime`、`streak`、`todayStatus`、`updatedAt` |
| `friend_requests` | 好友申请记录 | `_id`、`fromUid`、`toUid`、`status`、`createdAt` |
| `friendships` | 好友无向边 | `_id = {minUid}#{maxUid}`、`aUid`、`bUid`、`createdAt` |

所有集合名称由 `COLLECTIONS` 常量统一维护，便于后续修改。【F:src/config/cloud.ts†L15-L20】

## 打卡业务流程

### 数据模型

打卡服务以 `CheckinDocument` 描述单日打卡记录，但云端存储按用户聚合：`checkins` 集合以用户 UID 作为 `_id`，并在 `info` 数组内保存每日的 `date`、`status`、`message` 与时间戳等信息。【F:src/services/checkin.ts】

### 写入流程（`upsertCheckin`）

1. 确保当前用户在 `checkins` 集合中存在以 UID 为 `_id` 的文档，如缺失则初始化空的 `info` 数组。
2. 检查 `info` 中是否已有目标日期，若存在则直接返回该日的打卡记录。
3. 若当日尚未打卡，则把新条目（`date`、`status`、`message`、`tzOffset`、`ts`）追加到 `info`，并返回归一化后的 `CheckinDocument`。【F:src/services/checkin.ts】

### 晚安心语同步

`updateCheckinGoodnightMessage` 会在用户聚合文档的 `info` 数组中定位目标日期，更新对应条目的 `message` / `goodnightMessageId` 字段，保持两者同步。【F:src/services/checkin.ts】

### 查询能力

- `fetchCheckins`：确保用户聚合文档存在后，读取 `info` 数组并按日期降序映射为 `CheckinDocument` 列表，默认最多返回 1000 条。【F:src/services/checkin.ts】
- `fetchCheckinInfoForDate`：优先通过云函数查询指定日期的打卡记录，若云函数不可用则在本地聚合文档中检索该日期。【F:src/services/checkin.ts】
- `fetchCheckinsInRange`：在聚合文档的 `info` 中筛出日期位于区间内的条目并排序返回。【F:src/services/checkin.ts】
- `computeHitStreak`：基于日期键回溯连续打卡天数，供前端展示 streak 信息。【F:src/services/checkin.ts】

## 好友体系流程

### 用户主档

`userEnsure` 云函数确保 `users` 集合存在主档，并返回包含 UID、昵称、目标睡眠时间、 streak 等字段的摘要数据。前端通过 `ensureCurrentUser` 调用云函数并映射为 `UserDocument`，无须再直接读写数据库。【F:cloudfunctions/userEnsure/index.js†L1-L15】【F:src/services/user.ts†L101-L158】

昵称或目标睡眠时间更新时，`updateCurrentUser` 直接更新 `users` 文档并在成功后调用 `syncPublicProfileBasics` 将核心展示字段写入 `public_profiles`，保证好友页读取到最新资料。【F:src/services/user.ts†L200-L278】

### 好友申请发送（`sendFriendRequest`）

1. `friendRequestSend` 云函数校验目标 UID 与去重条件，确认双方未建立好友关系后写入 `friend_requests`，状态为 `pending`。【F:cloudfunctions/friendRequestSend/index.js†L7-L53】
2. 前端封装为 `sendFriendRequest`，只需传入目标 UID，成功后云函数返回申请 ID。【F:src/services/friends.ts†L204-L236】

### 接收方处理申请（`respondFriendRequest`）

1. `friendRequestUpdate` 在事务中读取申请文档，确认接收方 UID 后根据 `decision` 写入 `status`。【F:cloudfunctions/friendRequestUpdate/index.js†L17-L69】
2. 接受时同步在 `friendships` 集合中创建无向边（若已存在则跳过），返回最新状态。前端通过 `respondFriendRequest` 调用云函数并据返回值反馈用户。【F:src/services/friends.ts†L238-L278】

### 发送方确认结果（`confirmFriendRequest`）

接收方接受申请后，发送方调用 `friendFinish` 进行幂等补写，确保好友边已存在。前端会在拉取好友数据时检测到 `accepted` 的外发申请，逐一调用 `confirmFriendRequest` 并刷新展示。【F:cloudfunctions/friendFinish/index.js†L7-L53】【F:src/services/friends.ts†L280-L320】【F:src/pages/friends/index.tsx†L139-L207】

### 好友关系解除（`removeFriend`）

`friendRemove` 云函数根据双方 UID 构造边主键并删除 `friendships` 文档。前端封装为 `removeFriend`，完成后再次拉取好友数据刷新界面。【F:cloudfunctions/friendRemove/index.js†L7-L38】【F:src/services/friends.ts†L322-L351】

### 好友列表与申请分页（`friendsPage`）

`friendsPage` 云函数基于 `friendships` 集合查询当前用户的好友边，同时拉取 `friend_requests` 中的待处理申请（收 / 发）。返回结构包含：

- `list`：好友 UID 与展示所需的昵称、 streak、目标睡眠时间等；
- `requests.incoming`：按创建时间倒序的待处理申请；
- `requests.outgoing`：当前用户发出的申请及其状态；
- `nextCursor`：用于分页的时间戳游标。

云函数内部会一次性加载相关 UID 的用户资料，避免前端多次 round-trip。【F:cloudfunctions/friendsPage/index.js†L14-L162】

前端通过 `fetchFriendsOverview` 获取该结构，结合本地备注生成好友列表与申请列表，并在需要时触发 `confirmFriendRequest` 更新状态。【F:src/services/friends.ts†L100-L202】【F:src/pages/friends/index.tsx†L209-L356】

## 前端触发点概览

- 首页打卡按钮调用 `upsertCheckin`，成功后立即刷新公开资料并在本地缓存打卡时间戳。【F:src/pages/home/index.tsx†L233-L330】
- 好友页加载时通过 `ensureCurrentUser` 与 `fetchFriendsOverview` 获取好友、申请及分页信息；发送、接受、拒绝、删除好友均委托云函数完成，并在操作后重新拉取概览数据。【F:src/pages/friends/index.tsx†L80-L370】

以上流程涵盖了打卡记录写入、晚安心语关联、好友关系的创建 / 接受 / 删除及公开资料同步的关键节点，可据此评估数据库结构调整或业务逻辑重构的影响范围。
