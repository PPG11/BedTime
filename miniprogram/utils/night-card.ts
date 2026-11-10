import type { NightRecord } from '../types/night'
import { BRAND } from '../config/brand'
export const CARD_SIZE = { width: 1080, height: 1440 }
const NO_START = '，。！？、；：）》】」』…—'
const NO_END = '（《【「『'

/** Wrap the frozen wording without changing characters or shrinking the type. */
export function wrapPhrase(text: string, width: number, measure: (text: string) => number): string[] {
  const lines: string[] = []
  let line = ''
  for (const character of Array.from(text)) {
    if (line && measure(line + character) > width) {
      if (NO_START.includes(character)) { lines.push(line + character); line = ''; continue }
      if (NO_END.includes(line.slice(-1))) { const opening = line.slice(-1); lines.push(line.slice(0, -1)); line = opening }
      else { lines.push(line); line = '' }
    }
    line += character
  }
  if (line) lines.push(line)
  return lines.filter(Boolean)
}

export async function renderNightCard(canvas: WechatMiniprogram.Canvas, record: NightRecord): Promise<string> {
  canvas.width = CARD_SIZE.width; canvas.height = CARD_SIZE.height
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#140f1e'; ctx.fillRect(0, 0, 1080, 1440)
  for (const name of ['sky', 'distant', 'facade']) {
    const image = canvas.createImage()
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; image.src = `/assets/night/${name}.png` })
    // Center-crop the 720×660 artwork; preserve the same scale on both axes.
    const sourceHeight = 790 * 720 / 1080
    ctx.drawImage(image, 0, (660 - sourceHeight) / 2, 720, sourceHeight, 0, 0, 1080, 790)
  }
  const gradient = ctx.createLinearGradient(0, 650, 0, 820)
  gradient.addColorStop(0, 'rgba(20,15,30,0)'); gradient.addColorStop(1, '#140f1e')
  ctx.fillStyle = gradient; ctx.fillRect(0, 650, 1080, 175)
  ctx.font = '54px sans-serif'; ctx.fillStyle = '#e8e2d6'; ctx.textBaseline = 'top'
  const lines = wrapPhrase(record.phraseText, 800, value => ctx.measureText(value).width)
  if (lines.length > 4) throw new Error('句子排版超出夜签范围')
  const top = lines.length > 3 ? 840 : 880
  lines.forEach((line, index) => ctx.fillText(line, 130, top + index * 88))
  ctx.font = '26px sans-serif'; ctx.fillStyle = '#b4a8b6'
  ctx.fillText(`${record.nightId.slice(0, 4)} 年 ${Number(record.nightId.slice(4, 6))} 月 ${Number(record.nightId.slice(6, 8))} 日的夜晚`, 130, 1240)
  // Branding is decorative: an unavailable mark must not block a private export.
  let brandLeft = 130
  try {
    const mark = canvas.createImage()
    await new Promise<void>((resolve, reject) => { mark.onload = () => resolve(); mark.onerror = reject; mark.src = BRAND.icon })
    ctx.drawImage(mark, 130, 1307, 64, 64)
    brandLeft = 212
  } catch { /* Keep the complete wordmark when the optional image cannot load. */ }
  ctx.fillStyle = '#e8e2d6'; ctx.fillText(BRAND.name, brandLeft, 1328)
  return new Promise<string>((resolve, reject) => wx.canvasToTempFilePath({ canvas, x: 0, y: 0, width: 1080, height: 1440, destWidth: 1080, destHeight: 1440, fileType: 'png', success: result => resolve(result.tempFilePath), fail: reject }))
}
