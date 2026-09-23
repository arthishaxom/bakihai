import { expect, test } from '@playwright/test'
import { createGroup, openAddSheet } from './helpers'

/**
 * The rough perceptual lightness (0..1) of a computed CSS color, accepting the
 * serializations a browser may hand back: rgb()/rgba(), oklch(), color(srgb),
 * or hsl(). Only used to order text against its panel, never as a real WCAG
 * ratio — oklch lightness is perceptual enough for that comparison.
 */
function lightness(cssColor: string): number {
  let match = cssColor.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i)

  if (match) {
    return (0.2126 * Number(match[1]) + 0.7152 * Number(match[2]) + 0.0722 * Number(match[3])) / 255
  }

  match = cssColor.match(/oklch\(\s*([\d.]+)(%?)/i)

  if (match) {
    return match[2] === '%' ? Number(match[1]) / 100 : Math.min(1, Number(match[1]))
  }

  match = cssColor.match(/color\(srgb\s+([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i)

  if (match) {
    return 0.2126 * Number(match[1]) + 0.7152 * Number(match[2]) + 0.0722 * Number(match[3])
  }

  match = cssColor.match(/hsl\(\s*[\d.]+(?:deg)?[\s,]+[\d.]+%[\s,]+([\d.]+)%/i)

  if (match) {
    return Number(match[1]) / 100
  }

  throw new Error(`Unrecognized computed color: ${cssColor}`)
}

/**
 * Regression for #28: in dark mode every bottom sheet once rendered near-black
 * UA text (`dialog { color: CanvasText }` with no `color-scheme` declared) on
 * the dark `bg-background` panel. The sheet's text must sit on the opposite end
 * of the lightness scale from its panel in both schemes, and the root must
 * declare both schemes so placeholders, selects, and scrollbars follow the OS.
 */
for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`color scheme: ${colorScheme}`, () => {
    test.use({ colorScheme })

    test(`bottom-sheet text contrasts its panel (${colorScheme})`, async ({ page }) => {
      await createGroup(page, 'Contrast group', 'Ada')

      const sheet = await openAddSheet(page)
      const { color, background, rootScheme } = await sheet.evaluate((dialog) => {
        const panel = dialog.querySelector<HTMLElement>('[data-testid="add-sheet-panel"]')

        if (!panel) throw new Error('sheet panel not found')

        return {
          color: getComputedStyle(dialog).color,
          background: getComputedStyle(panel).backgroundColor,
          rootScheme: getComputedStyle(document.documentElement).colorScheme,
        }
      })

      expect(rootScheme).toBe('light dark')

      const text = lightness(color)
      const panel = lightness(background)
      const gap = colorScheme === 'dark' ? text - panel : panel - text

      expect(gap, `text ${color} on panel ${background} in ${colorScheme} mode`).toBeGreaterThan(
        0.3,
      )
    })
  })
}
