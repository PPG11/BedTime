import { useCallback, useEffect, useMemo, useState } from 'react'
import { View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { DEFAULT_SLEEP_MINUTE, DEFAULT_USER_NAME, type UserSettings } from '../../utils/storage'
import { formatMinutesToTime, parseTimeStringToMinutes } from '../../utils/time'
import { ProfileUidCard } from '../../components/profile/ProfileUidCard'
import { ProfilePreferencesCard } from '../../components/profile/ProfilePreferencesCard'
import { ProfileTips } from '../../components/profile/ProfileTips'
import { updateCurrentUser } from '../../services'
import { useAppData } from '../../state/appData'
import './index.scss'

const profileTips = [
  'UID 会自动生成并永久保存到本地，用于后续与好友互相关注。',
  '个人偏好会影响打卡提醒与目标时间，请保持与你的作息一致。'
]

export default function Profile() {
  const {
    settings,
    setSettings,
    user: userDoc,
    setUser: setUserDoc,
    canUseCloud,
    localUid,
    refresh
  } = useAppData()
  const [isSyncing, setIsSyncing] = useState(false)
  const [nameDraft, setNameDraft] = useState<string>(settings.name || DEFAULT_USER_NAME)

  const uid = canUseCloud && userDoc ? userDoc.uid : localUid

  const targetTimeText = useMemo(
    () => formatMinutesToTime(settings.targetSleepMinute),
    [settings.targetSleepMinute]
  )

  useEffect(() => {
    setNameDraft(settings.name)
  }, [settings.name])

  const persistLocalSettings = useCallback(
    (next: UserSettings) => {
      setSettings(next)
    },
    [setSettings]
  )

  const handleNameInput = useCallback(
    async (event: { detail: { value: string } }) => {
      const value = event.detail.value
      setNameDraft(value)
    },
    []
  )

  const handleNameBlur = useCallback(
    async (event: { detail: { value: string } }) => {
      const trimmed = event.detail.value.trim()
      const nextName = trimmed.length ? trimmed : DEFAULT_USER_NAME
      const currentName = settings.name.trim().length
        ? settings.name.trim()
        : DEFAULT_USER_NAME
      if (nextName === currentName || isSyncing) {
        setNameDraft(settings.name)
        return
      }
      if (canUseCloud && userDoc) {
        setIsSyncing(true)
        try {
          const updated = await updateCurrentUser({ nickname: nextName })
          setUserDoc(updated)
          Taro.showToast({ title: '修改成功', icon: 'success', duration: 800 })
        } catch (error) {
          console.error('更新昵称失败', error)
          Taro.showToast({ title: '更新昵称失败', icon: 'none' })
          await refresh()
        } finally {
          setIsSyncing(false)
        }
        return
      }
      const nextSettings: UserSettings = {
        ...settings,
        name: nextName
      }
      setNameDraft(nextName)
      persistLocalSettings(nextSettings)
      Taro.showToast({ title: '修改成功', icon: 'success', duration: 800 })
    },
    [canUseCloud, isSyncing, persistLocalSettings, refresh, settings, userDoc]
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
          Taro.showToast({ title: '修改成功', icon: 'success', duration: 800 })
        } catch (error) {
          console.error('更新目标就寝时间失败', error)
          Taro.showToast({ title: '更新时间失败', icon: 'none' })
          await refresh()
        } finally {
          setIsSyncing(false)
        }
        return
      }
      persistLocalSettings({
        ...settings,
        targetSleepMinute: nextMinutes
      })
      Taro.showToast({ title: '修改成功', icon: 'success', duration: 800 })
    },
    [canUseCloud, isSyncing, persistLocalSettings, refresh, settings, userDoc]
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
        name={nameDraft}
        targetTimeText={targetTimeText}
        onNameInput={handleNameInput}
        onNameBlur={handleNameBlur}
        onTargetTimeChange={handleTargetTimeChange}
      />
      <ProfileTips tips={profileTips} />
    </View>
  )
}
