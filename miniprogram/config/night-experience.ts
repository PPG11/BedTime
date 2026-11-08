// Selected by the author after iPhone experience and Android smoke testing.
// Detailed device acceptance remains separate from this implementation choice.
export const EXPERIENCE = {
  holdMs: 800,
  blackoutMs: 800,
  cancelMs: 200,
  fadeMs: 400,
  revealMs: 400,
  reducedBlackoutMs: 800,
  unknownMs: 8_000,
  moveTolerancePx: 24,
  clockJumpMs: 2_000
} as const

export const DEMO_PHRASE = '今天就到这里。剩下的，明天再说。'
