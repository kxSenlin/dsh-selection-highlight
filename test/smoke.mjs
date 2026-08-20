import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'

const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

function createHarness(html) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, {
    url: 'http://localhost/',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  })
  const { window } = dom

  // CSS Custom Highlight API mock: keep the last registered highlight.
  const state = { deleted: false, lastRanges: [] }
  window.CSS = {}
  window.CSS.highlights = {
    set(name, highlight) {
      state.name = name
      state.deleted = false
      state.lastRanges = highlight.ranges.slice()
    },
    delete(name) {
      state.name = name
      state.deleted = true
    },
  }
  window.Highlight = class Highlight {
    constructor(...ranges) { this.ranges = ranges }
  }

  let factory
  window.__ModuleLoader__ = {
    load({ id, factory: bundleFactory }) {
      if (id !== 'dsh-selection-highlight') throw new Error(`unexpected plugin id ${id}`)
      factory = bundleFactory
    },
  }
  vm.runInContext(bundle, dom.getInternalVMContext(), { filename: 'dsh-selection-highlight.client.js' })
  assert.ok(factory, 'bundle registered its factory')

  const react = {
    createElement: () => ({ $$typeof: Symbol.for('react.element'), type: 'div', props: {} }),
    useEffect: () => {},
    useRef: () => ({ current: null }),
  }
  const plugin = factory((spec) => {
    if (spec === 'react') return react
    throw new Error(`unexpected require(${JSON.stringify(spec)})`)
  })

  const registrations = []
  const ctx = {
    effect(callback) {
      this.cleanup = callback()
    },
    slots: {
      inject(_slot, callback) {
        this.slotCallback = callback
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
  plugin.apply(ctx)
  assert.ok(ctx.cleanup, 'selection engine started and returned cleanup')
  const style = window.document.querySelector('style[data-plugin="dsh-selection-highlight"]')
  assert.ok(style, 'highlight style injected')
  assert.match(style.textContent, /rgba\(59, 130, 246, 0\.45\)/, 'default highlight color and opacity')

  const selectText = (element, start, end) => {
    const text = element.firstChild
    const selection = window.getSelection()
    selection.removeAllRanges()
    const range = window.document.createRange()
    range.setStart(text, start)
    range.setEnd(text, end)
    selection.addRange(range)
    window.document.dispatchEvent(new window.Event('selectionchange'))
  }

  return { window, dom, state, ctx, registrations, selectText }
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

// Case 1: same-text occurrences outside the selection are highlighted.
{
  const { window, dom, state, selectText } = createHarness(
    '<div data-conversation-scroll><div data-chat-flow><p>deepseek and deepseek again</p></div></div>',
  )
  const p = window.document.querySelector('p')
  selectText(p, 0, 8)
  await wait(120)
  assert.equal(state.name, 'dsh-selection-highlight')
  assert.equal(state.deleted, false)
  assert.equal(state.lastRanges.length, 1, 'one matching occurrence besides the selection')
  assert.equal(state.lastRanges[0].toString(), 'deepseek')

  // Escape clears.
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))
  assert.equal(state.deleted, true)
  dom.window.close()
}

// Case 2: ignore-case is on by default.
{
  const { window, dom, state, selectText } = createHarness(
    '<div data-conversation-scroll><div data-chat-flow><p>DeepSeek deepseek DEEPSEEK</p></div></div>',
  )
  const p = window.document.querySelector('p')
  selectText(p, 0, 8)
  await wait(120)
  assert.equal(state.lastRanges.length, 2, 'two case-insensitive matches besides the selection')

  // Collapsing the selection clears.
  window.getSelection().removeAllRanges()
  window.document.dispatchEvent(new window.Event('selectionchange'))
  await wait(120)
  assert.equal(state.deleted, true)
  dom.window.close()
}

// Case 3: textarea is never scanned and never triggers.
{
  const { window, dom, state, selectText } = createHarness(
    '<div data-conversation-scroll><div data-chat-flow><p>deepseek</p></div></div><textarea>deepseek deepseek</textarea>',
  )
  const p = window.document.querySelector('p')
  selectText(p, 0, 8)
  await wait(120)
  assert.equal(state.lastRanges.length, 0, 'textarea text is excluded from the scan')
  dom.window.close()
}

console.log('smoke: ok')
