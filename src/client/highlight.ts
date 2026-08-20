/**
 * Selection Highlight engine (browser half).
 *
 * Design:
 * - Read the active browser selection on `selectionchange` (debounced).
 * - Validate the selected text (trim, length window, no newlines, outside
 *   editing surfaces).
 * - Scan text nodes inside the configured conversation scope with a
 *   TreeWalker and collect matching substrings as DOM Ranges.
 * - Paint those ranges through the CSS Custom Highlight API
 *   (`::highlight(dsh-selection-highlight)`), which never touches React's DOM
 *   and therefore cannot disturb dsh's renderer.
 * - Clear on Escape, collapsed selection, window blur, or DOM mutation; a
 *   mutation while a highlight is visible schedules one debounced rebuild.
 */

export interface HighlightSettings {
  enabled: boolean
  ignoreCase: boolean
  minLength: number
  scopeSelector: string
}

export const DEFAULT_SCOPE_SELECTOR = '[data-conversation-scroll] [data-chat-flow]'

export const DEFAULT_SETTINGS: HighlightSettings = {
  enabled: true,
  ignoreCase: true,
  minLength: 4,
  scopeSelector: DEFAULT_SCOPE_SELECTOR,
}

const SETTINGS_STORAGE_KEY = 'dsh.selection-highlight.settings.v1'
const HIGHLIGHT_NAME = 'dsh-selection-highlight'
const MAX_SELECTION_LENGTH = 128
const MAX_RANGES = 2000
const MIN_LENGTH_MIN = 1
const MIN_LENGTH_MAX = 64

/** Selection must never start inside these editing surfaces. */
const SELECTION_EXCLUDED = 'input, textarea, [contenteditable="true"], [contenteditable=""]'

/** Text nodes inside these surfaces never become highlight targets. */
const SCAN_EXCLUDED = [
  'input',
  'textarea',
  '[contenteditable="true"]',
  '[contenteditable=""]',
  '[data-composer-seat]',
  '[data-streaming]',
  '[data-selection-highlight-ignore]',
].join(', ')

interface HighlightRegistryLike {
  set(name: string, highlight: unknown): void
  delete(name: string): void
}

interface HighlightConstructorLike {
  new (...ranges: Range[]): unknown
}

function clampMinLength(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(MIN_LENGTH_MAX, Math.max(MIN_LENGTH_MIN, Math.round(value)))
  }
  return DEFAULT_SETTINGS.minLength
}

/** Merge untrusted stored values into a complete, valid settings object. */
export function normalizeSettings(partial: Partial<HighlightSettings> | undefined): HighlightSettings {
  const raw = partial ?? {}
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_SETTINGS.enabled,
    ignoreCase: typeof raw.ignoreCase === 'boolean' ? raw.ignoreCase : DEFAULT_SETTINGS.ignoreCase,
    minLength: clampMinLength(raw.minLength),
    scopeSelector: typeof raw.scopeSelector === 'string' && raw.scopeSelector.trim() !== ''
      ? raw.scopeSelector.trim()
      : DEFAULT_SCOPE_SELECTOR,
  }
}

export function loadSettings(): HighlightSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (stored === null) return { ...DEFAULT_SETTINGS }
    return normalizeSettings(JSON.parse(stored) as Partial<HighlightSettings>)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: HighlightSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage can be unavailable (privacy mode, remote browser policy); the
    // feature then simply keeps the in-memory settings for this page load.
  }
}

function highlightRegistry(): HighlightRegistryLike | null {
  if (typeof CSS === 'undefined') return null
  return (CSS as unknown as { highlights?: HighlightRegistryLike }).highlights ?? null
}

function createHighlight(ranges: Range[]): unknown | null {
  const HighlightCtor = (globalThis as unknown as { Highlight?: HighlightConstructorLike }).Highlight
  if (HighlightCtor === undefined) return null
  try {
    return new HighlightCtor(...ranges)
  } catch {
    return null
  }
}

let highlightSupport: boolean | undefined

export function isHighlightSupported(): boolean {
  highlightSupport ??= highlightRegistry() !== null && createHighlight([]) !== null
  return highlightSupport
}

function rangesOverlap(a: Range, b: Range): boolean {
  // Both ranges produced by this engine are single-text-node ranges, so the
  // fast path is exact and avoids relying on cross-implementation
  // compareBoundaryPoints quirks (jsdom, old WebKit). Mixed-node selection
  // ranges fall back to the standard comparison.
  if (a.startContainer === a.endContainer
    && b.startContainer === b.endContainer
    && a.startContainer === b.startContainer) {
    return a.startOffset < b.endOffset && a.endOffset > b.startOffset
  }
  const aEndsBeforeBStarts = a.compareBoundaryPoints(Range.END_TO_START, b) <= 0
  const aStartsAfterBEnds = a.compareBoundaryPoints(Range.START_TO_END, b) >= 0
  return !aEndsBeforeBStarts && !aStartsAfterBEnds
}

function elementOf(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
}

interface ActiveSelection {
  text: string
  selectionRange: Range
  scope: HTMLElement
}

export class SelectionHighlightController {
  private settings: HighlightSettings
  private timer: number | undefined
  private observer: MutationObserver | undefined
  private showing = false
  private readonly subscribers = new Set<() => void>()

  constructor() {
    this.settings = loadSettings()
  }

  getSettings(): HighlightSettings {
    return { ...this.settings }
  }

  setSettings(patch: Partial<HighlightSettings>): void {
    this.settings = normalizeSettings({ ...this.settings, ...patch })
    saveSettings(this.settings)
    if (!this.settings.enabled) this.clearHighlights()
    for (const listener of this.subscribers) listener()
    this.schedule(60)
  }

  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener)
    return () => { this.subscribers.delete(listener) }
  }

  start(): void {
    document.addEventListener('selectionchange', this.handleSelectionChange, true)
    document.addEventListener('keydown', this.handleKeyDown, true)
    if (typeof MutationObserver !== 'undefined') {
      this.observer = new MutationObserver(this.handleMutation)
      this.observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
      })
    }
    ensureHighlightStyle()
  }

  dispose(): void {
    document.removeEventListener('selectionchange', this.handleSelectionChange, true)
    document.removeEventListener('keydown', this.handleKeyDown, true)
    this.observer?.disconnect()
    this.observer = undefined
    if (this.timer !== undefined) {
      window.clearTimeout(this.timer)
      this.timer = undefined
    }
    this.clearHighlights()
    removeHighlightStyle()
  }

  private readonly handleSelectionChange = (): void => {
    this.schedule(60)
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.clearHighlights()
  }

  private readonly handleMutation = (): void => {
    // CSS Custom Highlight ranges become detached as React replaces text
    // nodes (streaming, paging, session switch). Drop them and, if the
    // selection may still be valid, rebuild once the dust settles.
    if (!this.showing) return
    this.clearHighlights()
    this.schedule(200)
  }

  private schedule(delay: number): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => {
      this.timer = undefined
      this.reconcile()
    }, delay)
  }

  private reconcile(): void {
    this.clearHighlights()
    if (!this.settings.enabled || !isHighlightSupported()) return
    const selection = this.readSelection()
    if (selection === null) return
    const ranges = this.collectRanges(selection)
    if (ranges.length === 0) return
    const registry = highlightRegistry()
    const highlight = registry === null ? null : createHighlight(ranges)
    if (registry === null || highlight === null) return
    try {
      registry.set(HIGHLIGHT_NAME, highlight)
      this.showing = true
    } catch {
      this.showing = false
    }
  }

  private readSelection(): ActiveSelection | null {
    const selection = window.getSelection()
    if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null
    const selectionRange = selection.getRangeAt(0)
    const rawText = selection.toString()
    const text = rawText.trim()
    if (text.length < this.settings.minLength || text.length > MAX_SELECTION_LENGTH) return null
    if (/[\r\n]/.test(text)) return null
    if (this.isInsideExcluded(selectionRange.startContainer)
      || this.isInsideExcluded(selectionRange.endContainer)) {
      return null
    }
    const scope = this.resolveScopeForNode(selectionRange.commonAncestorContainer)
    if (scope === null) return null
    return { text, selectionRange, scope }
  }

  private resolveScopeForNode(node: Node): HTMLElement | null {
    const element = elementOf(node)
    if (element === null) return null
    let roots: NodeListOf<HTMLElement>
    try {
      roots = document.querySelectorAll<HTMLElement>(this.settings.scopeSelector)
    } catch {
      return null
    }
    for (const root of roots) {
      if (root.isConnected && root.contains(element)) return root
    }
    return null
  }

  private isInsideExcluded(node: Node): boolean {
    const element = elementOf(node)
    return element !== null && element.closest(SELECTION_EXCLUDED) !== null
  }

  private collectRanges(selection: ActiveSelection): Range[] {
    const ranges: Range[] = []
    const foldedNeedle = selection.text.toLowerCase()
    const needle = this.settings.ignoreCase && foldedNeedle.length === selection.text.length
      ? foldedNeedle
      : selection.text
    if (needle.length === 0) return ranges

    const walker = document.createTreeWalker(selection.scope, NodeFilter.SHOW_TEXT, {
      acceptNode: (node: Node): number => {
        const text = node.nodeValue ?? ''
        if (text.length === 0) return NodeFilter.FILTER_REJECT
        const parent = elementOf(node)
        if (parent === null) return NodeFilter.FILTER_REJECT
        if (parent.closest(SCAN_EXCLUDED) !== null) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      },
    })

    let node: Node | null
    while ((node = walker.nextNode()) !== null && ranges.length < MAX_RANGES) {
      const text = node.nodeValue ?? ''
      const foldedText = text.toLowerCase()
      const haystack = this.settings.ignoreCase && foldedText.length === text.length
        ? foldedText
        : text
      let from = 0
      while (from < text.length && ranges.length < MAX_RANGES) {
        const index = haystack.indexOf(needle, from)
        if (index < 0) break
        const range = document.createRange()
        range.setStart(node, index)
        range.setEnd(node, index + needle.length)
        if (!rangesOverlap(range, selection.selectionRange)) ranges.push(range)
        from = index + needle.length
      }
    }
    return ranges
  }

  private clearHighlights(): void {
    if (this.showing) {
      highlightRegistry()?.delete(HIGHLIGHT_NAME)
      this.showing = false
    }
  }
}

let highlightStyleElement: HTMLStyleElement | null = null

const HIGHLIGHT_STYLE = [
  '::highlight(dsh-selection-highlight) {',
  '  background-color: rgba(96, 165, 250, 0.26);',
  '  border-radius: 2px;',
  '}',
].join('\n')

function ensureHighlightStyle(): void {
  if (highlightStyleElement !== null && highlightStyleElement.isConnected) return
  highlightStyleElement = document.createElement('style')
  highlightStyleElement.setAttribute('data-plugin', 'dsh-selection-highlight')
  highlightStyleElement.textContent = HIGHLIGHT_STYLE
  document.head.append(highlightStyleElement)
}

function removeHighlightStyle(): void {
  highlightStyleElement?.remove()
  highlightStyleElement = null
}
