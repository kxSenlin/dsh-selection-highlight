/**
 * dsh-selection-highlight — host half.
 *
 * This feature is a pure browser-side reading aid: it watches
 * `window.getSelection()` and paints CSS Custom Highlight ranges. The host
 * half intentionally does nothing beyond making the package a loadable
 * dual-face plugin row.
 */

export const name = 'dsh-selection-highlight'

/** No host-side behavior. */
export function apply(): void {}
