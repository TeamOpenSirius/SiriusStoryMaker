// WDS stores line breaks in Phrase as /n. Keep a dialogue frame on one DSL line.
export function encodeDialoguePhrase(phrase: string) {
  return phrase.replace(/\r\n|\r|\n/g, '/n')
}

export function decodeDialoguePhrase(phrase: string) {
  return phrase.replace(/\/n/g, '\n')
}

export function serializeDialogue(frame: { Order: number; FontSize: number; SpeakerName?: string; Phrase: string }) {
  const speaker = frame.SpeakerName?.replace(/[\r\n]/g, ' ') || ''
  const phrase = encodeDialoguePhrase(frame.Phrase)
  if (frame.Order === 2 && !speaker) return `+ ${phrase}`
  const suffix = frame.FontSize === 1 ? '(small)' : frame.FontSize === 3 ? '(large)' : ''
  return `${speaker}${suffix}: ${phrase}`
}
