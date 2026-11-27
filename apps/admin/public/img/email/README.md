# Email brand assets

Images for DIP notification emails. Served at `https://letsdip.work/img/email/<file>` (`scripts/build-site.sh` copies `apps/admin/public/img` to the site root).

| File | Pixels | Display size | Fallback `bgcolor` | Alt text |
| --- | --- | --- | --- | --- |
| `logo.png` | 96x96, transparent | 32x32 or 48x48 | none (works on white and `#1B1D24`) | `DIP` |
| `header.png` | 1200x200, transparent | 600x100 | cell `#F2F3FC` light, `#121318` dark | `DIP` |
| `footer.png` | 1200x200, transparent | 600x100 | cell `#F2F3FC` light, `#121318` dark | `""` (decorative) |
| `header-dark.png`, `footer-dark.png` | copies of the above | | | kept only for emails already sent with the old dark swap |

One image per band for every mode: the band colour comes from the table cell (so dark mode and forced inversion recolour it), and the art carries only what reads on both grounds: the clover and a "DIP" wordmark in brand purple (`#7B88FA` mark, `#5A66E6` Fjalla One wordmark), and the mascots centred on a rounded white tile with a hairline (header tile on the right, footer tile centred) so their ink outlines stay legible.

Sources (repo graphics only): Fjalla One (`ui/Packages/DIPDesignSystem/.../Fonts/FjallaOne-Regular.ttf`, OFL), clover `ui/DIP/Resources/AppIcon.icon/Assets/logo.svg` (recoloured `#7B88FA`), theme illustrations `apps/admin/public/img/themes/*.png` (header: learning, games, music; footer: arts, food, wellness).

Regenerate with `scripts/generate-email-assets.sh` (needs `rsvg-convert` and `sips`; sets `PANGOCAIRO_BACKEND=fc` plus a temp fontconfig so the repo font is used). Commit the outputs.

## Idea tiles (`ideas/<theme>.png`)

Used by the admin weekly ideas email (`admin_suggestions`). One per weekly theme: fitness, outdoors, food, arts, games, music, learning, volunteering, wellness. 224x224, flat opaque (no alpha), shown at 112x112 (retina), fallback `bgcolor` = the theme accent from `apps/admin/public/img/themes/ACCENTS.md`, `alt=""` (decorative). Each is the transparent theme art (`apps/admin/public/img/themes/<theme>.png`) scaled to about 80% of the width and centered on the accent. Built by the same `scripts/generate-email-assets.sh` (step 4); commit the outputs. The renderer builds the URL as `EMAIL_ASSET_BASE + "ideas/<theme>.png"`.
