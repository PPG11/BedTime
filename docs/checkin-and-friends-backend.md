# 打卡与好友功能后端交互说明

本文档梳理了小程序内「每日打卡」与「添加好友」功能与云开发数据库之间的主要交互逻辑，便于后续对业务流程进行调整与扩展。

## 数据集合概览

| 集合 | 作用 | 关键字段 |
| ---- | ---- | -------- |
| `users` | 保存用户主档信息及好友关系缓存 | `uid`、`nickname`、`tzOffset`、`targetHM`、`buddyList`、`incomingRequests`、`outgoingRequests`、`createdAt`、`updatedAt` |
| `checkins` | 以用户维度聚合打卡状态 | `_id`（用户 UID）、`uid`、`ownerOpenid`、`info[]`（`date`、`status`、`message`、`tzOffset`、`ts`）、`createdAt`、`updatedAt` |
| `public_profiles` | 好友列表展示所需的公开资料与状态 | `_id`、`uid`、`nickname`、`sleeptime`、`streak`、`todayStatus`、`updatedAt` |
| `friend_invites` | 好友邀请单与状态流转 | `_id`（`invite_sender_recipient` 组合）、`senderUid`、`senderOpenId`、`recipientUid`、`recipientOpenId`、`status`、`createdAt`、`updatedAt` |

所有集合名称由 `COLLECTIONS` 常量统一维护，便于后续修改。【F:src/config/cloud.ts†L15-L21】

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

### 用户主档与邀请缓存

`UserDocument` 同时维护好友列表与收发请求缓存字段（`buddyList`、`incomingRequests`、`outgoingRequests`），数据在 `hydrateUserInviteLists` 中与 `friend_invites` 集合同步，清理已接受 / 拒绝的邀请并回填本地缓存，避免前端显示过期数据。【F:src/services/user.ts†L9-L152】【F:src/services/user.ts†L371-L535】

新用户通过 `ensureCurrentUser` 创建：若 `users` 集合无记录，先生成唯一 UID，再写入包含默认昵称、目标睡眠时间、好友字段初始值的文档。【F:src/services/user.ts†L184-L223】

### 好友邀请发送（`sendFriendInvite`）

1. 入口会确认目标 UID 合法且非本人，同时检查当前用户的好友与申请缓存，避免重复邀请。【F:src/services/user.ts†L863-L909】
2. 通过公开资料集合反查目标用户，必要时尝试根据公开资料为对方补齐 `users` 文档，从而拿到 `recipientOpenId`。【F:src/services/user.ts†L886-L907】【F:src/services/user.ts†L675-L799】
3. 使用 `invite_sender_recipient` 作为主键读取 / 创建邀请文档；若已有 `pending` 状态直接返回“已发送”，若已接受则视为“已经是好友”。【F:src/services/user.ts†L916-L968】
4. 写入 / 更新邀请后，把对方 UID 追加到当前用户的 `outgoingRequests` 并更新时间戳，再读取最新用户文档返回给前端。【F:src/services/user.ts†L970-L985】

### 好友邀请处理（`respondFriendInvite`）

1. 依据当前用户的 `incomingRequests` 匹配来访者 UID，定位邀请文档，必要时兜底查询参与方组合。【F:src/services/user.ts†L992-L1044】
2. 根据接受 / 拒绝分支调整双方的 `buddyList` 与收发请求列表，保持云端字段同步；失败时仅打印警告以避免流程中断。【F:src/services/user.ts†L1046-L1107】
3. 更新邀请状态为 `accept`（兼容历史的 `accepted`）或 `declined`，最后重新读取当前用户返回最新数据。【F:src/services/user.ts†L1103-L1119】

### 好友关系解除（`removeFriend`）

- 校验目标 UID 在当前 `buddyList` 中，再分别更新双方的好友 / 请求缓存，确保解除关系后所有引用都被移除。【F:src/services/user.ts†L1122-L1171】

### 公开资料维护

昵称或目标睡眠时间更新后，会调用 `syncPublicProfileBasics` 同步 `public_profiles` 集合；若更新失败则回退到创建新公开档案，保证好友页可以读取最新展示信息。【F:src/services/user.ts†L537-L1211】

## 前端触发点概览

- 首页打卡按钮调用 `upsertCheckin`，成功后立即刷新公开资料并在本地缓存打卡时间戳。【F:src/pages/home/index.tsx†L233-L330】
- 好友页加载时通过 `ensureCurrentUser`、`fetchPublicProfiles` 等方法填充好友和申请列表，并在发送 / 处理邀请时调用上述服务函数更新数据库。【F:src/pages/friends/index.tsx†L5-L210】【F:src/pages/friends/index.tsx†L343-L525】

以上流程涵盖了打卡记录写入、晚安心语关联、好友关系的创建 / 接受 / 删除及公开资料同步的关键节点，可据此评估数据库结构调整或业务逻辑重构的影响范围。
