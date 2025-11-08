import { Component, createElement, type PropsWithChildren } from 'react'
import './sdk'

import './app.scss'
import { AppDataProvider } from './state/appData'

class App extends Component<PropsWithChildren> {
  componentDidMount () {}

  componentDidShow () {}

  componentDidHide () {}

  // this.props.children 是将要会渲染的页面
  render () {
    return createElement(AppDataProvider, null, this.props.children)
  }
}

export default App
