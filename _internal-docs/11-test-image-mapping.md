# Test Image Mapping

- Sub-folder: `/images-for-testing`

## Single-dish Photos

- `roasted-chicken-rice.webp`
- `spaghetti-bolognese.jpg`
- `steamed-chicken-rice.jpeg`

## Edge-case Photos

- `blurred-roasted-chicken-rice.png`: A photo of a blurred single-dish to test blurred-photo dish rejection edge case
- `multi-dish.jpeg`: A photo of many dishes to test rejection of multi-dish photos edge case
- `pixelated-steamed-chicken-rice.png`: A photo of a pixelated single-dish to test pixelated-photo dish edge case

## Image Filename > Expected Output

- `roasted-chicken-rice.webp` > generate recipe and nutritional information
- `spaghetti-bolognese.jpg` > generate recipe and nutritional information
- `steamed-chicken-rice.jpeg` > generate recipe and nutritional information

- `blurred-roasted-chicken-rice.png` > Reject. Reason: too blurry to identify
- `multi-dish.jpeg` > Reject. Reason: multiple dishes
- `pixelated-steamed-chicken-rice.png` > Reject. Reason: Too pixelated to identify
