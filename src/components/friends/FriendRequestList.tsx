import { Button, Text, View } from '@tarojs/components'

export type FriendRequestItem = {
  requestId: string
  uid: string
  nickname: string
  sleeptime: string
  updatedAtLabel: string
}

type FriendRequestListProps = {
  requests: FriendRequestItem[]
  onAccept?: (requestId: string, uid: string) => void
  onReject?: (requestId: string, uid: string) => void
}

export function FriendRequestList({ requests, onAccept, onReject }: FriendRequestListProps) {
  const hasRequests = requests.length > 0
  const handleAccept = (requestId: string, uid: string) => {
    if (typeof onAccept === 'function') {
      onAccept(requestId, uid)
    }
  }
  const handleReject = (requestId: string, uid: string) => {
    if (typeof onReject === 'function') {
      onReject(requestId, uid)
    }
  }

  return (
    <View className='friends__card'>
      <Text className='friends__title'>好友申请</Text>
      {hasRequests ? (
        <View className='friends__requests'>
          {requests.map((request) => (
            <View key={request.requestId} className='friends__request-item'>
              <View className='friends__request-info'>
                <Text className='friends__item-name'>{request.nickname}</Text>
                <Text className='friends__item-uid'>UID：{request.uid}</Text>
                <Text className='friends__request-meta'>
                  目标就寝：{request.sleeptime} · 最近更新：{request.updatedAtLabel}
                </Text>
              </View>
              <View className='friends__request-actions'>
                <Button
                  size='mini'
                  type='primary'
                  onClick={() => handleAccept(request.requestId, request.uid)}
                >
                  同意
                </Button>
                <Button
                  size='mini'
                  className='friends__remove'
                  onClick={() => handleReject(request.requestId, request.uid)}
                >
                  拒绝
                </Button>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <Text className='friends__empty'>暂无新的好友申请。</Text>
      )}
    </View>
  )
}
