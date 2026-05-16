import type { AppSettings, Domain, OutputStyle, PolishStrength } from '../types/settings'
import { postJson } from './http'
import { sanitizeApiKey } from './settings'

const DASHSCOPE_CHAT_COMPLETIONS_URL =
  'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

export interface PolishTextInput {
  rawTranscript: string
  domain: Domain
  customDomain?: string
  outputStyle: OutputStyle
  customTerms: string
  polishStrength?: PolishStrength
  model: string
  apiKey: string
}

const SYSTEM_PROMPT =
  '你是语音转文字后的文本修复器。你的任务是修正明显识别错误、错别字、标点、行业术语和语序问题。不要添加用户没有表达的新需求。不要改变用户的技术意图。如果不确定，保留原意。当前行业语境和术语表仅用于纠错，不用于凭空扩写。'

const domainLabels: Record<Domain, string> = {
  programmer: '程序员',
  product: '产品经理',
  legal: '法律',
  medical: '医疗',
  finance: '金融',
  custom: '自定义',
}

const styleInstructions: Record<OutputStyle, string> = {
  raw: '尽量保持原文，只修复明显错误和标点。',
  clear_spoken: '整理为清晰自然的口语表达，保持简洁。',
  programmer_prompt:
    '整理为适合发给 Codex、Cursor 或 Claude 的程序员 Prompt：自动分段，保留技术英文词，去掉口头禅，但不要新增未表达的需求。',
  github_issue: '整理为 GitHub Issue 描述，包含问题、期望结果和上下文；没有表达的信息不要编造。',
  pr_review_comment: '整理为 PR Review Comment，语气直接、具体、可执行；不要新增未表达的审查意见。',
}

function buildInput(input: PolishTextInput): string {
  const domain =
    input.domain === 'custom' && input.customDomain?.trim()
      ? input.customDomain.trim()
      : domainLabels[input.domain]

  return [
    `行业语境：${domain}`,
    `输出模式：${styleInstructions[input.outputStyle]}`,
    `润色强度：${input.polishStrength ?? 'medium'}`,
    input.customTerms.trim() ? `术语表：\n${input.customTerms.trim()}` : '术语表：无',
    `原始转写：\n${input.rawTranscript}`,
  ].join('\n\n')
}

function extractResponseText(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const choices = (body as { choices?: unknown[] }).choices
  const content = choices?.[0]
    ? ((choices[0] as { message?: { content?: unknown } }).message?.content ?? '')
    : ''
  return typeof content === 'string' ? content.trim() : ''
}

async function parseError(response: Response): Promise<string> {
  try {
    const body = await response.json()
    return (
      body?.error?.message ||
      body?.message ||
      body?.code ||
      `DashScope polish request failed with ${response.status}.`
    )
  } catch {
    return `DashScope polish request failed with ${response.status}.`
  }
}

export async function polishText(input: PolishTextInput): Promise<string> {
  const apiKey = sanitizeApiKey(input.apiKey)

  if (!apiKey) {
    throw new Error('DashScope API Key is missing.')
  }

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 60_000)

  try {
    const response = await postJson(
      DASHSCOPE_CHAT_COMPLETIONS_URL,
      {
        Authorization: `Bearer ${apiKey}`,
      },
      {
        model: input.model,
        messages: [
          {
            role: 'system',
            content: SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: buildInput(input),
          },
        ],
        temperature: 0.2,
        max_tokens: 1200,
      },
      controller.signal,
    )

    if (!response.ok) {
      throw new Error(await parseError(response))
    }

    const text = extractResponseText(await response.json())
    if (!text) {
      throw new Error('Polish response is empty.')
    }
    return text
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Polish request timed out.', { cause: error })
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

export function buildPolishInput(rawTranscript: string, settings: AppSettings): PolishTextInput {
  return {
    rawTranscript,
    domain: settings.domain,
    customDomain: settings.customDomain,
    outputStyle: settings.outputStyle,
    customTerms: settings.customTerms,
    polishStrength: settings.polishStrength,
    model: settings.polishModel,
    apiKey: settings.apiKey,
  }
}
