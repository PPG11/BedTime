# 打卡与好友功能后端交互说明

本文档梳理了小程序内「每日打卡」与「添加好友」功能与云开发数据库之间的主要交互逻辑，便于后续对业务流程进行调整与扩展。

## 数据集合概览

| 集合 | 作用 | 关键字段 |
| ---- | ---- | -------- |
| `users` | 保存用户主档信息及好友关系缓存 | `uid`、`nickname`、`tzOffset`、`targetHM`、`buddyList`、`incomingRequests`、`outgoingRequests`、`createdAt`、`updatedAt` |
| `checkins` | 记录用户每日打卡状态 | `_id`（`uid_date` 组合）、`uid`、`userUid`、`date`、`status`、`ts`、`tzOffset`、`goodnightMessageId` / `message` |
| `public_profiles` | 好友列表展示所需的公开资料与状态 | `_id`、`uid`、`nickname`、`sleeptime`、`streak`、`todayStatus`、`updatedAt` |
| `friend_invites` | 好友邀请单与状态流转 | `_id`（`invite_sender_recipient` 组合）、`senderUid`、`senderOpenId`、`recipientUid`、`recipientOpenId`、`status`、`createdAt`、`updatedAt` |

所有集合名称由 `COLLECTIONS` 常量统一维护，便于后续修改。【F:src/config/cloud.ts†L15-L21】

## 打卡业务流程

### 数据模型

打卡服务以 `CheckinDocument` 描述存储结构：`uid` 和 `date` 拼出 `_id`，同时保存时区偏移、打卡状态以及晚安心语关联信息。【F:src/services/checkin.ts†L10-L87】

### 写入流程（`upsertCheckin`）

1. 组合文档 ID：`uid_date`，并拼出完整负载，默认时间戳使用云端 `serverDate()`。【F:src/services/checkin.ts†L307-L321】
2. 首次尝试使用 `set` 写入，如命中唯一键冲突则进入兼容逻辑。【F:src/services/checkin.ts†L328-L336】
3. 先依据 `_id` 或同日 `_openid` 记录尝试 `update`，避免重复创建。【F:src/services/checkin.ts†L164-L240】
4. 若仍未找到既有文档，会执行 `migrateLegacyCheckins`：批量校正旧数据的 `uid`/`date` 字段后再更新目标日期，保证历史数据迁移到新命名规范。【F:src/services/checkin.ts†L242-L305】
5. 兜底再次 `set` 写入；若仍冲突则重复查找并 `update`，最终返回归一化的 `CheckinDocument`。【F:src/services/checkin.ts†L338-L373】

### 晚安心语同步

`updateCheckinGoodnightMessage` 会按用户 UID + 日期查找已存在的打卡记录，统一更新 `goodnightMessageId` 与 `message` 字段，若文档缺失则新建补齐，保证两字段保持互为备用引用。【F:src/services/checkin.ts†L375-L417】

### 查询能力

- `fetchCheckins`：按当前小程序用户的 `_openid` 查询指定 UID 的最近打卡列表，限制最多 1000 条并按日期降序返回。【F:src/services/checkin.ts†L420-L434】
- `fetchCheckinInfoForDate`：利用 `_id` 或 `_openid` + `date` 精确匹配单日记录，返回标准化结果。【F:src/services/checkin.ts†L436-L448】
- `fetchCheckinsInRange`：构建日期范围查询，结合 `_openid` 限制和二次过滤确保返回值严格落在指定区间。【F:src/services/checkin.ts†L450-L472】
- `computeHitStreak`：基于日期键回溯连续打卡天数，供前端展示 streak 信息。【F:src/services/checkin.ts†L475-L491】

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
