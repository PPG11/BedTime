import { useCallback, useEffect, useMemo, useState } from 'react'
import { View } from '@tarojs/components'
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
import { ProfileUidCard } from '../../components/profile/ProfileUidCard'
import { ProfilePreferencesCard } from '../../components/profile/ProfilePreferencesCard'
import { ProfileTips } from '../../components/profile/ProfileTips'
import './index.scss'

const profileTips = [
  'UID 会自动生成并永久保存到本地，用于后续与好友互相关注。',
  '个人偏好会影响打卡提醒与目标时间，请保持与你的作息一致。'
]

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

  const persistSettings = useCallback((next: UserSettings) => {
    setSettings(next)
    saveSettings(next)
  }, [])

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
      <ProfileUidCard uid={uid} onCopy={handleCopyUid} />
      <ProfilePreferencesCard
        name={settings.name}
        targetTimeText={targetTimeText}
        onNameInput={handleNameInput}
        onTargetTimeChange={handleTargetTimeChange}
      />
      <ProfileTips tips={profileTips} />
    </View>
  )
}
