#!/usr/bin/env python3
"""Build the web share images and favicons.

Writes (all committed, regenerate with `python3 scripts/make-og-images.py`):
  apps/landing/img/og.jpg                   1200x630 share card for https://letsdip.work/
  apps/admin/public/img/og-admin.jpg        1200x630 share card for https://letsdip.work/admin/
  apps/landing/img/favicon-32.png, apple-touch-icon.png, icon-192.png, icon-512.png
  apps/admin/public/img/admin/ favicon-32.png, apple-touch-icon.png, icon-192.png, icon-512.png

Needs Pillow (with WebP) and numpy-free rsvg-convert for the favicons (skipped with a note if missing).
Brand colours: purple #7B88FA, pink #FB72E4, ink #1E212B, yellow #FFCC3E. Fonts come from the app bundle
(Fjalla One, Figtree). Everything is drawn at 2x and downsampled for clean edges.
"""
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "ui/Packages/DIPDesignSystem/Sources/DIPDesignSystem/Resources/Fonts"
LANDING = ROOT / "apps/landing/img"
ADMIN_PUBLIC = ROOT / "apps/admin/public/img"
AVATARS = ADMIN_PUBLIC / "avatars"

PURPLE, PINK, INK, YELLOW, WHITE = "#7B88FA", "#FB72E4", "#1E212B", "#FFCC3E", "#FFFFFF"
W, H, S = 1200, 630, 2  # output size and supersampling factor


def fjalla(px: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / "FjallaOne-Regular.ttf"), px * S)


def figtree(px: int, weight: str = "Regular") -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(str(FONTS / "Figtree[wght].ttf"), px * S)
    f.set_variation_by_name(weight)
    return f


def canvas(bg: str) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    im = Image.new("RGB", (W * S, H * S), bg)
    return im, ImageDraw.Draw(im)


def circle(d: ImageDraw.ImageDraw, cx, cy, r, fill=None, outline=None, width=0) -> None:
    d.ellipse(((cx - r) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S), fill=fill, outline=outline, width=width * S)


def rrect(d: ImageDraw.ImageDraw, box, r, fill=None, outline=None, width=0) -> None:
    d.rounded_rectangle([v * S for v in box], radius=r * S, fill=fill, outline=outline, width=width * S)


def text(d, xy, s, font, fill, anchor="la") -> None:
    d.text((xy[0] * S, xy[1] * S), s, font=font, fill=fill, anchor=anchor)


def paste(im: Image.Image, layer: Image.Image, xy) -> None:
    im.paste(layer, (int(xy[0] * S), int(xy[1] * S)), layer)


def logo(px: int) -> Image.Image:
    """The rounded DIP mark rendered from logo.svg (needs rsvg-convert)."""
    out = ROOT / ".og-logo.tmp.png"
    subprocess.run(["rsvg-convert", "-w", str(px * S), str(LANDING / "logo.svg"), "-o", str(out)], check=True)
    img = Image.open(out).convert("RGBA")
    out.unlink()
    return img


def avatar(name: str, px: int) -> Image.Image:
    return Image.open(AVATARS / f"{name}.webp").convert("RGBA").resize((px * S, px * S), Image.LANCZOS)


def phone(shot: str, width: int) -> Image.Image:
    """Screenshot inside the iPhone bezel used on the landing page (same inset and corner maths)."""
    frame = Image.open(LANDING / "iphone-frame.png").convert("RGBA")
    fw, fh = frame.size
    scale = width * S / fw
    frame = frame.resize((width * S, round(fh * scale)), Image.LANCZOS)
    fw, fh = frame.size
    x0, x1 = round(fw * 0.051028), round(fw * (1 - 0.051028))
    y0, y1 = round(fh * 0.021698), round(fh * (1 - 0.022073))
    sw, sh = x1 - x0, y1 - y0
    shot_im = Image.open(LANDING / shot).convert("RGB")
    sc = sw / shot_im.width
    shot_im = shot_im.resize((sw, round(shot_im.height * sc)), Image.LANCZOS).crop((0, 0, sw, sh))
    mask = Image.new("L", (sw, sh), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, sw - 1, sh - 1), radius=round(sw * 0.0775 * 1.0), fill=255)
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    layer.paste(shot_im, (x0, y0), mask)
    layer.alpha_composite(frame)
    return layer


def drop_shadow(layer: Image.Image, blur: int, alpha: int, offset=(0, 24)) -> Image.Image:
    from PIL import ImageFilter

    pad = blur * 3
    sh = Image.new("RGBA", (layer.width + pad * 2, layer.height + pad * 2), (0, 0, 0, 0))
    a = layer.split()[3].point(lambda v: alpha if v > 8 else 0)
    sh.paste((30, 33, 43, 255), (pad + offset[0] * S, pad + offset[1] * S), a)
    sh = sh.filter(ImageFilter.GaussianBlur(blur * S))
    sh.alpha_composite(layer, (pad, pad))
    return sh


def save(im: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    out = im.resize((W, H), Image.LANCZOS)
    out.save(path, "JPEG", quality=88, optimize=True, progressive=True)
    print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KB)")


SAFE_L = 290  # share previews are sometimes cropped to the centre square (x 285..915): keep logo and text inside it


def ring_avatar(im, d, name, cx, cy, px, ring=INK):
    circle(d, cx, cy, px // 2 + 6, fill=ring)
    paste(im, avatar(name, px), (cx - px / 2, cy - px / 2))


def landing_card() -> None:
    im, d = canvas(PURPLE)
    # Flat shapes: pink disc behind the phone, a few avatars bleeding in from the left.
    circle(d, 1010, 470, 240, fill=PINK)
    circle(d, 1120, 80, 54, fill=YELLOW)
    circle(d, 70, 560, 150, fill=PINK)
    ring_avatar(im, d, "green", 96, 190, 120)
    ring_avatar(im, d, "orange", 160, 430, 96, ring=INK)
    ph = phone("home.webp", 360).rotate(6, resample=Image.BICUBIC, expand=True)
    ph = drop_shadow(ph, 22, 70)
    paste(im, ph, (850, 80))
    # Brand row and headline inside the safe square.
    paste(im, logo(84), (SAFE_L, 52))
    text(d, (SAFE_L + 100, 66), "DIP", fjalla(64), INK)
    big = fjalla(92)
    y = 176
    for s, fill in [("GET OUT OF", INK), ("THE OFFICE.", INK), ("DO SOMETHING", WHITE), ("TOGETHER.", WHITE)]:
        text(d, (SAFE_L, y), s, big, fill)
        y += 97
    save(im, LANDING / "og.jpg")


def admin_card() -> None:
    im, d = canvas(INK)
    circle(d, 1150, 600, 190, fill=PURPLE)
    # Portal window bleeding off the right edge: sidebar dots and three event rows.
    rrect(d, (930, 110, 1290, 520), 28, fill=WHITE)
    rrect(d, (946, 126, 1020, 504), 20, fill="#ECECEC")
    for i, c in enumerate([PURPLE, PINK, YELLOW, "#77C5FF"]):
        circle(d, 983, 166 + i * 52, 13, fill=c)
    for i, (av, col) in enumerate([("pink", PURPLE), ("lime", PINK), ("teal", YELLOW)]):
        top = 144 + i * 120
        rrect(d, (1040, top, 1290, top + 100), 22, outline=col, width=3)
        rrect(d, (1062, top + 22, 1170, top + 38), 8, fill=INK)
        rrect(d, (1062, top + 52, 1130, top + 64), 6, fill="#C9CCDA")
        rrect(d, (1062, top + 74, 1126, top + 90), 8, fill=col)
        paste(im, avatar(av, 40), (1232, top + 14))
    # Avatar cluster bleeding in from the left.
    circle(d, 60, 650, 130, fill=PINK)
    ring_avatar(im, d, "orange", 120, 430, 150)
    ring_avatar(im, d, "purple", 150, 170, 110)
    ring_avatar(im, d, "blue", 60, 300, 80)
    ring_avatar(im, d, "green", 880, 560, 84)
    # Centre column (safe square).
    paste(im, logo(84), (SAFE_L, 52))
    text(d, (SAFE_L + 100, 66), "DIP", fjalla(64), WHITE)
    text(d, (SAFE_L, 178), "DIP ADMIN", fjalla(124), WHITE)
    text(d, (SAFE_L, 322), "ORGANIZER PORTAL", fjalla(56), YELLOW)
    text(d, (SAFE_L, 420), "Events, albums, members", figtree(36), "#E8EAF4")
    text(d, (SAFE_L, 466), "and challenges, in one place.", figtree(36), "#E8EAF4")
    save(im, ADMIN_PUBLIC / "og-admin.jpg")


def favicons() -> None:
    if not shutil.which("rsvg-convert"):
        print("rsvg-convert missing: skipped favicons")
        return
    svg = LANDING / "logo.svg"
    for folder in (LANDING, ADMIN_PUBLIC / "admin"):
        folder.mkdir(parents=True, exist_ok=True)
        for name, px in {"favicon-32.png": 32, "apple-touch-icon.png": 180, "icon-192.png": 192, "icon-512.png": 512}.items():
            subprocess.run(["rsvg-convert", "-w", str(px), "-h", str(px), str(svg), "-o", str(folder / name)], check=True)
            if name == "apple-touch-icon.png":
                # iOS fills transparency with black and rounds the corners itself: ship a full-bleed opaque square.
                icon = Image.open(folder / name).convert("RGBA")
                flat = Image.new("RGB", icon.size, "#7C88FA")
                flat.paste(icon, (0, 0), icon)
                flat.save(folder / name, optimize=True)
        print("wrote favicons in", folder.relative_to(ROOT))
    # /favicon.ico for clients that ignore <link rel=icon> (copied to the site root by scripts/build-site.sh).
    Image.open(LANDING / "icon-192.png").convert("RGBA").save(LANDING / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])


if __name__ == "__main__":
    favicons()
    landing_card()
    admin_card()
