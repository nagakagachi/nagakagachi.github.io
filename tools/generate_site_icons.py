"""Generate site icons from site/static/images/symbol.svg (Python 3.11+)."""
import argparse
from io import BytesIO
import os
from pathlib import Path
import tomllib
import xml.etree.ElementTree as ET
from copy import deepcopy

from PIL import Image, ImageDraw, ImageFont
import resvg_py

ROOT = Path(__file__).resolve().parents[1]
NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", NS)
BACKGROUND = "#171e24"
TEXT = "#dce3e7"
MUTED = "#a1afb8"


def compose(symbol, width, height, x, y, symbol_width, symbol_height, rounded=False):
    root = ET.Element(f"{{{NS}}}svg", {
        "width": str(width), "height": str(height),
        "viewBox": f"0 0 {width} {height}",
    })
    attrs = {"width": str(width), "height": str(height), "fill": BACKGROUND}
    if rounded:
        attrs["rx"] = "12"
    ET.SubElement(root, f"{{{NS}}}rect", attrs)
    nested = deepcopy(symbol)
    nested.set("x", str(x))
    nested.set("y", str(y))
    nested.set("width", str(symbol_width))
    nested.set("height", str(symbol_height))
    root.append(nested)
    return ET.tostring(root, encoding="unicode")


def generate(source, output, font_path, bold_font_path):
    for path in (source, font_path, bold_font_path):
        if not path.is_file():
            raise ValueError(f"Required file not found: {path}")
    symbol = ET.fromstring(source.read_bytes())
    if symbol.tag != f"{{{NS}}}svg" or not symbol.get("viewBox"):
        raise ValueError(f"SVG must have an svg root and viewBox: {source}")
    config = tomllib.loads((ROOT / "site/hugo.toml").read_text(encoding="utf-8-sig"))
    icon_svg = compose(symbol, 64, 64, 8, 4, 48, 56, rounded=True)
    icon = Image.open(BytesIO(resvg_py.svg_to_bytes(svg_string=icon_svg, width=512))).convert("RGBA")
    ico = BytesIO()
    icon.save(ico, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    # Home screen icons use a square background; the operating system supplies its mask.
    touch_svg = compose(symbol, 64, 64, 8, 4, 48, 56)
    touch = resvg_py.svg_to_bytes(svg_string=touch_svg, width=180, height=180)
    # Keep the symbol inside a circular profile crop with generous padding.
    profile_svg = compose(symbol, 1024, 1024, 256, 224, 512, 597.333333)
    profile = resvg_py.svg_to_bytes(svg_string=profile_svg, width=1024, height=1024)
    header_svg = compose(symbol, 1500, 500, 1040, 70, 300, 350)
    header = resvg_py.svg_to_bytes(svg_string=header_svg, width=1500, height=500)
    card_svg = compose(symbol, 1200, 630, 475, 125, 249.6, 291.2)
    scale = 3
    card = Image.open(BytesIO(resvg_py.svg_to_bytes(svg_string=card_svg, width=1200 * scale))).convert("RGB")
    draw = ImageDraw.Draw(card)
    draw.text((600 * scale, 445 * scale), config["title"],
              font=ImageFont.truetype(str(bold_font_path), 54 * scale), fill=TEXT, anchor="mm")
    draw.text((600 * scale, 507 * scale), config["params"]["description"],
              font=ImageFont.truetype(str(font_path), 24 * scale), fill=MUTED, anchor="mm")
    png = BytesIO()
    card.resize((1200, 630), Image.Resampling.LANCZOS).save(png, format="PNG", optimize=True)
    outputs = {
        "favicon.svg": (icon_svg + "\r\n").encode("utf-8"),
        "favicon.ico": ico.getvalue(),
        "apple-touch-icon.png": touch,
        "images/profile-icon.png": profile,
        "images/profile-header.png": header,
        "images/site-card.png": png.getvalue(),
    }
    # Finish rendering everything before replacing any deliverable.
    for name, data in outputs.items():
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        print(f"Generated {target} ({len(data):,} bytes)")


if __name__ == "__main__":
    fonts = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "site/static/images/symbol.svg")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "site/static")
    parser.add_argument("--font", type=Path, default=fonts / "YuGothR.ttc")
    parser.add_argument("--bold-font", type=Path, default=fonts / "YuGothB.ttc")
    args = parser.parse_args()
    try:
        generate(args.source, args.output_dir, args.font, args.bold_font)
    except (ValueError, ET.ParseError, OSError) as exc:
        parser.exit(1, f"Icon generation failed: {exc}\n")
