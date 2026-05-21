from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[2]

DEFAULT_ITEM_DEFINITIONS = (
    {
        "name": "Chicken",
        "unit_type": "WEIGHT",
        "base_unit": "KG",
        "image_path": BACKEND_ROOT / "assets/chicken-with-skin.jpeg",
    },
    {
        "name": "Chicken without skin",
        "unit_type": "WEIGHT",
        "base_unit": "KG",
        "image_path": BACKEND_ROOT / "assets/chicken-without-skin.jpeg",
    },
    {
        "name": "Duck",
        "unit_type": "COUNT",
        "base_unit": "UNIT",
        "image_path": BACKEND_ROOT / "assets/duck.jpeg",
    },
    {
        "name": "Country Chicken",
        "unit_type": "WEIGHT",
        "base_unit": "KG",
        "image_path": BACKEND_ROOT / "assets/country-chicken.jpeg",
    },
    {
        "name": "Live Country Chicken",
        "unit_type": "WEIGHT",
        "base_unit": "KG",
        "image_path": BACKEND_ROOT / "assets/live-country-chicken.jpg",
    },
    {
        "name": "Live Chicken",
        "unit_type": "WEIGHT",
        "base_unit": "KG",
        "image_path": BACKEND_ROOT / "assets/live-chicken.jpeg",
    },
    {
        "name": "Chicken Cleaning",
        "unit_type": "WEIGHT",
        "base_unit": "KG",
        "image_path": BACKEND_ROOT / "assets/chicken-cleaning.jpeg",
    },
)

DEFAULT_ITEM_IMAGE_PATHS = {
    item_definition["name"]: item_definition["image_path"]
    for item_definition in DEFAULT_ITEM_DEFINITIONS
}
