"""Downsample textures in every *-lite residence model folder to 512px (run after lite-residence-models.mjs)."""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2] / "public" / "media" / "residence-realism"

for folder in sorted(ROOT.glob("*-lite")):
    for image_path in sorted((folder / "textures").glob("*.jpg")):
        before = image_path.stat().st_size
        with Image.open(image_path) as image:
            if max(image.size) <= 512:
                continue
            image.thumbnail((512, 512), Image.LANCZOS)
            image.save(image_path, "JPEG", quality=85, optimize=True)
        print(f"{folder.name}/{image_path.name}: {before // 1024} -> {image_path.stat().st_size // 1024} KiB")
