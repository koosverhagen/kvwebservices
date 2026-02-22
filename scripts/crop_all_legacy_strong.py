from pathlib import Path

from PIL import Image


BASE = Path("images/abbie/legacy")
THRESHOLD = 235
WHITE_RATIO = 0.90
EDGE_CROP_PX = 30
QUALITY = 84


def near_white(rgb):
    red, green, blue = rgb
    return red >= THRESHOLD and green >= THRESHOLD and blue >= THRESHOLD


def row_white_ratio(pixels, width, y):
    return sum(1 for x in range(width) if near_white(pixels[x, y])) / width


def col_white_ratio(pixels, height, x):
    return sum(1 for y in range(height) if near_white(pixels[x, y])) / height


def crop_one(path: Path):
    image = Image.open(path).convert("RGB")
    width, height = image.size
    pixels = image.load()

    crop_top = EDGE_CROP_PX if row_white_ratio(pixels, width, 0) >= WHITE_RATIO else 0
    crop_bottom = EDGE_CROP_PX if row_white_ratio(pixels, width, height - 1) >= WHITE_RATIO else 0
    crop_left = EDGE_CROP_PX if col_white_ratio(pixels, height, 0) >= WHITE_RATIO else 0
    crop_right = EDGE_CROP_PX if col_white_ratio(pixels, height, width - 1) >= WHITE_RATIO else 0

    left = crop_left
    top = crop_top
    right = width - crop_right
    bottom = height - crop_bottom

    if right <= left or bottom <= top:
        return False, (width, height), (width, height), (0, 0, width, height)

    box = (left, top, right, bottom)
    if box == (0, 0, width, height):
        return False, (width, height), (width, height), box

    cropped = image.crop(box)
    cropped.save(path, "JPEG", quality=QUALITY, optimize=True, progressive=True)
    return True, (width, height), cropped.size, box


def main():
    files = sorted(BASE.glob("*.jpg"))
    changed = 0
    for file_path in files:
        did_change, old_size, new_size, box = crop_one(file_path)
        if did_change:
            changed += 1
            print(f"CROPPED {file_path.name} {old_size[0]}x{old_size[1]} -> {new_size[0]}x{new_size[1]} box={box}")
        else:
            print(f"NOCHANGE {file_path.name} {old_size[0]}x{old_size[1]}")
    print(f"DONE changed={changed} total={len(files)}")


if __name__ == "__main__":
    main()