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
import { UserDocument, ensureCurrentUser, supportsCloud, updateCurrentUser } from '../../services/database'
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
  const [userDoc, setUserDoc] = useState<UserDocument | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [canUseCloud] = useState(() => supportsCloud())

  const targetTimeText = useMemo(
    () => formatMinutesToTime(settings.targetSleepMinute),
    [settings.targetSleepMinute]
  )

  const hydrate = useCallback(async () => {
    if (canUseCloud) {
      setIsSyncing(true)
      try {
        const user = await ensureCurrentUser()
        setUserDoc(user)
        setSettings({
          name: user.nickname || DEFAULT_USER_NAME,
          targetSleepMinute: parseTimeStringToMinutes(user.targetHM, DEFAULT_SLEEP_MINUTE)
        })
        setUid(user.uid)
      } catch (error) {
        console.error('同步云端资料失败，使用本地数据', error)
        Taro.showToast({ title: '云端同步失败，使用本地模式', icon: 'none', duration: 2000 })
        // 回退到本地模式
        setUserDoc(null)
        setSettings(readSettings())
        setUid(readUserUid())
      } finally {
        setIsSyncing(false)
      }
      return
    }
    setUserDoc(null)
    setSettings(readSettings())
    setUid(readUserUid())
  }, [canUseCloud])

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useDidShow(() => {
    void hydrate()
  })

  const persistLocalSettings = useCallback((next: UserSettings) => {
    setSettings(next)
    saveSettings(next)
  }, [])

  const handleNameInput = useCallback(
    async (event: { detail: { value: string } }) => {
      const value = event.detail.value
      if (value === settings.name || isSyncing) {
        return
      }
      if (canUseCloud && userDoc) {
        setIsSyncing(true)
        try {
          const updated = await updateCurrentUser({ nickname: value })
          setUserDoc(updated)
          setSettings({
            name: updated.nickname || DEFAULT_USER_NAME,
            targetSleepMinute: parseTimeStringToMinutes(updated.targetHM, DEFAULT_SLEEP_MINUTE)
          })
        } catch (error) {
          console.error('更新昵称失败', error)
          Taro.showToast({ title: '更新昵称失败', icon: 'none' })
          await hydrate()
        } finally {
          setIsSyncing(false)
        }
        return
      }
      persistLocalSettings({
        ...settings,
        name: value
      })
    },
    [canUseCloud, hydrate, isSyncing, persistLocalSettings, settings, userDoc]
  )

  const handleTargetTimeChange = useCallback(
    async (event: { detail: { value: string } }) => {
      const nextMinutes = parseTimeStringToMinutes(event.detail.value, DEFAULT_SLEEP_MINUTE)
      if (nextMinutes === settings.targetSleepMinute || isSyncing) {
        return
      }
      const targetHM = formatMinutesToTime(nextMinutes)
      if (canUseCloud && userDoc) {
        setIsSyncing(true)
        try {
          const updated = await updateCurrentUser({ targetHM })
          setUserDoc(updated)
          setSettings({
            name: updated.nickname || DEFAULT_USER_NAME,
            targetSleepMinute: parseTimeStringToMinutes(updated.targetHM, DEFAULT_SLEEP_MINUTE)
          })
        } catch (error) {
          console.error('更新目标就寝时间失败', error)
          Taro.showToast({ title: '更新时间失败', icon: 'none' })
          await hydrate()
        } finally {
          setIsSyncing(false)
        }
        return
      }
      persistLocalSettings({
        ...settings,
        targetSleepMinute: nextMinutes
      })
    },
    [canUseCloud, hydrate, isSyncing, persistLocalSettings, settings, userDoc]
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
