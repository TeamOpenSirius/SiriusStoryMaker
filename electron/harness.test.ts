import { describe, expect, it } from 'vitest'
import { parseHarnessOutputLine, type HarnessStreamEvent } from './harness'

describe('parseHarnessOutputLine', () => {
  it('parses Claude stream-json session, assistant text, tool_use, and result', () => {
    const events: HarnessStreamEvent[] = []
    parseHarnessOutputLine(
      JSON.stringify({
        type: 'assistant',
        session_id: 'sess-123',
        message: {
          content: [
            { type: 'tool_use', name: 'Edit' },
            { type: 'text', text: '已更新剧本' },
          ],
        },
      }),
      (e) => events.push(e),
    )
    parseHarnessOutputLine(
      JSON.stringify({ type: 'result', result: 'ok' }),
      (e) => events.push(e),
    )

    expect(events).toEqual([
      { type: 'session', sessionId: 'sess-123' },
      { type: 'status', text: '执行工具: Edit' },
      { type: 'delta', text: '已更新剧本' },
      { type: 'status', text: '已完成回复' },
    ])
  })

  it('parses Codex exec --json thread_id and agent_message items', () => {
    const events: HarnessStreamEvent[] = []
    parseHarnessOutputLine(
      JSON.stringify({
        type: 'item.completed',
        thread_id: 'thr-456',
        item: { type: 'agent_message', text: '写好了第一幕' },
      }),
      (e) => events.push(e),
    )

    expect(events).toEqual([
      { type: 'session', sessionId: 'thr-456' },
      { type: 'delta', text: '写好了第一幕\n' },
    ])
  })
})
