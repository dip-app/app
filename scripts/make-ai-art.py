"""Spot illustrations for the AI idea flow: flat DIP mascots (same shapes as public/img/themes/*.svg) with one prop each.
Transparent 120x90 SVGs; the card draws a tinted tile behind them. Usage: python3 scripts/make-ai-art.py apps/admin/public/img/ai"""
import sys
from pathlib import Path

INK = "#1E212B"
PURPLE, PINK, TEAL, CORAL, YELLOW, BLUE, GREEN, WHITE = "#7B88FA", "#FB72E4", "#6BE5D0", "#FF7C73", "#FFCC3E", "#66D9FF", "#6BFF9B", "#FFFFFF"

GHOST = "M-72 100L-72 -10C-72 -80 -36 -108 0 -108C36 -108 72 -80 72 -10L72 100C48 84 26 106 0 90C-26 106 -48 84 -72 100Z"
HOUSE = "M-66 96L-66 -26L0 -98L66 -26L66 96Z"


def face(smile=True):
    s = f'<circle cx="-24" cy="-14" r="10" fill="{INK}"/><circle cx="24" cy="-14" r="10" fill="{INK}"/>'
    s += f'<circle cx="-21" cy="-18" r="3.5" fill="{WHITE}"/><circle cx="27" cy="-18" r="3.5" fill="{WHITE}"/>'
    if smile:
        s += f'<path d="M-18 20Q0 38 18 20" fill="none" stroke="{INK}" stroke-width="7" stroke-linecap="round"/>'
    return s


def ghost(x, y, scale, color, rot=0, smile=True):
    return f'<g transform="translate({x} {y}) rotate({rot}) scale({scale})"><path d="{GHOST}" fill="{color}"/>{face(smile)}</g>'


def house(x, y, scale, color, rot=0):
    return f'<g transform="translate({x} {y}) rotate({rot}) scale({scale})"><path d="{HOUSE}" fill="{color}" stroke="{color}" stroke-width="16" stroke-linejoin="round"/>{face()}</g>'


def blob(x, y, r, color):
    k = r / 100
    return f'<g transform="translate({x} {y}) scale({k})"><circle r="100" fill="{color}"/>{face()}</g>'


def heart(x, y, s, color=PINK):
    return f'<path transform="translate({x} {y}) scale({s})" d="M0 6C-4 -2 -14 -2 -14 6C-14 13 -6 17 0 22C6 17 14 13 14 6C14 -2 4 -2 0 6Z" fill="{color}" stroke="{INK}" stroke-width="2.4" stroke-linejoin="round"/>'


def sparkle(x, y, s, color=WHITE, stroke=True):
    st = f' stroke="{INK}" stroke-width="1.6"' if stroke else ""
    return f'<path transform="translate({x} {y}) scale({s})" d="M0 -10L2.6 -2.6L10 0L2.6 2.6L0 10L-2.6 2.6L-10 0L-2.6 -2.6Z" fill="{color}"{st} stroke-linejoin="round"/>'


def coin(x, y, r=9):
    return (f'<circle cx="{x}" cy="{y}" r="{r}" fill="{YELLOW}" stroke="{INK}" stroke-width="2.4"/>'
            f'<path d="M{x} {y - r * .5}V{y + r * .5}" stroke="{INK}" stroke-width="2.4" stroke-linecap="round"/>')


def svg(body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 90" width="120" height="90">{body}</svg>\n'


def ground(color=INK):
    return f'<path d="M14 84H106" stroke="{color}" stroke-width="2.4" stroke-linecap="round" opacity=".18"/>'


ART = {
    # ---------- Goals
    "goal-team_bonding": ground() + ghost(44, 58, .24, PURPLE, -6) + ghost(78, 58, .24, TEAL, 6) + heart(61, 12, .95),
    "goal-wellness": ground() + f'<circle cx="92" cy="22" r="11" fill="{YELLOW}" stroke="{INK}" stroke-width="2.4"/>'
        + f'<path d="M30 70C30 52 42 44 54 42C54 58 44 68 30 70Z" fill="{GREEN}" stroke="{INK}" stroke-width="2.4" stroke-linejoin="round"/>'
        + ghost(66, 58, .26, CORAL),
    "goal-learning": ground() + ghost(54, 58, .26, BLUE)
        + f'<g transform="translate(86 60) rotate(-8)"><path d="M-14 -10H0V12H-14Z" fill="{WHITE}" stroke="{INK}" stroke-width="2.4" stroke-linejoin="round"/><path d="M0 -10H14V12H0Z" fill="{YELLOW}" stroke="{INK}" stroke-width="2.4" stroke-linejoin="round"/></g>'
        + f'<path d="M38 28L54 20L70 28L54 36Z" fill="{INK}"/><path d="M66 29V37" stroke="{INK}" stroke-width="2.4" stroke-linecap="round"/>',
    "goal-give_back": ground() + ghost(48, 58, .26, GREEN) + heart(88, 52, 1.1, CORAL) + sparkle(98, 26, .55, YELLOW),
    "goal-celebrate": ground() + ghost(60, 60, .27, PINK)
        + f'<path d="M51 33L60 18L69 33Z" fill="{YELLOW}" stroke="{INK}" stroke-width="2.4" stroke-linejoin="round"/>'
        + sparkle(26, 26, .8, YELLOW) + sparkle(96, 30, .7, BLUE)
        + f'<rect x="22" y="48" width="6" height="6" rx="1" fill="{TEAL}" transform="rotate(20 25 51)"/><rect x="92" y="54" width="6" height="6" rx="1" fill="{CORAL}" transform="rotate(-20 95 57)"/>',
    "goal-competition": ground() + ghost(46, 58, .26, PURPLE)
        + f'<g transform="translate(88 56)"><path d="M-12 -18H12V-6C12 4 6 8 0 8C-6 8 -12 4 -12 -6Z" fill="{YELLOW}" stroke="{INK}" stroke-width="2.4" stroke-linejoin="round"/>'
        + f'<path d="M-12 -14C-20 -14 -20 -2 -11 -2M12 -14C20 -14 20 -2 11 -2" fill="none" stroke="{INK}" stroke-width="2.4"/><path d="M0 8V16M-8 22H8V16H-8Z" fill="{YELLOW}" stroke="{INK}" stroke-width="2.4" stroke-linejoin="round"/></g>',
    # ---------- Group size
    "size-small": ground() + ghost(46, 58, .24, TEAL, -6) + ghost(76, 60, .22, YELLOW, 6),
    "size-team": ground() + ghost(26, 64, .17, PINK, -6) + ghost(50, 60, .2, PURPLE) + ghost(74, 62, .19, TEAL, 4) + ghost(96, 66, .16, YELLOW, 8),
    "size-company": ground() + "".join(ghost(x, y, .13, c, r) for x, y, c, r in [
        (20, 70, CORAL, -6), (38, 66, BLUE, 4), (56, 68, GREEN, -4), (74, 66, PINK, 6), (92, 70, YELLOW, -6),
        (30, 42, PURPLE, 4), (50, 40, TEAL, -4), (70, 40, YELLOW, 4), (90, 44, PINK, -4)]),
    # ---------- Setting
    "setting-indoors": f'<path d="M24 82V40L60 16L96 40V82" fill="none" stroke="{INK}" stroke-width="2.4" stroke-linejoin="round" opacity=".35"/>'
        + ground() + ghost(60, 60, .24, PURPLE) + f'<rect x="80" y="44" width="10" height="10" rx="1.5" fill="{YELLOW}" stroke="{INK}" stroke-width="2"/>',
    "setting-outdoors": ground() + f'<circle cx="96" cy="20" r="10" fill="{YELLOW}" stroke="{INK}" stroke-width="2.4"/>'
        + f'<path d="M30 84V64" stroke="{INK}" stroke-width="3" stroke-linecap="round"/><circle cx="30" cy="50" r="16" fill="{GREEN}" stroke="{INK}" stroke-width="2.4"/>'
        + house(70, 60, .22, TEAL),
    "setting-offsite": ground() + ghost(46, 60, .24, CORAL)
        + f'<g transform="translate(88 40)"><path d="M0 26C-10 12 -14 4 -14 -2A14 14 0 0 1 14 -2C14 4 10 12 0 26Z" fill="{PINK}" stroke="{INK}" stroke-width="2.4" stroke-linejoin="round"/><circle cy="-2" r="5" fill="{WHITE}" stroke="{INK}" stroke-width="2"/></g>',
    # ---------- Budget (coins grow with the band)
    "budget-free": ground() + ghost(56, 58, .26, GREEN) + heart(92, 46, .9, PINK),
    "budget-under_15": ground() + ghost(48, 58, .26, BLUE) + coin(88, 72),
    "budget-from_15_to_50": ground() + ghost(44, 58, .26, PURPLE) + coin(82, 72) + coin(98, 72) + coin(90, 56),
    "budget-over_50": ground() + ghost(40, 58, .26, PINK) + coin(76, 72) + coin(94, 72) + coin(76, 54) + coin(94, 54) + coin(85, 36),
    # ---------- Timing
    "timing-weekday_lunch": ground() + f'<circle cx="60" cy="16" r="10" fill="{YELLOW}" stroke="{INK}" stroke-width="2.4"/>'
        + ghost(46, 62, .24, CORAL) + f'<path d="M72 70H100Q98 84 86 84Q74 84 72 70Z" fill="{WHITE}" stroke="{INK}" stroke-width="2.4" stroke-linejoin="round"/><path d="M80 64Q82 58 80 54M90 64Q92 58 90 54" fill="none" stroke="{INK}" stroke-width="2" stroke-linecap="round" opacity=".5"/>',
    "timing-after_work": ground() + f'<path d="M96 12A12 12 0 1 0 104 32A10 10 0 1 1 96 12Z" fill="{YELLOW}" stroke="{INK}" stroke-width="2.4" stroke-linejoin="round"/>'
        + sparkle(26, 22, .6, WHITE) + sparkle(76, 14, .45, WHITE) + ghost(52, 60, .26, PURPLE),
    "timing-weekend": ground() + ghost(42, 60, .25, TEAL)
        + f'<g transform="translate(88 52)"><rect x="-16" y="-14" width="32" height="30" rx="3" fill="{WHITE}" stroke="{INK}" stroke-width="2.4"/><path d="M-16 -4H16" stroke="{INK}" stroke-width="2.4"/><rect x="-16" y="-14" width="32" height="10" rx="3" fill="{CORAL}" stroke="{INK}" stroke-width="2.4"/>'
        + f'<circle cx="-6" cy="6" r="3" fill="{PINK}"/><circle cx="6" cy="6" r="3" fill="{PINK}"/></g>',
    # ---------- States
    "state-thinking": ground() + ghost(54, 60, .27, PURPLE) + sparkle(88, 26, .9, YELLOW) + sparkle(100, 46, .55, PINK) + sparkle(24, 30, .6, TEAL),
    "state-results": ground() + ghost(40, 60, .24, TEAL, -6) + ghost(78, 58, .26, PINK, 6) + sparkle(60, 14, .8, YELLOW) + sparkle(22, 24, .5, BLUE) + sparkle(102, 26, .55, GREEN),
    "state-empty": ground() + ghost(60, 60, .26, "#C4C8D6", 0, False),
}


def cloud(x, y, s):
    return (f'<g transform="translate({x} {y}) scale({s})" fill="{WHITE}"><circle cx="26" cy="34" r="22"/><circle cx="58" cy="22" r="28"/>'
            f'<circle cx="92" cy="34" r="20"/><rect x="6" y="34" width="106" height="22" rx="11"/></g>')


def scene(bg, body):
    """Interests without weekly-theme art: a full-bleed accent scene like public/img/themes/*.svg."""
    return f'<rect width="120" height="90" fill="{bg}"/>' + cloud(6, 8, .22) + cloud(84, 20, .16) + body


ART.update({
    "interest-social": scene(BLUE, ghost(42, 62, .25, PINK, -6) + ghost(80, 64, .23, YELLOW, 6)
        + f'<path d="M50 14H84A6 6 0 0 1 90 20V30A6 6 0 0 1 84 36H66L58 43V36H50A6 6 0 0 1 44 30V20A6 6 0 0 1 50 14Z" fill="{WHITE}" stroke="{INK}" stroke-width="2.4" stroke-linejoin="round"/>'
        + f'<circle cx="58" cy="25" r="2.4" fill="{INK}"/><circle cx="67" cy="25" r="2.4" fill="{INK}"/><circle cx="76" cy="25" r="2.4" fill="{INK}"/>'),
    "interest-cooking": scene(GREEN, ghost(44, 62, .26, CORAL)
        + f'<path d="M70 58H104V72A8 8 0 0 1 96 80H78A8 8 0 0 1 70 72Z" fill="{INK}"/><path d="M66 58H108" stroke="{INK}" stroke-width="3" stroke-linecap="round"/>'
        + f'<path d="M80 50Q83 44 80 38M90 50Q93 44 90 38" fill="none" stroke="{WHITE}" stroke-width="2.4" stroke-linecap="round"/>'),
    "interest-energetic": scene(PINK, ghost(64, 60, .26, YELLOW, 10)
        + f'<path d="M22 44H38M18 56H34M24 68H38" stroke="{INK}" stroke-width="2.6" stroke-linecap="round"/>'
        + f'<path d="M98 14L88 32H97L90 48L106 26H96L102 14Z" fill="{WHITE}" stroke="{INK}" stroke-width="2.2" stroke-linejoin="round"/>'),
    "interest-hype": scene(PURPLE, ghost(48, 62, .26, TEAL)
        + f'<path d="M72 48L96 36V70L72 58Z" fill="{YELLOW}" stroke="{INK}" stroke-width="2.4" stroke-linejoin="round"/><rect x="64" y="47" width="9" height="12" rx="2" fill="{WHITE}" stroke="{INK}" stroke-width="2.4"/>'
        + sparkle(104, 26, .55, YELLOW) + sparkle(106, 76, .45, WHITE)),
    "interest-chill": scene(TEAL, ghost(46, 62, .26, PURPLE)
        + f'<path d="M74 60H96V72A8 8 0 0 1 88 80H82A8 8 0 0 1 74 72Z" fill="{WHITE}" stroke="{INK}" stroke-width="2.4" stroke-linejoin="round"/>'
        + f'<path d="M96 64A5 5 0 0 1 96 74" fill="none" stroke="{INK}" stroke-width="2.4"/><path d="M82 54Q85 48 82 42" fill="none" stroke="{WHITE}" stroke-width="2.4" stroke-linecap="round"/>'),
})

# Scout's icon: the purple ghost mascot (as on the app avatar), on a soft lavender disc instead of the avatar's ink one.
SCOUT = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><defs><clipPath id="c"><circle cx="32" cy="32" r="32"/></clipPath></defs>'
         f'<circle cx="32" cy="32" r="32" fill="#E4E7FE"/><g clip-path="url(#c)"><g transform="translate(32 46) scale(.27)"><path d="{GHOST}" fill="{PURPLE}"/>'
         f'<circle cx="-26" cy="-14" r="9" fill="{INK}"/><circle cx="26" cy="-14" r="9" fill="{INK}"/><path d="M-20 20Q0 38 20 20" fill="none" stroke="{INK}" stroke-width="7" stroke-linecap="round"/></g></g></svg>\n')

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
for name, body in ART.items():
    (out / f"{name}.svg").write_text(svg(body))
(out / "scout.svg").write_text(SCOUT)
print(len(ART) + 1, "files")
