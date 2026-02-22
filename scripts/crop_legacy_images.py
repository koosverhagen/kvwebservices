from pathlib import Path
from PIL import Image

folder = Path("images/abbie/legacy")
threshold = 245
extensions = {".jpg", ".jpeg", ".png", ".webp"}

for path in sorted(folder.iterdir()):
    if not path.is_file() or path.suffix.lower() not in extensions:
        continue

    img = Image.open(path).convert("RGB")
    width, height = img.size
    pixels = img.load()

    min_x, min_y = width, height
    max_x, max_y = -1, -1

    for y in range(height):
        for x in range(width):
            red, green, blue = pixels[x, y]
            if red < threshold or green < threshold or blue < threshold:
                if x < min_x:
                    min_x = x
                if y < min_y:
                    min_y = y
                if x > max_x:
                    max_x = x
                if y > max_y:
                    max_y = y

    if max_x == -1 or max_y == -1:
        print(f"SKIP {path.name} (all near-white)")
        continue

    crop_box = (min_x, min_y, max_x + 1, max_y + 1)

    if crop_box == (0, 0, width, height):
        print(f"NOCHANGE {path.name} {width}x{height}")
        continue

    cropped = img.crop(crop_box)
    new_width, new_height = cropped.size

    suffix = path.suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        cropped.save(path, "JPEG", quality=84, optimize=True, progressive=True)
    elif suffix == ".png":
        cropped.save(path, "PNG", optimize=True)
    elif suffix == ".webp":
        cropped.save(path, "WEBP", quality=82, method=6)

    print(
        f"CROPPED {path.name} {width}x{height} -> {new_width}x{new_height} box={crop_box}"
    )
