# Email brand assets

Images for DIP notification emails. Served at `https://letsdip.work/img/email/<file>` (`scripts/build-site.sh` copies `apps/admin/public/img` to the site root).

| File | Pixels | Display size | Fallback `bgcolor` | Alt text |
| --- | --- | --- | --- | --- |
| `logo.png` | 96x96, transparent | 32x32 or 48x48 | none (works on white and `#1B1D24`) | `DIP` |
| `header.png` | 1200x200, opaque | 600x100 | `#F2F3FC` (flat) | `DIP` |
| `footer.png` | 1200x200, opaque | 600x100 | `#F2F3FC` (flat) | `""` (decorative) |
| `header-dark.png` | 1200x200, opaque | 600x100 | `#23252E` (flat) | `DIP` |
| `footer-dark.png` | 1200x200, opaque | 600x100 | `#23252E` (flat) | `""` (decorative) |

The `-dark` variants (wordmark `#ECEDEF`, clouds `#2E313B`) keep the mascots on a light `#E8EAF8` panel so their ink outlines stay legible; swap them in with `prefers-color-scheme: dark`. All four edges of every header/footer PNG are exactly the fallback colour (verified by pixel check). Header and footer are fully opaque; the header has the clover mark and a "DIP" wordmark (Fjalla One, ink `#1E212B`) baked in at the left, with mascots and clouds on the right.

Sources (repo graphics only): Fjalla One (`ui/Packages/DIPDesignSystem/.../Fonts/FjallaOne-Regular.ttf`, OFL), clover `ui/DIP/Resources/AppIcon.icon/Assets/logo.svg` (recoloured `#7B88FA`), theme illustrations `apps/admin/public/img/themes/*.png` (header: learning, games, music; footer: arts, food, wellness).

Regenerate with `scripts/generate-email-assets.sh` (needs `rsvg-convert` and `sips`; sets `PANGOCAIRO_BACKEND=fc` plus a temp fontconfig so the repo font is used). Commit the outputs.

## Idea tiles (`ideas/<theme>.png`)

Used by the admin weekly ideas email (`admin_suggestions`). One per weekly theme: fitness, outdoors, food, arts, games, music, learning, volunteering, wellness. 224x224, flat opaque (no alpha), shown at 112x112 (retina), fallback `bgcolor` = the theme accent from `apps/admin/public/img/themes/ACCENTS.md`, `alt=""` (decorative). Each is the transparent theme art (`apps/admin/public/img/themes/<theme>.png`) scaled to about 80% of the width and centered on the accent. Built by the same `scripts/generate-email-assets.sh` (step 4); commit the outputs. The renderer builds the URL as `EMAIL_ASSET_BASE + "ideas/<theme>.png"`.
