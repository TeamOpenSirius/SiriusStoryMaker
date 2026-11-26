import { encodeDialoguePhrase } from '../../player/src/utils/dialogueBreaks'

export { decodeDialoguePhrase, encodeDialoguePhrase } from '../../player/src/utils/dialogueBreaks'

export function serializeDialogue(frame: { Order: number; FontSize: number; SpeakerName?: string; Phrase: string }) {
  const speaker = frame.SpeakerName?.replace(/[\r\n]/g, ' ') || ''
  const phrase = encodeDialoguePhrase(frame.Phrase)
  if (frame.Order === 2 && !speaker) return `+ ${phrase}`
  const suffix = frame.FontSize === 1 ? '(small)' : frame.FontSize === 3 ? '(large)' : ''
  return `${speaker}${suffix}: ${phrase}`
}
