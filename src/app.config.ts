export default {
  pages: [
    'pages/home/index',
    'pages/friends/index',
    'pages/profile/index'
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#fff',
    navigationBarTitleText: '早睡助手',
    navigationBarTextStyle: 'black'
  },
  tabBar: {
    color: '#9295b0',
    selectedColor: '#5c6cff',
    backgroundColor: '#ffffff',
    borderStyle: 'white',
    list: [
      {
        pagePath: 'pages/home/index',
        text: '打卡'
      },
      {
        pagePath: 'pages/friends/index',
        text: '好友'
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的'
      }
    ]
  }
}
