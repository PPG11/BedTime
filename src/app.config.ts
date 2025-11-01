export default {
  pages: [
    'pages/home/index',
    'pages/friends/index',
    'pages/profile/index'
  ],
  lazyCodeLoading: 'requiredComponents',
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#fff',
    navigationBarTitleText: '早睡助手',
    navigationBarTextStyle: 'black'
  },
  tabBar: {
    color: '#8a8caf',
    selectedColor: '#6f63ff',
    backgroundColor: '#ffffff',
    borderStyle: 'white',
    list: [
      {
        pagePath: 'pages/home/index',
        text: '打卡',
        iconPath: 'assets/images/home.png',
        selectedIconPath: 'assets/images/home-active.png'
      },
      {
        pagePath: 'pages/friends/index',
        text: '好友',
        iconPath: 'assets/images/friends.png',
        selectedIconPath: 'assets/images/friends-active.png'
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的',
        iconPath: 'assets/images/profile.png',
        selectedIconPath: 'assets/images/profile-active.png'
      }
    ]
  }
}
