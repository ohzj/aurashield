"""Generates placeholder AuraShield toolbar icons (solid shield glyph)."""
from PIL import Image, ImageDraw
import os

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "icons")
os.makedirs(OUT_DIR, exist_ok=True)

TEAL = (47, 107, 94, 255)      # #2F6B5E
MINT = (142, 210, 190, 255)    # #8ED2BE

def shield_path(w, h):
    # Points for a simple shield silhouette, normalized to (w, h)
    pts = [
        (0.50, 0.02), (0.92, 0.16), (0.92, 0.50),
        (0.92, 0.72), (0.50, 0.98), (0.08, 0.72),
        (0.08, 0.50), (0.08, 0.16),
    ]
    return [(x * w, y * h) for x, y in pts]

def make_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    outer = shield_path(size, size)
    draw.polygon(outer, fill=TEAL)

    if size >= 32:
        pad = size * 0.22
        inner = [(x * (1 - pad / size * 0.9) + pad * 0.45, y * (1 - pad / size * 0.9) + pad * 0.45)
                  for x, y in shield_path(size, size)]
        draw.polygon(inner, fill=MINT)

    img.save(os.path.join(OUT_DIR, f"icon{size}.png"))

for s in (16, 32, 48, 128):
    make_icon(s)

print("done")
