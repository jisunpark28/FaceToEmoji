# FaceToEmoji

FaceToEmoji is a clean one-page web app that lets users upload photos, automatically detect faces, and replace each detected face with an expression-based emoji sticker or blur effect.

## Features

- Drag and drop image upload from local folders (or file picker)
- Automatic face detection after upload
- Auto expression analysis and best-match emoji selection
- Manual face selection for missed detections (draw box mode)
- Click-to-exclude faces from processing
- Per-face mode switch: Emoji or Blur
- Download processed image to local PC

## Tech Stack

- Vanilla HTML/CSS/JavaScript
- [face-api.js](https://github.com/justadudewhohacks/face-api.js) for face detection and expression inference
- Client-side processing with HTML Canvas (no server required)

## Local Run

Because browsers can block local model loading with `file://`, run with a small local server:

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

## Deployment

GitHub Pages workflow is included at:

```text
.github/workflows/deploy-pages.yml
```

After merging to `main`, enable Pages in repository settings (if not already enabled), and the site deploys automatically.
