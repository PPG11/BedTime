import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Input, Picker, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import {
  DEFAULT_SLEEP_MINUTE,
  DEFAULT_USER_NAME,
  UserSettings,
  readSettings,
  readUserUid,
  saveSettings
} from '../../utils/storage'
import { formatMinutesToTime, parseTimeStringToMinutes } from '../../utils/time'
import './index.scss'

export default function Profile() {
  const [settings, setSettings] = useState<UserSettings>({
    name: DEFAULT_USER_NAME,
    targetSleepMinute: DEFAULT_SLEEP_MINUTE
  })
  const [uid, setUid] = useState<string>('')

  const targetTimeText = useMemo(
    () => formatMinutesToTime(settings.targetSleepMinute),
    [settings.targetSleepMinute]
  )

  const hydrate = useCallback(() => {
    setSettings(readSettings())
    setUid(readUserUid())
  }, [])

  useEffect(() => {
    hydrate()
  }, [hydrate])

  useDidShow(() => {
    hydrate()
  })

  const persistSettings = useCallback(
    (next: UserSettings) => {
      setSettings(next)
      saveSettings(next)
    },
    []
  )

  const handleNameInput = useCallback(
    (event: { detail: { value: string } }) => {
      const value = event.detail.value
      if (value === settings.name) {
        return
      }
      persistSettings({
        ...settings,
        name: value
      })
    },
    [persistSettings, settings]
  )

  const handleTargetTimeChange = useCallback(
    (event: { detail: { value: string } }) => {
      const nextMinutes = parseTimeStringToMinutes(event.detail.value, DEFAULT_SLEEP_MINUTE)
      if (nextMinutes === settings.targetSleepMinute) {
        return
      }
      persistSettings({
        ...settings,
        targetSleepMinute: nextMinutes
      })
    },
    [persistSettings, settings]
  )

  const handleCopyUid = useCallback(() => {
    if (!uid) {
      return
    }
    Taro.setClipboardData({
      data: uid,
      success: () => {
        Taro.showToast({ title: 'UID 已复制', icon: 'success' })
      },
      fail: () => {
        Taro.showToast({ title: '复制失败，请稍后重试', icon: 'none' })
      }
    })
  }, [uid])

  return (
    <View className='profile'>
      <View className='profile__card'>
        <Text className='profile__title'>我的账号</Text>
        <Text className='profile__uid'>{uid || '正在生成 UID...'}</Text>
        <Text className='profile__uid-hint'>将 UID 分享给好友，他们就能关注你的早睡打卡啦。</Text>
        <Button className='profile__copy' size='mini' onClick={handleCopyUid}>
          复制 UID
        </Button>
      </View>

      <View className='profile__card'>
        <Text className='profile__title'>个人偏好</Text>
        <View className='profile__field'>
          <Text className='profile__label'>称呼</Text>
          <Input
            className='profile__input'
            value={settings.name}
            placeholder='输入你的称呼'
            onInput={handleNameInput}
            maxLength={20}
          />
        </View>
        <View className='profile__field'>
          <Text className='profile__label'>目标入睡时间</Text>
          <Picker mode='time' value={targetTimeText} onChange={handleTargetTimeChange}>
            <View className='profile__picker'>{targetTimeText}</View>
          </Picker>
        </View>
      </View>

      <View className='profile__tips'>
        <Text className='profile__tips-title'>功能说明</Text>
        <Text className='profile__tips-item'>UID 会自动生成并永久保存到本地，用于后续与好友互相关注。</Text>
        <Text className='profile__tips-item'>个人偏好会影响打卡提醒与目标时间，请保持与你的作息一致。</Text>
      </View>
    </View>
  )
}
