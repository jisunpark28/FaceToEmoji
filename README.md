# FaceToEmoji

FaceToEmoji is a simple web app that helps you hide faces in photos with emoji overlays.
It supports automatic face detection, manual face editing, and one-click download.

**Production site:** [https://www.getfacetoemoji.com/](https://www.getfacetoemoji.com/)

## What it does

- Upload an image (click or drag-and-drop)
- Detect faces automatically
- Add or adjust faces manually
- Move and resize selected emoji with the mouse
- Change emoji style, opacity, and size
- Download the edited image

## Tech

- Vanilla HTML, CSS, JavaScript
- [face-api.js](https://github.com/justadudewhohacks/face-api.js) (loaded from jsDelivr with Subresource Integrity)
- AI model weights from the [face-api.js model CDN](https://github.com/justadudewhohacks/face-api.js/tree/master/weights)

## Run locally

```bash
python3 -m http.server 8080
```

Open: `http://localhost:8080`

For lint and tests:

```bash
npm ci
npm run validate
```

## Deploy

| Environment | URL | Role |
|-------------|-----|------|
| **Vercel (primary)** | [www.getfacetoemoji.com](https://www.getfacetoemoji.com/) | Official production hosting. Custom domain, analytics, and automatic deploys from `main`. |
| **GitHub Pages (optional)** | Project Pages URL after workflow run | Mirror / backup only. Deploy manually via **Actions → Deploy FaceToEmoji to Pages → Run workflow**. Not the canonical domain. |

SEO metadata (`canonical`, Open Graph, `sitemap.xml`, `robots.txt`) all point to `https://www.getfacetoemoji.com/`.

## External dependencies

The app needs network access on first load for:

1. **face-api.js** — `cdn.jsdelivr.net` (pinned to v0.22.2 with SRI)
2. **Model weights** — `justadudewhohacks.github.io/face-api.js/models`
3. **Vercel Insights** (production only) — `/_vercel/insights/script.js`

Images are processed entirely in the browser; nothing is uploaded to a server.

## License

[MIT](LICENSE)
