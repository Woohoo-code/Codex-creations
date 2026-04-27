const videoInput = document.getElementById('videoInput');
const modeSelect = document.getElementById('modeSelect');
const sampleCountInput = document.getElementById('sampleCount');
const analyzeBtn = document.getElementById('analyzeBtn');
const downloadBtn = document.getElementById('downloadBtn');
const statusText = document.getElementById('statusText');
const preview = document.getElementById('preview');
const resultsPanel = document.getElementById('resultsPanel');
const framesPanel = document.getElementById('framesPanel');
const platesPanel = document.getElementById('platesPanel');
const resultsTitle = document.getElementById('resultsTitle');
const summary = document.getElementById('summary');
const metrics = document.getElementById('metrics');
const frames = document.getElementById('frames');
const plates = document.getElementById('plates');

let currentVideoURL = null;
let ocrWorkerPromise = null;
let lastSerializableReport = null;
let lastReportFilename = 'video-analysis-report.json';

videoInput.addEventListener('change', () => {
  const file = videoInput.files?.[0];
  if (!file) return;

  if (currentVideoURL) {
    URL.revokeObjectURL(currentVideoURL);
  }

  currentVideoURL = URL.createObjectURL(file);
  preview.src = currentVideoURL;
  clearUI();
  statusText.textContent = `Loaded: ${file.name}`;
});

downloadBtn.addEventListener('click', () => {
  if (!lastSerializableReport) {
    alert('Run analysis first to generate a report.');
    return;
  }

  const blob = new Blob([JSON.stringify(lastSerializableReport, null, 2)], {
    type: 'application/json',
  });

  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = lastReportFilename;
  anchor.click();
  URL.revokeObjectURL(href);

  statusText.textContent = `Downloaded ${lastReportFilename}`;
});

analyzeBtn.addEventListener('click', async () => {
  const file = videoInput.files?.[0];
  if (!file) {
    alert('Select a video first.');
    return;
  }

  const sampleCount = clamp(Number(sampleCountInput.value) || 14, 4, 80);
  const mode = modeSelect.value;

  setBusy(true, `Running ${mode === 'lpr' ? 'plate recognition' : 'scene analysis'}…`);
  clearUI();

  try {
    await ensureLoadedMetadata(preview);
    const sampledFrames = await sampleFrames(preview, sampleCount);

    if (mode === 'lpr') {
      const report = await runPlateMode(sampledFrames, preview.duration, file.name);
      renderPlateReport(report);
      lastSerializableReport = toSerializablePlateReport(report);
      lastReportFilename = `${slugify(file.name.replace(/\.[^.]+$/, ''))}-lpr-report.json`;
    } else {
      const report = summarizeScene(sampledFrames, preview.duration, file.name);
      renderSceneReport(report);
      lastSerializableReport = toSerializableSceneReport(report);
      lastReportFilename = `${slugify(file.name.replace(/\.[^.]+$/, ''))}-scene-report.json`;
    }

    downloadBtn.disabled = false;
    statusText.textContent = 'Ready. Analysis complete.';
  } catch (error) {
    alert(`Analysis failed: ${error.message}`);
    statusText.textContent = 'Analysis failed. Try another video or fewer samples.';
    lastSerializableReport = null;
    downloadBtn.disabled = true;
  } finally {
    setBusy(false, statusText.textContent);
  }
});

function clearUI() {
  resultsPanel.hidden = true;
  framesPanel.hidden = true;
  platesPanel.hidden = true;
  frames.innerHTML = '';
  plates.innerHTML = '';
  summary.innerHTML = '';
  metrics.innerHTML = '';
  lastSerializableReport = null;
  downloadBtn.disabled = true;
}

function setBusy(isBusy, text) {
  analyzeBtn.disabled = isBusy;
  downloadBtn.disabled = isBusy || !lastSerializableReport;
  analyzeBtn.textContent = isBusy ? 'Analyzing…' : 'Analyze Video';
  statusText.textContent = text;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function slugify(value) {
  return (value || 'video-analysis')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'video-analysis';
}

function ensureLoadedMetadata(video) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 1 && video.duration > 0) {
      resolve();
      return;
    }

    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Could not load video metadata.'));
    };
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
    };

    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('error', onError);
  });
}

async function sampleFrames(video, sampleCount) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  canvas.width = Math.max(1, video.videoWidth);
  canvas.height = Math.max(1, video.videoHeight);

  const duration = video.duration;
  const step = duration / (sampleCount + 1);
  const out = [];

  for (let i = 1; i <= sampleCount; i += 1) {
    const t = Math.min(duration - 0.05, i * step);
    await seekTo(video, t);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    out.push(buildFrameStats(data, t, canvas));
  }

  return out;
}

function seekTo(video, time) {
  return new Promise((resolve, reject) => {
    const onSeek = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error('Video seek failed.'));
    };
    const cleanup = () => {
      video.removeEventListener('seeked', onSeek);
      video.removeEventListener('error', onErr);
    };

    video.addEventListener('seeked', onSeek, { once: true });
    video.addEventListener('error', onErr, { once: true });
    video.currentTime = Math.max(0, time);
  });
}

function buildFrameStats(imageData, timestamp, canvas) {
  const data = imageData.data;
  const pixelCount = data.length / 4;

  let r = 0;
  let g = 0;
  let b = 0;
  let brightnessTotal = 0;
  let edgeLike = 0;

  for (let i = 0; i < data.length; i += 4) {
    const pr = data[i];
    const pg = data[i + 1];
    const pb = data[i + 2];
    const brightness = 0.2126 * pr + 0.7152 * pg + 0.0722 * pb;

    r += pr;
    g += pg;
    b += pb;
    brightnessTotal += brightness;

    if (i > 12) {
      const prev = 0.2126 * data[i - 4] + 0.7152 * data[i - 3] + 0.0722 * data[i - 2];
      if (Math.abs(brightness - prev) > 30) edgeLike += 1;
    }
  }

  const avgR = r / pixelCount;
  const avgG = g / pixelCount;
  const avgB = b / pixelCount;

  return {
    timestamp,
    avgR,
    avgG,
    avgB,
    brightness: brightnessTotal / pixelCount,
    edgeDensity: edgeLike / pixelCount,
    dominant: dominantColor(avgR, avgG, avgB),
    thumb: canvas.toDataURL('image/jpeg', 0.72),
    width: imageData.width,
    height: imageData.height,
    imageData,
  };
}

function dominantColor(r, g, b) {
  if (r > g && r > b) return 'red-toned';
  if (g > r && g > b) return 'green-toned';
  if (b > r && b > g) return 'blue-toned';
  return 'neutral-toned';
}

function summarizeScene(frameStats, duration, fileName) {
  const avgBrightness = mean(frameStats.map((f) => f.brightness));
  const brightnessLabel = avgBrightness < 65 ? 'dark' : avgBrightness > 170 ? 'bright' : 'balanced';

  let motionScore = 0;
  for (let i = 1; i < frameStats.length; i += 1) {
    motionScore +=
      Math.abs(frameStats[i].avgR - frameStats[i - 1].avgR) +
      Math.abs(frameStats[i].avgG - frameStats[i - 1].avgG) +
      Math.abs(frameStats[i].avgB - frameStats[i - 1].avgB);
  }
  motionScore /= Math.max(1, frameStats.length - 1);

  const motionLabel = motionScore < 8 ? 'low motion' : motionScore > 22 ? 'high motion' : 'moderate motion';

  const dominant = frequencyWinner(frameStats.map((f) => f.dominant));
  const insight = `This video appears ${brightnessLabel}, mostly ${dominant}, with ${motionLabel}.`;

  return {
    mode: 'scene',
    fileName,
    duration,
    sampleCount: frameStats.length,
    avgBrightness,
    brightnessLabel,
    motionScore,
    motionLabel,
    dominant,
    insight,
    frames: frameStats,
  };
}

async function runPlateMode(frameStats, duration, fileName) {
  const candidates = [];

  for (const frame of frameStats) {
    const region = detectPlateLikeRegion(frame.imageData);
    if (!region) continue;

    const plateThumb = cropToDataURL(frame.imageData, region);
    const confidence = clamp(Math.round(region.score * 100), 10, 98);

    candidates.push({
      timestamp: frame.timestamp,
      plateThumb,
      confidence,
      text: 'Pending OCR',
      region,
    });
  }

  const ocrTargets = [...candidates]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);

  for (const item of ocrTargets) {
    item.text = await recognizePlateText(item.plateThumb);
  }

  const best = [...candidates].sort((a, b) => b.confidence - a.confidence)[0] || null;
  const foundCount = candidates.length;
  const uniqueReads = [...new Set(candidates.map((c) => c.text).filter((t) => t && t !== 'Pending OCR'))];

  const insight = best
    ? `Potential plates found in ${foundCount} sampled frame(s). Best read: ${best.text || 'unreadable'} (${best.confidence}% confidence).`
    : 'No strong license-plate-like regions were detected in the sampled frames.';

  return {
    mode: 'lpr',
    fileName,
    duration,
    sampleCount: frameStats.length,
    foundCount,
    uniqueReads,
    best,
    candidates,
    insight,
  };
}

function detectPlateLikeRegion(imageData) {
  const { width, height, data } = imageData;
  const blockW = Math.max(28, Math.floor(width / 9));
  const blockH = Math.max(14, Math.floor(height / 12));

  let best = null;

  for (let y = 0; y <= height - blockH; y += Math.max(8, Math.floor(blockH / 3))) {
    for (let x = 0; x <= width - blockW; x += Math.max(8, Math.floor(blockW / 3))) {
      const score = regionPlateScore(data, width, x, y, blockW, blockH);
      const aspect = blockW / blockH;
      if (aspect < 2 || aspect > 6.2) continue;

      if (!best || score > best.score) {
        best = { x, y, w: blockW, h: blockH, score };
      }
    }
  }

  if (!best || best.score < 0.22) return null;
  return best;
}

function regionPlateScore(data, width, x, y, w, h) {
  let edgeCount = 0;
  let brightCount = 0;
  let darkCount = 0;
  let total = 0;

  for (let row = y; row < y + h; row += 1) {
    for (let col = x; col < x + w; col += 1) {
      const i = (row * width + col) * 4;
      const p = luminance(data[i], data[i + 1], data[i + 2]);
      total += 1;

      if (p > 180) brightCount += 1;
      if (p < 70) darkCount += 1;

      if (col > x) {
        const j = (row * width + (col - 1)) * 4;
        const left = luminance(data[j], data[j + 1], data[j + 2]);
        if (Math.abs(p - left) > 38) edgeCount += 1;
      }
    }
  }

  const contrastMix = Math.min(brightCount, darkCount) / Math.max(1, total * 0.5);
  const edgeDensity = edgeCount / Math.max(1, total);

  return edgeDensity * 0.65 + contrastMix * 0.35;
}

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function cropToDataURL(imageData, region) {
  const srcCanvas = document.createElement('canvas');
  const srcCtx = srcCanvas.getContext('2d');
  srcCanvas.width = imageData.width;
  srcCanvas.height = imageData.height;
  srcCtx.putImageData(imageData, 0, 0);

  const outCanvas = document.createElement('canvas');
  outCanvas.width = region.w;
  outCanvas.height = region.h;
  const outCtx = outCanvas.getContext('2d');
  outCtx.drawImage(srcCanvas, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h);

  return outCanvas.toDataURL('image/jpeg', 0.85);
}

async function recognizePlateText(dataUrl) {
  try {
    const worker = await getOcrWorker();
    if (!worker) return 'OCR unavailable';

    const { data } = await worker.recognize(dataUrl);
    const best = (data.text || '').replace(/[^A-Z0-9\- ]/gi, '').trim().toUpperCase();

    if (!best) return 'Unreadable';
    return best.slice(0, 12);
  } catch {
    return 'Unreadable';
  }
}

async function getOcrWorker() {
  if (ocrWorkerPromise) return ocrWorkerPromise;

  ocrWorkerPromise = (async () => {
    if (!window.Tesseract) {
      await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
    }

    if (!window.Tesseract) {
      return null;
    }

    const worker = await window.Tesseract.createWorker('eng');
    return worker;
  })();

  return ocrWorkerPromise;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load OCR module.'));
    document.head.appendChild(script);
  });
}

function renderSceneReport(report) {
  resultsTitle.textContent = 'Scene Breakdown';
  resultsPanel.hidden = false;
  framesPanel.hidden = false;
  platesPanel.hidden = true;

  summary.innerHTML = `<p>${escapeHtml(report.insight)}</p>`;
  metrics.innerHTML = [
    `Duration: ${report.duration.toFixed(2)}s`,
    `Sampled frames: ${report.sampleCount}`,
    `Average brightness: ${report.avgBrightness.toFixed(1)} (${report.brightnessLabel})`,
    `Motion score: ${report.motionScore.toFixed(2)} (${report.motionLabel})`,
    `Primary tone: ${report.dominant}`,
  ]
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join('');

  frames.innerHTML = report.frames
    .map((frame) =>
      frameCard(
        frame.thumb,
        `t=${frame.timestamp.toFixed(2)}s · ${frame.dominant} · brightness ${frame.brightness.toFixed(1)}`
      )
    )
    .join('');
}

function renderPlateReport(report) {
  resultsTitle.textContent = 'License Plate Recognition';
  resultsPanel.hidden = false;
  framesPanel.hidden = true;
  platesPanel.hidden = false;

  summary.innerHTML = `<p>${escapeHtml(report.insight)}</p>`;
  metrics.innerHTML = [
    `Duration: ${report.duration.toFixed(2)}s`,
    `Sampled frames: ${report.sampleCount}`,
    `Frames with plate-like regions: ${report.foundCount}`,
    `Unique OCR reads: ${report.uniqueReads.length || 0}`,
    `Best candidate: ${report.best ? report.best.text : 'None'}`,
  ]
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join('');

  if (report.candidates.length === 0) {
    plates.innerHTML = '<p class="panel-note">No plate candidates detected in sampled frames.</p>';
    return;
  }

  plates.innerHTML = report.candidates
    .map(
      (item) => `
      <article class="frame-card">
        <img src="${item.plateThumb}" alt="Detected plate candidate at ${item.timestamp.toFixed(2)} seconds" />
        <div class="frame-caption">
          t=${item.timestamp.toFixed(2)}s · ${escapeHtml(item.text)}
          <div class="plate-badge">confidence ${item.confidence}%</div>
        </div>
      </article>
    `
    )
    .join('');
}

function frameCard(img, caption) {
  return `
    <article class="frame-card">
      <img src="${img}" alt="Sampled frame" />
      <div class="frame-caption">${escapeHtml(caption)}</div>
    </article>
  `;
}

function toSerializableSceneReport(report) {
  return {
    generatedAt: new Date().toISOString(),
    mode: report.mode,
    fileName: report.fileName,
    durationSeconds: Number(report.duration.toFixed(3)),
    sampleCount: report.sampleCount,
    averageBrightness: Number(report.avgBrightness.toFixed(2)),
    brightnessLabel: report.brightnessLabel,
    motionScore: Number(report.motionScore.toFixed(2)),
    motionLabel: report.motionLabel,
    dominantTone: report.dominant,
    insight: report.insight,
    frames: report.frames.map((frame) => ({
      timestampSeconds: Number(frame.timestamp.toFixed(3)),
      brightness: Number(frame.brightness.toFixed(2)),
      dominantTone: frame.dominant,
      edgeDensity: Number(frame.edgeDensity.toFixed(4)),
      averageRGB: {
        r: Number(frame.avgR.toFixed(2)),
        g: Number(frame.avgG.toFixed(2)),
        b: Number(frame.avgB.toFixed(2)),
      },
    })),
  };
}

function toSerializablePlateReport(report) {
  return {
    generatedAt: new Date().toISOString(),
    mode: report.mode,
    fileName: report.fileName,
    durationSeconds: Number(report.duration.toFixed(3)),
    sampleCount: report.sampleCount,
    framesWithPlateLikeRegions: report.foundCount,
    uniqueOcrReads: report.uniqueReads,
    bestCandidate: report.best
      ? {
          timestampSeconds: Number(report.best.timestamp.toFixed(3)),
          confidence: report.best.confidence,
          text: report.best.text,
          region: report.best.region,
        }
      : null,
    candidates: report.candidates.map((item) => ({
      timestampSeconds: Number(item.timestamp.toFixed(3)),
      confidence: item.confidence,
      text: item.text,
      region: item.region,
    })),
    insight: report.insight,
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
}

function frequencyWinner(values) {
  const counts = values.reduce((acc, value) => {
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});

  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'neutral-toned';
}
