# Codex-creations

A polished browser-based video analyzer built with HTML, CSS, and JavaScript.

## Modes

### 1) Scene breakdown
- Upload a local video.
- Sample frames across the timeline.
- Estimate brightness, dominant color tendency, and motion intensity.
- Show per-frame thumbnails and quick stats.

### 2) License plate recognition mode
- Detect plate-like rectangular regions from sampled frames.
- Attempt OCR extraction for top-ranked detected plate crops.
- Rank results and show best candidates with confidence.

## JSON export

After analysis, click **Download JSON Report** to save a structured report locally:
- Scene mode export includes per-frame metrics (brightness, dominant tone, edge density, average RGB).
- LPR mode export includes detected candidates, confidence, OCR reads, and best candidate metadata.

## Files

- `index.html` — UI and controls.
- `styles.css` — visual design and responsive layout.
- `app.js` — analysis engine (scene + LPR modes) and JSON export.
- `serve.sh` — run the app bound to `0.0.0.0` so it is reachable by IP on your network.
- `test_server.sh` — quick local server smoke test.

## Run locally

```bash
./serve.sh
```

Optional custom port:

```bash
./serve.sh 9000
```

`serve.sh` prints both localhost and LAN URLs, for example:
- `http://127.0.0.1:8000`
- `http://192.168.1.25:8000`

## Quick test

```bash
./test_server.sh
```

This confirms the app serves successfully on localhost.

## Important notes

- LPR is a **best-effort client-side heuristic** and not equivalent to production ALPR systems.
- OCR uses `tesseract.js` from CDN when available; if blocked/offline, OCR falls back gracefully.
