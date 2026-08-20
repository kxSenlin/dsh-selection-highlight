/**
 * Settings section: a small self-contained panel registered into dsh's
 * `settings.section` list slot. React is only a mount point; the panel body
 * is plain DOM so the plugin bundle stays independent of dsh's UI packages.
 */

import { createElement, useEffect, useRef } from 'react'
import {
  DEFAULT_SCOPE_SELECTOR,
  SelectionHighlightController,
  isHighlightSupported,
} from './highlight'

const PANEL_CSS = `
.shl-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 4px;
  max-width: 760px;
  font-size: 13px;
  color: var(--dsw-alias-label-primary, #e5e7eb);
}
.shl-panel h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.shl-subtitle {
  margin: -8px 0 0;
  color: var(--dsw-alias-label-secondary, #9ca3af);
  line-height: 1.6;
}
.shl-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(148, 163, 184, 0.22));
  border-radius: 8px;
  background: var(--dsw-alias-bg-module-platform, rgba(148, 163, 184, 0.04));
}
.shl-row .meta {
  min-width: 0;
}
.shl-row .title {
  font-weight: 600;
}
.shl-row .desc {
  margin-top: 2px;
  color: var(--dsw-alias-label-secondary, #9ca3af);
  line-height: 1.5;
}
.shl-control {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
}
.shl-check {
  width: 16px;
  height: 16px;
  accent-color: rgb(59, 130, 246);
  cursor: pointer;
}
.shl-number {
  width: 76px;
  padding: 6px 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(148, 163, 184, 0.28));
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary, #e5e7eb);
  font: inherit;
}
.shl-selector {
  width: min(360px, 42vw);
  padding: 6px 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(148, 163, 184, 0.28));
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary, #e5e7eb);
  font: 12px ui-monospace, 'Cascadia Code', Consolas, monospace;
}
.shl-btn {
  flex: none;
  padding: 6px 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(148, 163, 184, 0.28));
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary, #e5e7eb);
  cursor: pointer;
  font: inherit;
}
.shl-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(148, 163, 184, 0.12));
}
.shl-status {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px dashed var(--dsw-alias-border-l2, rgba(148, 163, 184, 0.22));
  color: var(--dsw-alias-label-secondary, #9ca3af);
  line-height: 1.7;
}
.shl-status b {
  color: var(--dsw-alias-label-primary, #e5e7eb);
  font-weight: 600;
}
`

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className !== undefined) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function makeRow(
  title: string,
  description: string,
  control: HTMLElement,
): HTMLDivElement {
  const row = el('div', 'shl-row')
  const meta = el('div', 'meta')
  meta.append(el('div', 'title', title), el('div', 'desc', description))
  row.append(meta, control)
  return row
}

function checkboxRow(
  title: string,
  description: string,
  checked: boolean,
  onChange: (checked: boolean) => void,
): HTMLDivElement {
  const input = el('input', 'shl-check')
  input.type = 'checkbox'
  input.checked = checked
  input.addEventListener('change', () => { onChange(input.checked) })
  return makeRow(title, description, input)
}

export interface SettingsPanel {
  root: HTMLElement
  dispose: () => void
}

export function createSettingsPanel(controller: SelectionHighlightController): SettingsPanel {
  const settings = controller.getSettings()
  const root = el('div', 'shl-panel')
  const style = el('style')
  style.textContent = PANEL_CSS

  root.append(style, el('h3', undefined, '选区高亮'), el(
    'p',
    'shl-subtitle',
    '双击或拖选对话中的文本后，对话区域内相同的文本片段会以低一级背景淡高亮。按 Esc、点击空白处或切换会话即清除。',
  ))

  const status = el('p', 'shl-status')

  const enabledRow = checkboxRow(
    '启用文本高亮',
    '关闭后立即清除当前高亮，且不再响应新的选区。',
    settings.enabled,
    checked => { controller.setSettings({ enabled: checked }) },
  )

  const ignoreCaseRow = checkboxRow(
    '忽略大小写',
    '开启后 deepseek 与 DeepSeek 视为同一片段。',
    settings.ignoreCase,
    checked => { controller.setSettings({ ignoreCase: checked }) },
  )

  const minLengthInput = el('input', 'shl-number')
  minLengthInput.type = 'number'
  minLengthInput.min = '1'
  minLengthInput.max = '64'
  minLengthInput.value = String(settings.minLength)
  minLengthInput.addEventListener('change', () => {
    const value = Number.parseInt(minLengthInput.value, 10)
    if (Number.isFinite(value)) controller.setSettings({ minLength: value })
    else minLengthInput.value = String(controller.getSettings().minLength)
  })
  const minLengthRow = makeRow(
    '最少字符数',
    '短于该长度的选中内容不触发高亮，默认 4。',
    minLengthInput,
  )

  const selectorInput = el('input', 'shl-selector')
  selectorInput.type = 'text'
  selectorInput.value = settings.scopeSelector
  selectorInput.placeholder = DEFAULT_SCOPE_SELECTOR
  selectorInput.spellcheck = false
  selectorInput.addEventListener('change', () => {
    const value = selectorInput.value.trim() || DEFAULT_SCOPE_SELECTOR
    selectorInput.value = value
    controller.setSettings({ scopeSelector: value })
    refreshStatus()
  })
  const resetButton = el('button', 'shl-btn', '恢复默认')
  resetButton.type = 'button'
  resetButton.addEventListener('click', () => {
    controller.setSettings({
      enabled: true,
      ignoreCase: true,
      minLength: 4,
      scopeSelector: DEFAULT_SCOPE_SELECTOR,
    })
    enabledRow.querySelector('input')!.checked = true
    ignoreCaseRow.querySelector('input')!.checked = true
    minLengthInput.value = '4'
    selectorInput.value = DEFAULT_SCOPE_SELECTOR
    refreshStatus()
  })
  const selectorControl = el('div', 'shl-control')
  selectorControl.append(selectorInput, resetButton)
  const selectorRow = makeRow(
    '对话区域 CSS 选择器',
    'dsh 改版后可手动指定消息容器。默认值对应当前会话列的消息流。',
    selectorControl,
  )

  const refreshStatus = (): void => {
    const supported = isHighlightSupported()
    const selector = selectorInput.value.trim() || DEFAULT_SCOPE_SELECTOR
    let scopeCount = -1
    try {
      scopeCount = document.querySelectorAll(selector).length
    } catch {
      scopeCount = -1
    }
    status.replaceChildren()
    status.append(
      el('b', undefined, supported ? '引擎可用' : '引擎不可用'),
      document.createTextNode(supported
        ? '（CSS Custom Highlight API；不改动页面 DOM，不会干扰 React 渲染）。'
        : '（当前浏览器缺少 CSS Custom Highlight API，建议使用最新版 Edge/WebView2）。'),
      document.createTextNode(' 目标范围：'),
      el('b', undefined, scopeCount < 0 ? '选择器无效' : `${scopeCount} 个容器`),
      document.createTextNode('。'),
    )
  }

  root.append(enabledRow, ignoreCaseRow, minLengthRow, selectorRow, status)
  refreshStatus()

  return {
    root,
    dispose: () => {
      root.remove()
    },
  }
}

export function createSettingsSectionComponent(controller: SelectionHighlightController) {
  return function SelectionHighlightSection() {
    const hostRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
      const host = hostRef.current
      if (host === null) return undefined
      const panel = createSettingsPanel(controller)
      host.append(panel.root)
      return panel.dispose
    }, [])

    return createElement('div', { ref: hostRef })
  }
}
