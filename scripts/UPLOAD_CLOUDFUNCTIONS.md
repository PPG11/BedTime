# 批量上传云函数指南

本项目提供了多种方式来批量上传微信小程序的云函数。

## 方法一：使用微信开发者工具图形界面（推荐）

这是最可靠的方式，适合所有用户：

### 步骤：

1. **打开微信开发者工具**
   - 启动微信开发者工具
   - 打开项目目录：`/Users/luolie/Documents/GitHub/BedTime/dist`

2. **在云开发控制台批量上传**
   - 点击左侧 "云开发" 按钮
   - 进入 "云函数" 页面
   - 可以看到所有云函数列表
   - 可以：
     - **逐个上传**：右键点击函数 → 选择 "上传并部署：云端安装依赖"
     - **批量操作**：按住 `Cmd` (Mac) 或 `Ctrl` (Windows) 键，选择多个函数后批量上传

3. **或者通过文件管理器**
   - 在左侧文件树中，找到 `cloudfunctions` 目录
   - 展开后可以看到所有云函数文件夹
   - 逐个右键点击 → "上传并部署：云端安装依赖"

### 需要上传的云函数列表：

根据当前项目结构，需要上传以下云函数（共 16 个）：

1. `authCode2Session` - 交换 js_code 获取 openid
2. `checkinRange` - 按范围读取打卡历史
3. `checkinSubmit` - 提交当日打卡
4. `databaseProxy` - 数据库代理
5. `ensureCheckinsDoc` - 确保打卡文档存在
6. `friendFinish` - 完成好友申请
7. `friendRemove` - 移除好友
8. `friendRequestSend` - 发送好友申请
9. `friendRequestUpdate` - 更新好友申请状态
10. `friendsPage` - 获取好友列表
11. `gnGetRandom` - 获取随机晚安心语
12. `gnReact` - 点赞/点踩晚安心语
13. `gnReactionsConsume` - 消费点赞事件
14. `gnSubmit` - 提交晚安心语
15. `slotRollup` - 时段统计汇总
16. `userEnsure` - 确保用户存在

> **注意**：`common` 目录是共享模块，不需要单独上传，它会被其他云函数引用。

## 方法二：使用命令行脚本（需要配置 CLI）

如果你已经配置了微信开发者工具的命令行工具，可以使用提供的脚本：

### 使用 Node.js 脚本：

```bash
yarn upload:cloudfunctions
# 或
npm run upload:cloudfunctions
```

### 使用 Shell 脚本：

```bash
yarn upload:cloudfunctions:sh
# 或
bash scripts/upload-cloudfunctions.sh
```

### 前提条件：

1. **安装微信开发者工具 CLI**
   - Mac: 在微信开发者工具中：设置 → 安全设置 → 开启服务端口
   - 然后可以通过 `cli` 命令访问

2. **确保开发者工具已启动**
   - 脚本需要微信开发者工具正在运行
   - 需要在开发者工具中打开当前项目

### 如果 CLI 不可用：

如果遇到 "command not found: cli" 错误，说明 CLI 未配置，请使用方法一（图形界面）。

## 方法三：使用 VSCode 扩展（可选）

如果使用 VSCode，可以安装 "微信小程序开发工具" 扩展，它提供了云函数上传的快捷方式。

## 上传前检查清单

在上传云函数之前，请确保：

- [ ] 所有云函数都有 `package.json` 文件
- [ ] `package.json` 中已正确配置依赖（特别是 `wx-server-sdk`）
- [ ] `common` 模块已正确配置（使用 `file:../common` 引用）
- [ ] 云函数代码没有语法错误
- [ ] 已在微信开发者工具中登录账号
- [ ] 已选择正确的云开发环境

## 上传后验证

上传完成后，建议：

1. 在云开发控制台检查每个函数的部署状态
2. 测试关键云函数是否正常工作
3. 检查云函数的日志，确认没有运行时错误

## 常见问题

### Q: 上传失败，提示权限错误？

A: 确保在微信开发者工具中已登录账号，并且有该云开发环境的权限。

### Q: 上传后依赖安装失败？

A: 选择 "上传并部署：云端安装依赖" 选项，而不是仅上传。如果仍然失败，检查 `package.json` 中的依赖配置。

### Q: common 模块如何处理？

A: `common` 目录不需要单独上传，它会被其他云函数通过 `file:../common` 引用。确保使用该引用的云函数上传时选择 "云端安装依赖"。

### Q: 如何只上传修改过的云函数？

A: 微信开发者工具会自动检测哪些函数需要更新。如果只想上传特定函数，可以手动选择它们进行上传。

## 自动化建议

如果需要频繁上传云函数，建议：

1. 配置 Git hooks，在提交前自动检查云函数代码
2. 使用 CI/CD 流程自动化部署（需要企业版或自建）
3. 创建更精细的脚本，只上传有变更的函数

## 相关文档

- [微信小程序云开发文档](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/basis/getting-started.html)
- [云函数开发文档](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/guide/functions.html)
