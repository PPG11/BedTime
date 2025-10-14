import Taro from '@tarojs/taro'
import {
  GOODNIGHT_ERROR_ALREADY_SUBMITTED,
  type GoodnightMessage,
  type GoodnightVoteType
} from '../types/goodnight'

const STORAGE_KEY = 'bedtime-goodnight-messages'

type StoredGoodnightMessage = Omit<GoodnightMessage, 'createdAt'> & {
  createdAt: string
}

function isStoredGoodnightMessage(value: unknown): value is StoredGoodnightMessage {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as Partial<StoredGoodnightMessage>
  return (
    typeof record._id === 'string' &&
    typeof record.uid === 'string' &&
    typeof record.content === 'string' &&
    typeof record.date === 'string' &&
    typeof record.likes === 'number' &&
    typeof record.dislikes === 'number' &&
    typeof record.createdAt === 'string'
  )
}

function readStoredMessages(): StoredGoodnightMessage[] {
  try {
    const stored = Taro.getStorageSync(STORAGE_KEY) as StoredGoodnightMessage[] | undefined
    if (Array.isArray(stored)) {
      return stored.filter(isStoredGoodnightMessage)
    }
  } catch (error) {
    console.warn('读取晚安心语列表失败', error)
  }
  return []
}

function writeStoredMessages(list: StoredGoodnightMessage[]): void {
  try {
    Taro.setStorageSync(STORAGE_KEY, list)
  } catch (error) {
    console.warn('保存晚安心语列表失败', error)
  }
}

function toStored(message: GoodnightMessage): StoredGoodnightMessage {
  return {
    _id: message._id,
    uid: message.uid,
    content: message.content,
    likes: message.likes,
    dislikes: message.dislikes,
    date: message.date,
    createdAt: message.createdAt.toISOString()
  }
}

function fromStored(record: StoredGoodnightMessage): GoodnightMessage {
  return {
    _id: record._id,
    uid: record.uid,
    content: record.content,
    likes: record.likes,
    dislikes: record.dislikes,
    date: record.date,
    createdAt: new Date(record.createdAt)
  }
}

function getMessageId(uid: string, date: string): string {
  return `${uid}_${date}`
}

export function readLocalGoodnightMessage(uid: string, date: string): GoodnightMessage | null {
  const list = readStoredMessages()
  const target = list.find((item) => item.uid === uid && item.date === date)
  return target ? fromStored(target) : null
}

export function createLocalGoodnightMessage(params: {
  uid: string
  content: string
  date: string
}): GoodnightMessage {
  const list = readStoredMessages()
  const existing = list.find((item) => item.uid === params.uid && item.date === params.date)
  if (existing) {
    throw new Error(GOODNIGHT_ERROR_ALREADY_SUBMITTED)
  }

  const message: GoodnightMessage = {
    _id: getMessageId(params.uid, params.date),
    uid: params.uid,
    content: params.content.trim(),
    likes: 0,
    dislikes: 0,
    date: params.date,
    createdAt: new Date()
  }

  list.push(toStored(message))
  writeStoredMessages(list)
  return message
}

export function pickRandomLocalGoodnightMessage(excludeUid?: string): GoodnightMessage | null {
  const list = readStoredMessages().map(fromStored)
  const candidates = excludeUid ? list.filter((item) => item.uid !== excludeUid) : list
  if (!candidates.length) {
    return null
  }
  const randomIndex = Math.floor(Math.random() * candidates.length)
  return candidates[randomIndex]
}

export function voteLocalGoodnightMessage(
  id: string,
  vote: GoodnightVoteType
): GoodnightMessage | null {
  const list = readStoredMessages()
  const index = list.findIndex((item) => item._id === id)
  if (index === -1) {
    return null
  }

  const updated: StoredGoodnightMessage = { ...list[index] }
  if (vote === 'like') {
    updated.likes += 1
  } else {
    updated.dislikes += 1
  }

  list[index] = updated
  writeStoredMessages(list)
  return fromStored(updated)
}
