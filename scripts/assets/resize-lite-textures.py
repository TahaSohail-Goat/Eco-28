"""Write 512px textures for lite devices (run after lite-residence-models.mjs).

- Every *-lite model folder: textures are downsampled in place.
- House surface maps: 512px copies go to residence-realism/lite/.
"""
from pathlib import Path

from PIL import Image

MEDIA = Path(__file__).resolve().parents[2] / "public" / "media"
ROOT = MEDIA / "residence-realism"
SURFACES = sorted(ROOT.glob("*-*.webp")) + [MEDIA / "hero-study" / "plastered_wall_04.jpg"]


def shrink(source: Path, target: Path) -> None:
    before = source.stat().st_size
    with Image.open(source) as image:
        image = image.convert("RGB")
        if max(image.size) > 512:
            image.thumbnail((512, 512), Image.LANCZOS)
        if target.suffix == ".webp":
            image.save(target, "WEBP", quality=85, method=6)
        else:
            image.save(target, "JPEG", quality=85, optimize=True)
    print(f"{target.relative_to(MEDIA)}: {before // 1024} -> {target.stat().st_size // 1024} KiB")


for folder in sorted(ROOT.glob("*-lite")):
    for image_path in sorted((folder / "textures").glob("*.jpg")):
        with Image.open(image_path) as image:
            if max(image.size) <= 512:
                continue
        shrink(image_path, image_path)

(ROOT / "lite").mkdir(exist_ok=True)
for source in SURFACES:
    shrink(source, ROOT / "lite" / source.name)
