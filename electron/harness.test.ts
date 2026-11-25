import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  buildCliArgs,
  listStudioSkills,
  parseHarnessOutputLine,
  type HarnessStreamEvent,
} from './harness'
import { executeStudioMcpTool } from './mcp-server'
import { createZipBuffer } from './zip'

describe('harness stream parser & CLI args', () => {
  it('parses Claude/Antigravity stream-json assistant text and tool_use events', () => {
    const events: HarnessStreamEvent[] = []
    parseHarnessOutputLine(
      JSON.stringify({
        type: 'assistant',
        session_id: 'sess-123',
        message: {
          content: [
            { type: 'text', text: '正在修改剧本' },
            { type: 'tool_use', name: 'write_story' },
          ],
        },
      }),
      (ev) => events.push(ev),
    )

    expect(events).toEqual([
      { type: 'session', sessionId: 'sess-123' },
      { type: 'delta', text: '正在修改剧本' },
      { type: 'status', text: '执行工具: write_story' },
    ])
  })

  it('parses Codex JSON agent_message and thread_id events', () => {
    const events: HarnessStreamEvent[] = []
    parseHarnessOutputLine(
      JSON.stringify({
        type: 'item.completed',
        thread_id: 'thr-999',
        item: { type: 'agent_message', text: '已更新剧情。' },
      }),
      (ev) => events.push(ev),
    )

    expect(events).toEqual([
      { type: 'session', sessionId: 'thr-999' },
      { type: 'delta', text: '已更新剧情。\n' },
    ])
  })

  it('parses Antigravity CLI step_update text_delta and result usage events', () => {
    const events: HarnessStreamEvent[] = []
    parseHarnessOutputLine(
      JSON.stringify({
        event: 'step_update',
        step_update: {
          conversation_id: 'agy-conv-1',
          step_type: 'agent_response',
          text_delta: '你好！',
        },
      }),
      (ev) => events.push(ev),
    )
    parseHarnessOutputLine(
      JSON.stringify({
        event: 'result',
        result: {
          conversation_id: 'agy-conv-1',
          status: 'SUCCESS',
          usage: { input_tokens: 1200, output_tokens: 45, cache_read_tokens: 300 },
        },
      }),
      (ev) => events.push(ev),
    )

    expect(events).toContainEqual({ type: 'session', sessionId: 'agy-conv-1' })
    expect(events).toContainEqual({ type: 'delta', text: '你好！' })
    expect(events).toContainEqual({
      type: 'usage',
      inputTokens: 1200,
      outputTokens: 45,
      cacheReadTokens: 300,
    })
  })

  it('builds Antigravity CLI args with model, effort, and resume', () => {
    const args = buildCliArgs(
      {
        harnessId: 'agy',
        command: 'agy',
        prompt: '写一段排练',
        script: '',
        model: 'gemini-4-neon-high',
        effort: 'xhigh',
        sessionId: 'conv-1',
        enableMcp: true,
      },
      {
        dir: '/tmp/ws',
        guide: 'guide',
        fullPrompt: 'full',
        mcpServerPath: '/tmp/mcp.mjs',
        resourceTreePath: '/tmp/tree.json',
      },
    )

    expect(args).toContain('--model')
    expect(args).toContain('gemini-4-neon-high')
    expect(args).toContain('--effort')
    expect(args).toContain('xhigh')
    expect(args).toContain('--resume')
    expect(args).toContain('conv-1')
  })

  it('builds Claude & Codex args with model, effort, and MCP', () => {
    const claudeArgs = buildCliArgs(
      {
        harnessId: 'claude',
        command: 'claude',
        prompt: 'test',
        script: '',
        model: 'opus',
        effort: 'max',
        enableMcp: true,
      },
      {
        dir: '/tmp/ws',
        guide: 'guide',
        fullPrompt: 'full',
        mcpConfigPath: '/tmp/ws/.mcp.json',
        mcpServerPath: '/tmp/mcp.mjs',
        resourceTreePath: '/tmp/tree.json',
      },
    )
    expect(claudeArgs).toContain('--model')
    expect(claudeArgs).toContain('opus')
    expect(claudeArgs).toContain('--effort')
    expect(claudeArgs).toContain('max')
    expect(claudeArgs).toContain('--mcp-config')
    expect(claudeArgs).toContain('/tmp/ws/.mcp.json')

    const codexArgs = buildCliArgs(
      {
        harnessId: 'codex',
        command: 'codex',
        prompt: 'test',
        script: '',
        model: 'gpt-5.4',
        effort: 'high',
        enableMcp: false,
      },
      {
        dir: '/tmp/ws',
        guide: 'guide',
        fullPrompt: 'full',
        mcpServerPath: '/tmp/mcp.mjs',
        resourceTreePath: '/tmp/tree.json',
      },
    )
    expect(codexArgs).toContain('--skip-git-repo-check')
    expect(codexArgs).toContain('-m')
    expect(codexArgs).toContain('gpt-5.4')
    expect(codexArgs).toContain('model_reasoning_effort="high"')
  })

  it('discovers built-in Studio Skills and executes MCP tools', async () => {
    const skills = await listStudioSkills()
    expect(skills.length).toBeGreaterThanOrEqual(4)
    expect(skills.map((s) => s.id)).toContain('sirius-dsl-author')

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sirius-mcp-test-'))
    const storyFile = path.join(tmpDir, 'current.story')
    const writeRes = JSON.parse(
      await executeStudioMcpTool(
        'write_story',
        { content: '@title 测试\n心菜: 你好！\n' },
        { storyFile },
      ),
    )
    expect(writeRes.ok).toBe(true)
    expect(writeRes.frameCount).toBe(1)

    const readBack = await executeStudioMcpTool('read_story', {}, { storyFile })
    expect(readBack).toContain('心菜: 你好！')
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('creates a valid PKZIP buffer containing episode.json and custom assets', () => {
    const zip = createZipBuffer([
      { name: 'episode.json', data: '{"Title":"Test"}' },
      { name: 'assets/background/asset_demo.png', data: Buffer.from([137, 80, 78, 71]) },
    ])
    // PKZIP local file header signature (PK\x03\x04) and EOCD signature (PK\x05\x06)
    expect(zip.readUInt32LE(0)).toBe(0x04034b50)
    expect(zip.includes(Buffer.from('episode.json'))).toBe(true)
    expect(zip.includes(Buffer.from('assets/background/asset_demo.png'))).toBe(true)
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50)
  })
})

describe('current local CLI contracts', () => {
  const context = {
    dir: '/tmp/Studio workspace',
    guide: 'Guide',
    fullPrompt: '-- this is still prompt text',
    mcpServerPath: '/tmp/not-a-server.mjs',
    resourceTreePath: '/tmp/tree.json',
  }
  const base = { command: 'test', prompt: 'edit', script: '', enableMcp: false }
  it('builds current Codex resume command without legacy full-auto or resume-only unsupported flags', () => {
    const args = buildCliArgs({ ...base, harnessId: 'codex', sessionId: 'thread-1' }, context)
    expect(args).toEqual([
      '-a', 'never', '-c', 'sandbox_mode="workspace-write"', 'exec', 'resume',
      '--json', '--skip-git-repo-check', '--', 'thread-1', context.fullPrompt,
    ])
  })
  it('passes Claude prompt after flags and scopes MCP to the Studio instance', () => {
    const args = buildCliArgs({ ...base, harnessId: 'claude', enableMcp: true }, { ...context, mcpConfigPath: '/tmp/studio.json' })
    expect(args).toContain('--strict-mcp-config')
    expect(args).toContain('mcp__sirius-adv-studio__*')
    expect(args.slice(-2)).toEqual(['--', context.fullPrompt])
  })
  it('uses dsh headless, carries session ID and parses its stdout', () => {
    const args = buildCliArgs({ ...base, harnessId: 'dsh', sessionId: 'session-1' }, context)
    expect(args).toEqual([
      'headless', '--json', '--permission-mode', 'workspace-write', '--approval-policy', 'never',
      '--session-id', 'session-1', '--', context.fullPrompt,
    ])
    const events: HarnessStreamEvent[] = []
    for (const row of [{ type: 'session', sessionId: 'session-1' }, { type: 'text', text: '剧情已修改' }]) {
      parseHarnessOutputLine(JSON.stringify(row), (event) => events.push(event))
    }
    expect(events).toEqual([{ type: 'session', sessionId: 'session-1' }, { type: 'delta', text: '剧情已修改' }])
  })
  it('reports structured Codex turn failures', () => {
    const events: HarnessStreamEvent[] = []
    parseHarnessOutputLine('{"type":"turn.failed","error":{"message":"model unavailable"}}', (event) => events.push(event))
    expect(events).toEqual([{ type: 'error', message: 'model unavailable' }])
  })
})

it.skipIf(process.platform === 'win32')('runs a CLI turn in the project cache and synchronizes one completed edit', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sirius-local-turn-'))
  const originalPath = process.env.PATH
  const workspace = path.join(temp, 'project', 'ai-cache', 'workspace')
  const command = path.join(temp, 'codex')
  const source = '@title Before\n: Draft\n'
  const updated = '@title After\n: 修订剧情\n'
  try {
    await fs.writeFile(command, `#!/usr/bin/env node
const fs = require('node:fs');
if (!process.argv.includes('--json')) process.exit(3);
if (fs.readFileSync('current.story', 'utf8') !== ${JSON.stringify(source)}) process.exit(4);
console.log(JSON.stringify({type:'thread.started',thread_id:'turn-test'}));
fs.writeFileSync('current.story', ${JSON.stringify(updated)});
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'完成修改'}}));
`, { mode: 0o755 })
    process.env.PATH = [temp, originalPath].filter(Boolean).join(path.delimiter)
    const { runHarnessTurn } = await import('./harness')
    const events: HarnessStreamEvent[] = []
    await runHarnessTurn({
      harnessId: 'codex', command: 'not-a-renderer-specified-executable',
      prompt: 'Edit the scene', script: source, enableMcp: false, enabledSkills: [], workspace,
    }, (event) => events.push(event))
    expect(events).toContainEqual({ type: 'session', sessionId: 'turn-test' })
    expect(events).toContainEqual({ type: 'delta', text: '完成修改\n' })
    expect(events.filter((event) => event.type === 'script_updated')).toEqual([{ type: 'script_updated', content: updated }])
    expect(events.at(-1)).toEqual({ type: 'done', exitCode: 0 })
    expect(await fs.readFile(path.join(workspace, 'current.story'), 'utf8')).toBe(updated)
  } finally {
    if (originalPath == null) delete process.env.PATH
    else process.env.PATH = originalPath
    await fs.rm(temp, { recursive: true, force: true })
  }
})
