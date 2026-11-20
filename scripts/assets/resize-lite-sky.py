"""Write a half-resolution copy of garden-sky.hdr for lite devices (Radiance RGBE, RLE)."""
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2] / "public" / "media" / "residence-realism"


def read_hdr(path: Path) -> np.ndarray:
    data = path.read_bytes()
    end = data.index(b"\n\n") + 2
    size_line_end = data.index(b"\n", end)
    _, height, _, width = data[end:size_line_end].split()
    height, width = int(height), int(width)
    pos = size_line_end + 1
    rgbe = np.zeros((height, width, 4), np.uint8)
    for y in range(height):
        if data[pos:pos + 2] != b"\x02\x02":
            raise ValueError("Only new-style RLE scanlines are supported")
        pos += 4
        for channel in range(4):
            x = 0
            while x < width:
                count = data[pos]; pos += 1
                if count > 128:
                    count -= 128
                    rgbe[y, x:x + count, channel] = data[pos]; pos += 1
                else:
                    rgbe[y, x:x + count, channel] = np.frombuffer(data[pos:pos + count], np.uint8); pos += count
                x += count
    exponent = rgbe[..., 3].astype(np.float64)
    scale = np.where(exponent > 0, np.ldexp(1.0, (exponent - 136).astype(int)), 0.0)
    return rgbe[..., :3].astype(np.float64) * scale[..., None]


def write_hdr(path: Path, rgb: np.ndarray) -> None:
    height, width, _ = rgb.shape
    brightest = rgb.max(axis=2)
    mantissa, exponent = np.frexp(brightest)
    scale = np.where(brightest > 1e-32, mantissa * 256.0 / np.maximum(brightest, 1e-32), 0.0)
    rgbe = np.zeros((height, width, 4), np.uint8)
    rgbe[..., :3] = np.clip(rgb * scale[..., None], 0, 255).astype(np.uint8)
    rgbe[..., 3] = np.where(brightest > 1e-32, exponent + 128, 0).astype(np.uint8)
    out = bytearray(b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n" + f"-Y {height} +X {width}\n".encode())
    for y in range(height):
        out += bytes([2, 2, width >> 8, width & 255])
        for channel in range(4):
            row = rgbe[y, :, channel]
            x = 0
            while x < width:
                run = 1
                while x + run < width and run < 127 and row[x + run] == row[x]:
                    run += 1
                if run >= 4:
                    out += bytes([128 + run, row[x]]); x += run
                    continue
                start = x
                while x < width and x - start < 128:
                    if x + 3 < width and row[x] == row[x + 1] == row[x + 2] == row[x + 3]:
                        break
                    x += 1
                out += bytes([x - start]) + row[start:x].tobytes()
    path.write_bytes(bytes(out))


source = ROOT / "garden-sky.hdr"
target = ROOT / "lite" / "garden-sky.hdr"
image = read_hdr(source)
half = image.reshape(image.shape[0] // 2, 2, image.shape[1] // 2, 2, 3).mean(axis=(1, 3))
target.parent.mkdir(exist_ok=True)
write_hdr(target, half)
check = read_hdr(target)
error = np.abs(check - half).mean() / max(half.mean(), 1e-9)
print(f"{source.stat().st_size // 1024} KiB {image.shape[1]}x{image.shape[0]} -> {target.stat().st_size // 1024} KiB {half.shape[1]}x{half.shape[0]}; round-trip error {error:.4%}")
