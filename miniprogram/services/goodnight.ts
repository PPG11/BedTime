import type { GoodnightMessage, GoodnightVoteType } from '../types/goodnight'
import { callCloud } from './cloud'

export function fetchOwnGoodnightMessage(date: string): Promise<GoodnightMessage | null> {
  return callCloud('bedtimeGoodnight', 'ownSubmission', { date })
}

export function fetchGoodnightReward(date: string): Promise<GoodnightMessage | null> {
  return callCloud('bedtimeGoodnight', 'reward', { date })
}

export function submitGoodnightMessage(date: string, text: string): Promise<GoodnightMessage> {
  return callCloud('bedtimeGoodnight', 'submit', { date, text })
}

export function voteGoodnightMessage(date: string, vote: GoodnightVoteType): Promise<GoodnightMessage> {
  return callCloud('bedtimeGoodnight', 'vote', { date, value: vote === 'like' ? 1 : -1 })
}
