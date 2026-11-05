"""Generate original 512×384 JPEG decode workloads. Requires Pillow; output is untracked."""
import argparse
from pathlib import Path
from PIL import Image

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('output', type=Path)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
for mode in ('L','RGB'):
    image = Image.new(mode,(512,384))
    image.putdata([(x*3+y*5)%256 if mode == 'L' else ((x*3+y*5)%256,(x*7+y*11)%256,(x*13+y*17)%256) for y in range(384) for x in range(512)])
    for progressive in (False,True):
        name = f'{mode}-{"progressive" if progressive else "baseline"}.jpg'
        image.save(args.output/name,quality=90,progressive=progressive,subsampling=2)
