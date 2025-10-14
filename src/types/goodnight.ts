export type GoodnightMessage = {
  _id: string
  uid: string
  content: string
  likes: number
  dislikes: number
  date: string
  createdAt: Date
}

export type GoodnightVoteType = 'like' | 'dislike'

export const GOODNIGHT_MESSAGE_MAX_LENGTH = 80

export const GOODNIGHT_ERROR_ALREADY_SUBMITTED = 'goodnight-already-submitted'
