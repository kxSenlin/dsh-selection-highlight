/**
 * dsh-selection-highlight — browser half.
 *
 * Two contributions:
 * 1. A document-level selection/highlight engine (no dependency on dsh's
 *    runtime services, so it also works while the app is still booting).
 * 2. One `settings.section` entry owning the feature's settings UI.
 */

import { SelectionHighlightController } from './highlight'
import { createSettingsSectionComponent } from './settings-panel'

interface SlotRegisterOptions {
  name: string
  id: string
  order?: number
  label?: () => string
}

interface SlotsService {
  inject(slot: string, callback: () => () => void): () => void
  register(options: SlotRegisterOptions, component: unknown): () => void
}

interface ClientContext {
  slots: SlotsService
  effect(callback: () => () => void, label: string): void
}

export const name = 'dsh-selection-highlight'

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  const controller = new SelectionHighlightController()

  ctx.effect(() => {
    controller.start()
    return () => { controller.dispose() }
  }, 'selection-highlight: selection engine')

  const Section = createSettingsSectionComponent(controller)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'selection-highlight',
    order: 40,
    label: () => '选区高亮',
  }, Section))
}
