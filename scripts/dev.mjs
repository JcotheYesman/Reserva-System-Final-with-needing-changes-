import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

function loadLocalEnvironment() {
  const envPath = join(projectRoot, '.env')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!match || match[2].startsWith('#') || process.env[match[1]] !== undefined) continue
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2')
    process.env[match[1]] = value
  }
}

loadLocalEnvironment()

const apiUrl = 'http://127.0.0.1:8000/api/index.php?action=facilities.list'
const isWindows = process.platform === 'win32'
const viteCli = join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js')
const sessionPath = process.env.PHP_SESSION_PATH || join(tmpdir(), 'reserva-php-sessions')

function findPhp() {
  const candidates = [
    process.env.PHP_PATH,
    ...(isWindows ? ['C:\\xampp\\php\\php.exe', 'C:\\php\\php.exe'] : ['php']),
  ].filter(Boolean)

  for (const candidate of candidates) {
    if ((candidate.includes('/') || candidate.includes('\\')) && !existsSync(candidate)) continue
    const result = spawnSync(candidate, ['-v'], { stdio: 'ignore', windowsHide: true })
    if (result.status === 0) return candidate
  }
  return null
}

function portIsAvailable(port) {
  return new Promise((resolvePort) => {
    const server = createServer()
    server.once('error', () => resolvePort(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolvePort(true)))
  })
}

async function waitForApi(phpProcess) {
  let lastError = 'The PHP API did not respond.'
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (phpProcess?.exitCode !== null && phpProcess?.exitCode !== undefined) {
      throw new Error('The PHP server exited before the API became ready.')
    }
    try {
      const response = await fetch(apiUrl, { signal: AbortSignal.timeout(1000) })
      if (response.ok) return
      lastError = `The PHP API returned HTTP ${response.status}. Check the database settings and backend_extensions migration.`
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError
    }
    await delay(250)
  }
  throw new Error(lastError)
}

const phpPath = findPhp()
if (!phpPath) {
  console.error('[reserva] PHP CLI was not found. Install PHP or set PHP_PATH to your php.exe, then run npm run dev again.')
  process.exit(1)
}

if (!existsSync(viteCli)) {
  console.error('[reserva] Vite is not installed. Run npm install first.')
  process.exit(1)
}

let phpProcess = null
let viteProcess = null
let usingExistingApi = false
let stopping = false

function stopChildren(exitCode = 0) {
  if (stopping) return
  stopping = true
  if (viteProcess && viteProcess.exitCode === null) viteProcess.kill()
  if (!usingExistingApi && phpProcess && phpProcess.exitCode === null) phpProcess.kill()
  process.exitCode = exitCode
}

process.once('SIGINT', () => stopChildren(0))
process.once('SIGTERM', () => stopChildren(0))

try {
  mkdirSync(sessionPath, { recursive: true })
  if (await portIsAvailable(8000)) {
    phpProcess = spawn(phpPath, ['-S', '127.0.0.1:8000', '-t', projectRoot], {
      cwd: projectRoot,
      env: { ...process.env, PHP_SESSION_PATH: sessionPath },
      stdio: 'inherit',
      windowsHide: true,
    })
    phpProcess.once('error', (error) => {
      console.error(`[reserva] Could not start PHP: ${error.message}`)
      stopChildren(1)
    })
    phpProcess.once('exit', (code) => {
      if (!stopping) {
        console.error(`[reserva] PHP exited with code ${code ?? 'unknown'}.`)
        stopChildren(1)
      }
    })
    console.log('[reserva] Starting PHP API on http://127.0.0.1:8000')
  } else {
    usingExistingApi = true
    console.log('[reserva] Port 8000 is occupied; checking the existing API.')
  }

  await waitForApi(phpProcess)
  if (stopping) process.exit(process.exitCode ?? 1)
  console.log('[reserva] API and database are ready.')

  viteProcess = spawn(process.execPath, [viteCli, '--host', 'localhost', ...process.argv.slice(2)], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  })
  viteProcess.once('error', (error) => {
    console.error(`[reserva] Could not start Vite: ${error.message}`)
    stopChildren(1)
  })
  viteProcess.once('exit', (code) => stopChildren(code ?? 0))
} catch (error) {
  console.error(`[reserva] ${error instanceof Error ? error.message : 'Could not start the local app.'}`)
  stopChildren(1)
}
