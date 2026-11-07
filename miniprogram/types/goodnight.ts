export type GoodnightMessage = {
  _id: string
  content: string
  likes: number
  dislikes: number
  voted: boolean
}

export type GoodnightVoteType = 'like' | 'dislike'

export const GOODNIGHT_MESSAGE_MAX_LENGTH = 80
