import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { compileSources, root } from './build.mjs'

const destination = fs.mkdtempSync(path.join(root, '.temp-test-'))
try {
  compileSources(destination)
  const files = fs.readdirSync(path.join(root, 'tests')).filter(name => name.endsWith('.test.cjs'))
  const result = spawnSync(process.execPath, ['--test', ...files.map(name => path.join(root, 'tests', name))], {
    cwd: root, stdio: 'inherit',
    env: { ...process.env, TZ: 'Asia/Shanghai', BEDTIME_TEST_OUTPUT: destination }
  })
  process.exitCode = result.status ?? 1
} finally {
  fs.rmSync(destination, { recursive: true, force: true })
}
