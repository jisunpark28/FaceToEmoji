# Internal analytics (owner only)

Track **visit proxy**, **upload**, **Auto**, **detect**, **download**, and **North Star** without exposing a public dashboard.

## What gets tracked

| Event | When | Maps to |
|-------|------|---------|
| `upload` | Image loaded on canvas | Funnel step 1 |
| `auto_click` | Auto button pressed | Manual detect |
| `auto_detect_upload` | Detect OK after upload flow | Mobile auto path |
| `detect_ok` | ≥1 face detected | Funnel step 2 |
| `detect_empty` | 0 faces | Quality signal |
| `detect_fail` | Detection error | Quality signal |
| `download` | Save / share success | Funnel step 3 |
| `north_star` | download **and** same session had upload + detect_ok | **North Star** |

**Visits (page views):** Vercel Analytics dashboard — not duplicated in the debug panel (use Vercel for traffic).

---

## 1. See numbers on your phone/desktop (debug panel)

1. Open the site with:

   ```
   https://www.getfacetoemoji.com/?analytics_debug=1
   ```

   Or once in the console:

   ```js
   localStorage.setItem("facetoemoji_analytics_debug", "1");
   location.reload();
   ```

2. A small panel appears **bottom-right** with **this week’s counts** (stored in your browser `localStorage`).

3. Run through the app: upload → blur → download → watch `north_star` increase.

4. Turn off:

   ```js
   localStorage.removeItem("facetoemoji_analytics_debug");
   location.reload();
   ```

**Note:** Week counts in the panel are **per browser/device** (your internal notebook). Production totals for all users are in Vercel.

---

## 2. See all users (Vercel)

1. [Vercel](https://vercel.com) → your project → **Analytics**
2. **Visitors / Page views** = “방문만”
3. **Events** (Web Analytics custom events) — after deploy with `analytics.js`:
   - Filter by event name: `download`, `north_star`, `upload`, etc.
4. Requires production host (`getfacetoemoji.com` or `*.vercel.app`). Localhost does not send Vercel events.

If Events tab is empty, confirm Analytics is enabled on the Vercel project and wait 24h for first data.

---

## 3. Files

| File | Role |
|------|------|
| `analytics.js` | Events + debug panel + Vercel `va('event', …)` |
| `app.js` | Calls `FTEAnalytics.*` at upload / detect / download |

---

## 4. Weekly North Star (manual)

Use the debug panel **Reset week counts** on Monday, or copy counts into [8-week-experiment-checklist.md](./8-week-experiment-checklist.md).

**North Star for the week** ≈ `north_star` count in Vercel (all users) or debug panel (you only).

---

## Privacy

- No PII, no image data — only event names and small props (`face_count`, `mobile`, `method`).
- Debug panel is **not** shown to normal visitors (only with `?analytics_debug=1` or localStorage flag).
