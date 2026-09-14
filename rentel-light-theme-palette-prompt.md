# Prompt: Rentel Light Theme Color Palette

Apply this color palette for the light theme of the Rentel website/app — a premium navy-and-gold real-estate/rental brand on a warm cream background. Navy leads as the primary interactive color; gold is reserved for accents and highlights.

| Token | Hex | Usage |
|---|---|---|
| Background | `#FAF8F4` | Page background (warm cream, not pure white) |
| Background secondary | `#F1ECDF` | Section backgrounds, subtle panel fills |
| Text | `#1C1C1E` | Primary body text (charcoal) |
| Text muted | `#6B7280` | Secondary/muted text, placeholders |
| Border | `#E4E0D6` | Borders, dividers (warm-toned, not cool gray) |
| Primary | `#14213D` | Primary buttons, nav background, headings, links (deep navy) |
| Primary hover | `#0B152B` | Hover/active state on primary elements |
| Primary light | `#E9E4D8` | Light tint of primary for subtle backgrounds |
| Accent | `#D4AF37` | Badges, highlights, verified marks, active underline (gold) |
| Accent hover | `#B8952C` | Hover state on accent elements |
| Success | `#2F9E68` | Success states, confirmations |
| Danger | `#D64545` | Errors, warnings, destructive actions |

## Implementation notes
- Reserve gold for accents, icons, badges, and short highlighted text — avoid large blocks of body text or long button labels in gold, since gold-on-cream has weaker contrast than navy-on-cream.
- Define these as CSS custom properties in `:root` so components reference `var(--primary)`, `var(--bg)`, etc. rather than hardcoded hex values, to support theme switching.

```css
:root {
  --bg: #FAF8F4;
  --bg-secondary: #F1ECDF;
  --text: #1C1C1E;
  --text-muted: #6B7280;
  --border: #E4E0D6;
  --primary: #14213D;
  --primary-hover: #0B152B;
  --primary-light: #E9E4D8;
  --accent: #D4AF37;
  --accent-hover: #B8952C;
  --success: #2F9E68;
  --danger: #D64545;
}
```
