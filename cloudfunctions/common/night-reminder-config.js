// Enable only after the approved WeChat template and timer have been verified.
// This is public application configuration, never an AppSecret/access token.
// Optional quickTest { userHash, until } is deployment-only, expires within
// 30 minutes, and must stay in a private file outside the repository.
module.exports = {
  enabled: true,
  templateId: '1Td3jSlrQVEkRS33nyEsmXx0TH7euJbya4LHoag3DHc',
  miniprogramState: 'formal',
  fields: [
    { key: 'time10', source: 'dueAt' },
    { key: 'thing3', text: '今天可以慢慢收尾了，来关一盏灯。' }
  ]
}
