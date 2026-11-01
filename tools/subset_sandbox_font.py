"""Noto Sans JPをRust UIの文字集合へ縮小する。fonttools==4.68.0を使用。"""
import argparse
from pathlib import Path
from fontTools import subset
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.ttLib import TTFont

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path)
parser.add_argument('--version', choices=['v04','v05'], default='v04')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1] / 'rendering-sandbox' / args.version
font = instantiateVariableFont(TTFont(args.source), {'wght': 400}, inplace=True)
text = ''.join(p.read_text(encoding='utf-8') for p in (root / 'src').rglob('*.rs'))
text += ''.join(chr(i) for i in range(32, 127)) + ''.join(chr(i) for i in range(0x3000, 0x3100))
options = subset.Options()
options.name_IDs = ['*']
options.name_legacy = True
subsetter = subset.Subsetter(options=options)
subsetter.populate(text=text)
subsetter.subset(font)
font.save(root / 'assets/NotoSansJP-UI.ttf')
