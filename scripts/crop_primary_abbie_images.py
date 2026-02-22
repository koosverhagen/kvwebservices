from pathlib import Path
from PIL import Image

files = [
    Path("images/abbie/abbie-art-001.webp"),
    Path("images/abbie/abbie-art-002.webp"),
    Path("images/abbie/abbie-art-003.webp"),
    Path("images/abbie/abbie-art-004.webp"),
    Path("images/abbie/abbie-art-005.webp"),
]

threshold = 252
row_ratio = 0.97
col_ratio = 0.97


def is_near_white(rgb):
    red, green, blue = rgb
    return red >= threshold and green >= threshold and blue >= threshold


for path in files:
    img = Image.open(path).convert("RGB")
    width, height = img.size
    pixels = img.load()

    top = 0
    while top < height:
        white_pixels = sum(1 for x in range(width) if is_near_white(pixels[x, top]))
        if white_pixels / width >= row_ratio:
            top += 1
        else:
            break

    bottom = height - 1
    while bottom >= top:
        white_pixels = sum(1 for x in range(width) if is_near_white(pixels[x, bottom]))
        if white_pixels / width >= row_ratio:
            bottom -= 1
        else:
            break

    left = 0
    while left < width:
        white_pixels = sum(
            1 for y in range(top, bottom + 1) if is_near_white(pixels[left, y])
        )
        if white_pixels / max(1, (bottom - top + 1)) >= col_ratio:
            left += 1
        else:
            break

    right = width - 1
    while right >= left:
        white_pixels = sum(
            1 for y in range(top, bottom + 1) if is_near_white(pixels[right, y])
        )
        if white_pixels / max(1, (bottom - top + 1)) >= col_ratio:
            right -= 1
        else:
            break

    if left > right or top > bottom:
        print(f"SKIP {path.name} (all near-white?)")
        continue

    crop_box = (left, top, right + 1, bottom + 1)
    if crop_box == (0, 0, width, height):
        print(f"NOCHANGE {path.name} {width}x{height}")
        continue

    cropped = img.crop(crop_box)
    new_width, new_height = cropped.size
    cropped.save(path, "WEBP", quality=82, method=6)
    print(
        f"CROPPED {path.name} {width}x{height} -> {new_width}x{new_height} box={crop_box}"
    )
