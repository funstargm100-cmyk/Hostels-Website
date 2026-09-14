# Prompt: Rentel Dark Theme Color Palette

Apply this color palette for the dark theme of the Rentel website/app — a premium navy-and-gold real-estate/rental brand on a near-black navy background. Gold leads as the primary interactive color in dark mode (navy would have too little contrast to function as the primary color against a near-black background); navy shifts to a secondary/structural accent role.

| Token | Hex | Usage |
|---|---|---|
| Background | `#0B0F1A` | Page background (near-black navy) |
| Background secondary | `#131829` | Section backgrounds, card fills |
| Text | `#F5F3EC` | Primary body text (warm off-white) |
| Text muted | `#9099AE` | Secondary/muted text, placeholders |
| Border | `#232B42` | Borders, dividers |
| Primary | `#D4AF37` | Primary buttons, active states (gold leads in dark mode) |
| Primary hover | `#E8C563` | Hover state — lighter gold, since darkening reduces visibility on dark backgrounds |
| Primary light | `#2A2413` | Dark tint for subtle primary-colored backgrounds |
| Accent | `#3B4A6B` | Secondary buttons, tags, subtle structural accents (muted navy-blue) |
| Accent hover | `#4C5F87` | Hover state on accent elements |
| Success | `#34B679` | Success states, confirmations (brightened for dark-background legibility) |
| Danger | `#E5573F` | Errors, warnings, destructive actions (brightened for dark-background legibility) |

## Implementation notes
- Gold accent letters/highlights carried over from the light theme stay gold here too — it's the one color that reads clearly against both a cream and a near-black background.
- `--success` and `--danger` are intentionally brighter than their light-theme counterparts — the light-theme values would look muddy and low-contrast against a near-black background.
- Any logo or icon assets using hardcoded colors (not CSS variables) need a separate dark-mode export, since text/shapes that were navy-on-cream typically need to become cream-on-navy for readability.

```css
[data-theme="dark"] {
  --bg: #0B0F1A;
  --bg-secondary: #131829;
  --text: #F5F3EC;
  --text-muted: #9099AE;
  --border: #232B42;
  --primary: #D4AF37;
  --primary-hover: #E8C563;
  --primary-light: #2A2413;
  --accent: #3B4A6B;
  --accent-hover: #4C5F87;
  --success: #34B679;
  --danger: #E5573F;
}
```
