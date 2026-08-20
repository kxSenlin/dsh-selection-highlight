import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chromium } from 'playwright-core'

const PORT = Number(process.env.DSH_PORT ?? 3109)
const PROFILE = process.env.DSH_PROFILE ?? 'shl-test'
const URL = `http://127.0.0.1:${PORT}`
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'

const server = spawn('dsh', ['--profile', PROFILE, '--no-open', '--port', String(PORT)], {
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: true,
})
let serverLog = ''
server.stdout.on('data', chunk => { serverLog += chunk })
server.stderr.on('data', chunk => { serverLog += chunk })

function killServer() {
  if (server.pid === undefined) return
  if (process.platform === 'win32') {
    // `shell: true` wraps the command in cmd.exe; killing only the wrapper
    // would leak the dsh node process and keep the test port listening.
    spawnSync('taskkill', ['/F', '/T', '/PID', String(server.pid)], { stdio: 'ignore' })
  } else {
    server.kill('SIGTERM')
  }
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(URL)
      if (res.ok) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`server did not start\n${serverLog}`)
}

let browser
try {
  await waitForServer(20000)
  browser = await chromium.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--no-first-run', '--disable-extensions'],
  })
  const page = await browser.newPage()
  page.on('pageerror', error => { console.log('pageerror:', error.message) })
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('console error:', msg.text())
  })

  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)

  // The boot may show onboarding; our synthetic conversation DOM is enough to
  // exercise the engine in the real app.
  await page.evaluate(() => {
    const scroll = document.createElement('div')
    scroll.dataset.conversationScroll = ''
    const flow = document.createElement('div')
    flow.dataset.chatFlow = ''
    flow.innerHTML = '<p>deepseek and deepseek again</p><p>DeepSeek DEEPSEEK</p>'
    scroll.append(flow)
    document.body.append(scroll)
  })

  await page.evaluate(() => {
    const p = document.querySelector('[data-chat-flow] p')
    const range = document.createRange()
    range.setStart(p.firstChild, 0)
    range.setEnd(p.firstChild, 8)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await page.waitForTimeout(400)

  const rangesBefore = await page.evaluate(() => {
    const highlight = CSS.highlights.get('dsh-selection-highlight')
    return highlight === undefined ? -1 : [...highlight].length
  })
  console.log('highlight ranges:', rangesBefore)
  assert.equal(rangesBefore, 3, 'selected occurrence excluded; three other case-insensitive matches')

  const defaultStyle = await page.evaluate(() => document.querySelector('style[data-plugin="dsh-selection-highlight"]')?.textContent ?? '')
  assert.match(defaultStyle, /rgba\(59, 130, 246, 0\.45\)/, 'default highlight color is #3b82f6 at 45%')

  await page.keyboard.press('Escape')
  await page.waitForTimeout(100)
  const cleared = await page.evaluate(() => CSS.highlights.get('dsh-selection-highlight') === undefined)
  assert.equal(cleared, true, 'Escape clears the highlight')

  // Settings section: find and open the settings surface, then look for our row.
  const bodyBefore = await page.evaluate(() => document.body.innerText)
  console.log('has boot failure:', /did not activate|failed/.test(bodyBefore))

  const settingsTrigger = page.getByText('设置', { exact: false }).first()
  let settingsOpened = false
  try {
    await settingsTrigger.click({ timeout: 3000 })
    await page.waitForTimeout(1200)
    const sectionEntry = page.getByText('选区高亮', { exact: true }).first()
    await sectionEntry.click({ timeout: 3000 })
    await page.waitForTimeout(800)

    const colorCount = await page.locator('.shl-color').count()
    const rangeCount = await page.locator('.shl-range').count()
    console.log('color controls:', colorCount, 'range controls:', rangeCount)
    assert.equal(colorCount, 1, 'color picker rendered')
    assert.equal(rangeCount, 1, 'opacity slider rendered')

    await page.locator('.shl-color').evaluate((input) => {
      input.value = '#ff0000'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await page.locator('.shl-range').evaluate((input) => {
      input.value = '0.8'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await page.waitForTimeout(300)
    const adjustedStyle = await page.evaluate(() => document.querySelector('style[data-plugin="dsh-selection-highlight"]')?.textContent ?? '')
    assert.match(adjustedStyle, /rgba\(255, 0, 0, 0\.8\)/, 'color and opacity apply live')
    settingsOpened = true
  } catch (error) {
    console.log('settings open skipped:', error.message.split('\n')[0])
  }

  assert.equal(settingsOpened, true, 'settings section registered and visible')
  console.log('e2e: ok')
} finally {
  await browser?.close().catch(() => {})
  killServer()
}
