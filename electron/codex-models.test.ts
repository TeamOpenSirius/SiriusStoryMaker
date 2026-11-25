import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { listCodexModels } from './codex-models'

it.skipIf(process.platform === 'win32')('queries and paginates the installed Codex protocol without an embedded model list', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sirius-codex-catalog-'))
  const executable = path.join(dir, 'codex-fixture')
  try {
    await fs.writeFile(executable, `#!/usr/bin/env node
const { createInterface } = require('node:readline');
let initialized = false;
const send = (id, result) => console.log(JSON.stringify({id, result}));
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') return send(request.id, {});
  if (request.method === 'initialized') { initialized = true; return; }
  if (request.method !== 'model/list' || !initialized) process.exit(2);
  if (request.params.cursor === 'next') return send(request.id, { data: [{ id: 'another-model' }] });
  send(request.id, { nextCursor: 'next', data: [
    { model: 'catalog-test', displayName: 'Catalog model', supportedReasoningEfforts: [{ reasoningEffort: 'super' }] },
    { id: 'not-public', hidden: true },
  ] });
});\n`, { mode: 0o755 })
    expect(await listCodexModels(executable, dir)).toEqual([
      { id: 'catalog-test', label: 'Catalog model', efforts: ['super'] },
      { id: 'another-model', label: 'another-model' },
    ])
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
