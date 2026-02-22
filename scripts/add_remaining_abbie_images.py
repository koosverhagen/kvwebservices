from pathlib import Path
from urllib.request import urlopen
from PIL import Image
import io

base = Path("images/abbie/legacy")
items = [
    ("2e1fadeed270406bb4a77fbe5bf2d4f0.jpeg", "https://artprinthub.com/image/thumbnails/18/88/Horse_dog_right_jpg-100481-600x600.jpg"),
    ("9e068a1e001f4a6f9fdca97e7afe02c1.jpeg", "https://artprinthub.com/image/thumbnails/18/89/Hound_Show_jpg-100502-600x600.jpg"),
    ("chestnut-on-green.jpeg", "https://artprinthub.com/image/thumbnails/18/89/Chestnut_on_Green_jpg-100499-600x600.jpg"),
    ("bay-on-orange.jpeg", "https://artprinthub.com/image/thumbnails/18/89/Bay_on_Orange_jpg-100497-600x600.jpg"),
    ("leave-it.jpeg", "https://artprinthub.com/image/thumbnails/18/88/ladies_and_dogs_jpg-100483-600x600.jpg"),
    ("ukraine.jpeg", "https://artprinthub.com/image/thumbnails/18/8a/Ukraine_jpg-100513-600x600.jpg"),
]

for filename, url in items:
    data = urlopen(url).read()
    img = Image.open(io.BytesIO(data)).convert("RGB")
    out = base / filename
    img.save(out, "JPEG", quality=82, optimize=True, progressive=True)
    print(filename, out.stat().st_size)
