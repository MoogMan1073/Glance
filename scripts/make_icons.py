#!/usr/bin/env python3
"""Generate Glance's app icons and installer artwork from the brand mark.

Everything under src-tauri/icons and src-tauri/installer is derived, not
hand-made: run this after changing anything in assets/branding.

    python3 scripts/make_icons.py

The app icon puts the mark on navy rather than on white. The mark is drawn in
navy with a teal ribbon, so on a white tile it is thin dark strokes on a light
field — which disappears against a light taskbar and turns to mush at 16px.
Inverting it (white document, navy tile) keeps a recognisable silhouette at
every size and still reads on both light and dark Windows taskbars.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "assets" / "branding"
ICONS = ROOT / "src-tauri" / "icons"
INSTALLER = ROOT / "src-tauri" / "installer"

NAVY = (22, 38, 63, 255)      # #16263F, the mark's document colour
WHITE = (255, 255, 255, 255)


def invert_mark(mark: Image.Image) -> Image.Image:
    """Navy strokes become white; the teal ribbon is left alone."""
    out = mark.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a < 8:
                continue
            is_teal = b > r + 40 and g > r + 20
            if not is_teal:
                px[x, y] = (255, 255, 255, a)
    return out


def tile(art: Image.Image, bg, size=1024, pad=0.16, radius=0.18) -> Image.Image:
    """Centre `art` on a rounded square, the shape Windows expects."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=int(size * radius), fill=bg
    )
    avail = int(size * (1 - 2 * pad))
    scale = min(avail / art.width, avail / art.height)
    scaled = art.resize((int(art.width * scale), int(art.height * scale)), Image.LANCZOS)
    img.alpha_composite(scaled, ((size - scaled.width) // 2, (size - scaled.height) // 2))
    return img


def fit(art: Image.Image, box, bg) -> Image.Image:
    """Letterbox `art` into an exact-sized canvas — NSIS wants fixed dimensions."""
    w, h = box
    canvas = Image.new("RGBA", (w, h), bg)
    scale = min((w * 0.88) / art.width, (h * 0.88) / art.height)
    scaled = art.resize((max(1, int(art.width * scale)), max(1, int(art.height * scale))), Image.LANCZOS)
    canvas.alpha_composite(scaled, ((w - scaled.width) // 2, (h - scaled.height) // 2))
    return canvas


def main() -> None:
    ICONS.mkdir(parents=True, exist_ok=True)
    INSTALLER.mkdir(parents=True, exist_ok=True)

    mark = Image.open(BRAND / "glance-mark.png").convert("RGBA")
    lockup = Image.open(BRAND / "glance-lockup.png").convert("RGBA")
    icon = tile(invert_mark(mark), NAVY)

    icon.save(BRAND / "glance-app-icon.png")     # the composed source, for reference
    icon.save(ICONS / "icon.png")
    for size, name in [(32, "32x32.png"), (128, "128x128.png"), (256, "128x128@2x.png")]:
        icon.resize((size, size), Image.LANCZOS).save(ICONS / name)

    # Multi-resolution .ico: Explorer and the taskbar pick the size they need
    # rather than downscaling a big one badly.
    icon.resize((256, 256), Image.LANCZOS).save(
        ICONS / "icon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    # NSIS artwork. Both must be BMP at exactly these sizes, and neither may
    # carry alpha — the installer draws them on its own background.
    fit(lockup, (150, 57), WHITE).convert("RGB").save(INSTALLER / "header.bmp")
    fit(invert_mark(mark), (164, 314), NAVY).convert("RGB").save(INSTALLER / "sidebar.bmp")

    print("icons:", ", ".join(sorted(p.name for p in ICONS.iterdir())))
    print("installer:", ", ".join(sorted(p.name for p in INSTALLER.iterdir())))


if __name__ == "__main__":
    main()
