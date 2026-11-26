// WDS ADV writes line breaks as /n. Accept the common \n spelling and
// real line breaks as well, without creating an extra dialogue frame.
const lineBreak = /\r\n?|\n|[\\/]n/g

export function encodeDialoguePhrase(phrase: string) {
    return phrase.replace(lineBreak, '/n')
}

export function decodeDialoguePhrase(phrase: string) {
    return phrase.replace(lineBreak, '\n')
}
