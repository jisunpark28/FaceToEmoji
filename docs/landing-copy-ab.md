# Landing first screen copy — A/B (Parents vs SNS)

**URL:** https://www.getfacetoemoji.com/  
**Mobile behavior today:** Upload → auto face **blur** → Edit on → Download.  
**Desktop:** Upload → Auto (emoji from expressions) → Edit — consider aligning messaging per segment later.

Use **one variant at a time** for 2–4 weeks, then compare North Star (upload → blur/detect → download).

---

## What to change (first screen only)

| Element | File / location |
|---------|-----------------|
| `<title>` | `index.html` `<head>` |
| Meta description | `index.html` |
| Hero headline (H1) | `index.html` — `.hero` / title button area |
| Hero subline (1 sentence) | Add under H1 if missing, or `why-like` lead |
| Primary mental model | Status line after load (optional, `app.js` init message) |

**Do not change in A/B test:** core UX flow, button labels (Auto / Edit / Download) until one variant wins.

---

## Variant A — Parents (privacy / kids / group)

**Audience:** Parents, family group chats, school/event photos, consent anxiety.

### English (site default)

| Field | Copy |
|-------|------|
| **Title tag** | `Blur Kids' Faces in Photos — Free, Private \| GetFaceToEmoji` |
| **Meta description** | `Hide children's faces before you share photos. Automatic face blur in your browser—photos never uploaded to our servers.` |
| **H1** | `Blur faces before you share` |
| **Subline** | `Upload a group or family photo. We detect faces and blur them on your device—no app install, no server upload.` |
| **Trust line** | `Processing stays in your browser.` |
| **CTA hint** (under preview) | `Tap the preview to upload · faces blur automatically on phone` |

### Korean (Instagram / ads — not necessarily on site)

| Field | Copy |
|-------|------|
| **Hook** | `아이 얼굴, 올리기 전에 30초 블러` |
| **Sub** | `설치 없음 · 서버 업로드 없음` |
| **Bio** | `단체·가족 사진 → 얼굴 자동 블러 👇 getfacetoemoji.com` |

---

## Variant B — SNS (posting / group photo / speed)

**Audience:** Instagram/TikTok posters, friends group photos, “can’t be bothered to sticker each face.”

### English (site default)

| Field | Copy |
|-------|------|
| **Title tag** | `Blur Faces in Group Photos in 30 Seconds \| GetFaceToEmoji` |
| **Meta description** | `Auto-detect faces and blur them in one tap. Free browser tool—no install. Edit or swap emoji before you post.` |
| **H1** | `Group photo? Blur every face fast.` |
| **Subline** | `Upload once, get automatic face blur (or emoji on desktop). Download and post—nothing uploaded to our servers.` |
| **Trust line** | `Private in-browser editing.` |
| **CTA hint** | `Drop a photo here — mobile blurs faces as soon as you upload` |

### Korean (Instagram / ads)

| Field | Copy |
|-------|------|
| **Hook** | `단체 사진, 얼굴 일일이 가리지 마세요` |
| **Sub** | `30초 · 브라우저만 · 링크 타고 끝` |
| **Bio** | `올리기 전 얼굴 블러 · 무료 · 링크 👇` |

---

## Side-by-side (pick one column for 2–4 weeks)

| Element | **A — Parents** | **B — SNS** |
|---------|-----------------|-------------|
| Fear | Photo of child leaks | Tedious editing |
| Promise | Safe sharing | Speed + all faces |
| Proof | No server upload | 30 seconds, one upload |
| Tone | Calm, trust | Direct, casual |
| Avoid | Meme / #NotAFace | “Kids safety” lecture |

---

## Optional H1 only (minimal test)

If you only change one line:

- **A:** `Blur faces before you share`
- **B:** `Group photo? Blur every face fast.`

---

## After upload (status messages — mobile)

Align with winning variant:

| Variant | Success (N faces) | Zero faces |
|---------|-------------------|------------|
| **A** | `Blurred N face(s). Safe to download—or adjust in Edit.` | `No face found. Turn on Edit and drag to add blur.` |
| **B** | `Blurred N faces. Download or Edit to tweak.` | `No faces detected. Edit → drag to add blur.` |

*(Implement in `app.js` `detectFaces` when you lock a variant.)*

---

## How to measure A vs B

| Signal | Tool |
|--------|------|
| North Star per week | Vercel Analytics + manual “completed download” spot checks |
| Bounce on mobile | Analytics |
| Which Reel caption matches variant | IG insights |
| Search queries | Search Console (parents: “blur child face”, SNS: “blur group photo”) |

**Switch variant when:** 2+ weeks of data **or** 50+ off-device sessions total.

---

## Recommendation (starting point)

| Platform | Start with |
|----------|------------|
| **Site (EN)** | **A** if Analytics is mostly direct/mobile family use; **B** if IG drives group-photo intent |
| **Instagram (KR)** | Alternate Reels: week odd = A, even = B; keep bio one line for 4 weeks |

Default suggestion: **A on site** (stronger differentiation vs Instagram), **B on Reels hooks** (scroll-stopping speed).

---

## Related docs

- [8-week experiment checklist](./8-week-experiment-checklist.md)
- [Competitor comparison](./competitor-comparison.md)
