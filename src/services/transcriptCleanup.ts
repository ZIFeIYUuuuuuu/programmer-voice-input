const standaloneFillers =
  /(^|[\s，。！？、；：,.!?;:])(?:嗯+|呃+|额+|啊+|唔+|呣+|呐+|诶+|哎+|唉+|em+|uh+|um+|那个|这个)(?=$|[\s，。！？、；：,.!?;:])/gi

const chinesePunctuation = /[，。！？、；：]/
const sentenceEndingPunctuation = /[。！？!?；;：:]$/
const westernPunctuation = /[,.!?;:]/
const latinOrNumber = /[A-Za-z0-9]/

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*([，。！？、；：])\s*/g, '$1')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim()
}

function removeStandaloneFillers(text: string): string {
  let previous = ''
  let current = text

  while (current !== previous) {
    previous = current
    current = current.replace(standaloneFillers, '$1')
  }

  return normalizeWhitespace(current)
    .replace(/^[，。！？、；：,.!?;:]+/, '')
    .replace(/[，、]\s*([。！？；：])/g, '$1')
    .trim()
}

function shouldInsertSpace(left: string, right: string): boolean {
  if (!left || !right) return false

  const last = left.at(-1) ?? ''
  const first = right.at(0) ?? ''

  if (sentenceEndingPunctuation.test(last)) return false
  if (chinesePunctuation.test(last) || chinesePunctuation.test(first)) return false
  if (westernPunctuation.test(first)) return false

  return latinOrNumber.test(last) && latinOrNumber.test(first)
}

function joinSegments(segments: string[]): string {
  return segments.reduce((result, segment) => {
    if (!result) return segment
    return `${result}${shouldInsertSpace(result, segment) ? ' ' : ''}${segment}`
  }, '')
}

export function cleanupTranscript(text: string): string {
  const segments = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((segment) => removeStandaloneFillers(segment))
    .filter(Boolean)

  return joinSegments(segments)
}
