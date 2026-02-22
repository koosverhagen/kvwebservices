from pathlib import Path
from PIL import Image

path = Path("images/abbie/legacy/3c1f9b9a7765455f8785d42869ecd1c7.jpeg")
img = Image.open(path).convert("RGB")
width, height = img.size
pixels = img.load()

threshold = 238
row_ratio = 0.90
col_ratio = 0.90


def near_white(rgb):
    r, g, b = rgb
    return r >= threshold and g >= threshold and b >= threshold


top = 0
while top < height:
    white = sum(1 for x in range(width) if near_white(pixels[x, top]))
    if white / width >= row_ratio:
        top += 1
    else:
        break

bottom = height - 1
while bottom >= top:
    white = sum(1 for x in range(width) if near_white(pixels[x, bottom]))
    if white / width >= row_ratio:
        bottom -= 1
    else:
        break

left = 0
while left < width:
    white = sum(1 for y in range(top, bottom + 1) if near_white(pixels[left, y]))
    if white / max(1, (bottom - top + 1)) >= col_ratio:
        left += 1
    else:
        break

right = width - 1
while right >= left:
    white = sum(1 for y in range(top, bottom + 1) if near_white(pixels[right, y]))
    if white / max(1, (bottom - top + 1)) >= col_ratio:
        right -= 1
    else:
        break

if left <= right and top <= bottom:
    crop_box = (left, top, right + 1, bottom + 1)
    if crop_box != (0, 0, width, height):
        cropped = img.crop(crop_box)
        cropped.save(path, "JPEG", quality=84, optimize=True, progressive=True)
        print(f"CROPPED {path.name} {width}x{height} -> {cropped.size[0]}x{cropped.size[1]} box={crop_box}")
    else:
        print(f"NOCHANGE {path.name} {width}x{height}")
else:
    print(f"SKIP {path.name} (invalid crop)")

# edge diagnostics after save
img2 = Image.open(path).convert("RGB")
w2, h2 = img2.size
px2 = img2.load()

def edge_white_ratio_row(y):
    return sum(1 for x in range(w2) if near_white(px2[x, y])) / w2

def edge_white_ratio_col(x):
    return sum(1 for y in range(h2) if near_white(px2[x, y])) / h2

print(
    "EDGE_RATIOS",
    f"top={edge_white_ratio_row(0):.3f}",
    f"bottom={edge_white_ratio_row(h2-1):.3f}",
    f"left={edge_white_ratio_col(0):.3f}",
    f"right={edge_white_ratio_col(w2-1):.3f}",
)
