const MODEL_URL = "https://justadudewhohacks.github.io/face-api.js/models";
const BLUR_CIRCLE_VALUE = "__blur_circle__";
const DETECTION_PASSES = [
  { inputSize: 608, scoreThreshold: 0.18 },
  { inputSize: 512, scoreThreshold: 0.22 },
  { inputSize: 416, scoreThreshold: 0.28 },
];
const TILE_DETECTION_PASSES = [
  { inputSize: 608, scoreThreshold: 0.14 },
  { inputSize: 512, scoreThreshold: 0.18 },
];
const TILE_SCAN_MIN_LONG_EDGE = 1400;
const TILE_SCAN_CONFIG = {
  initialTileSize: 1200,
  overlapRatio: 0.28,
  maxTiles: 12,
};

const expressionToEmoji = {
  neutral: "🙂",
  happy: "😄",
  sad: "😢",
  angry: "😡",
  fearful: "😲",
  disgusted: "😡",
  surprised: "😲",
};

const state = {
  modelsReady: false,
  image: null,
  fileName: "facetoemoji",
  faces: [],
  selectedFaceId: null,
  editMode: false,
  drawing: false,
  drawStart: null,
  draftRect: null,
  editDragging: false,
  editDragMode: null,
  editDragFaceId: null,
  editDragStart: null,
  editDragStartBox: null,
  editDragStartSize: 1,
  defaultEmoji: "🙂",
  defaultOpacity: 1,
  defaultSize: 1,
};

const refs = {
  imageInput: document.getElementById("imageInput"),
  canvasContainer: document.getElementById("canvasContainer"),
  canvasStage: document.getElementById("canvasStage"),
  quickUploadHint: document.getElementById("quickUploadHint"),
  previewActions: document.getElementById("previewActions"),
  replaceImageBtn: document.getElementById("replaceImageBtn"),
  removeImageBtn: document.getElementById("removeImageBtn"),
  previewCanvas: document.getElementById("previewCanvas"),
  overlayCanvas: document.getElementById("overlayCanvas"),
  statusText: document.getElementById("statusText"),
  detectBtn: document.getElementById("detectBtn"),
  clearBtn: document.getElementById("clearBtn"),
  editBtn: document.getElementById("editBtn"),
  emojiSelect: document.getElementById("emojiSelect"),
  opacityRange: document.getElementById("opacityRange"),
  opacityValue: document.getElementById("opacityValue"),
  sizeRange: document.getElementById("sizeRange"),
  sizeValue: document.getElementById("sizeValue"),
  deleteSelectedBtn: document.getElementById("deleteSelectedBtn"),
  selectedFaceMeta: document.getElementById("selectedFaceMeta"),
  downloadBtn: document.getElementById("downloadBtn"),
};

const previewCtx = refs.previewCanvas.getContext("2d");
const overlayCtx = refs.overlayCanvas.getContext("2d");

function setStatus(text, isError = false) {
  refs.statusText.textContent = text;
  refs.statusText.style.color = isError ? "#c2343d" : "#697185";
}

function makeFaceId() {
  if (crypto?.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clampOpacity(value) {
  if (Number.isNaN(value)) {
    return 1;
  }
  return Math.min(1, Math.max(0, value));
}

function opacityToPercent(opacity) {
  return Math.round(clampOpacity(opacity) * 100);
}

function getStickerDisplayLabel(sticker) {
  if (sticker === BLUR_CIRCLE_VALUE) {
    return "Blur";
  }
  return sticker || "🙂";
}

function clampSize(value) {
  if (Number.isNaN(value)) {
    return 1;
  }
  return Math.min(2.2, Math.max(0.4, value));
}

function sizeToPercent(size) {
  return Math.round(clampSize(size) * 100);
}

function pickExpression(expressions = {}) {
  let max = -1;
  let chosen = "neutral";

  Object.entries(expressions).forEach(([name, score]) => {
    if (score > max) {
      max = score;
      chosen = name;
    }
  });

  return chosen;
}

function getBoxCenter(box) {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

function getBoxIou(boxA, boxB) {
  const left = Math.max(boxA.x, boxB.x);
  const top = Math.max(boxA.y, boxB.y);
  const right = Math.min(boxA.x + boxA.width, boxB.x + boxB.width);
  const bottom = Math.min(boxA.y + boxA.height, boxB.y + boxB.height);
  const intersectionWidth = Math.max(0, right - left);
  const intersectionHeight = Math.max(0, bottom - top);
  const intersectionArea = intersectionWidth * intersectionHeight;

  if (intersectionArea === 0) {
    return 0;
  }

  const areaA = Math.max(1, boxA.width * boxA.height);
  const areaB = Math.max(1, boxB.width * boxB.height);
  const union = areaA + areaB - intersectionArea;
  return union > 0 ? intersectionArea / union : 0;
}

function areBoxesDuplicate(boxA, boxB) {
  const iou = getBoxIou(boxA, boxB);
  if (iou >= 0.35) {
    return true;
  }

  const centerA = getBoxCenter(boxA);
  const centerB = getBoxCenter(boxB);
  const centerDistance = Math.hypot(centerA.x - centerB.x, centerA.y - centerB.y);
  const minSize = Math.max(8, Math.min(boxA.width, boxA.height, boxB.width, boxB.height));
  return centerDistance <= minSize * 0.42;
}

function dedupeDetections(detections) {
  const sorted = [...detections].sort((a, b) => b.score - a.score);
  const merged = [];

  sorted.forEach((candidate) => {
    if (candidate.box.width < 10 || candidate.box.height < 10) {
      return;
    }

    const hasDuplicate = merged.some((kept) => areBoxesDuplicate(kept.box, candidate.box));
    if (!hasDuplicate) {
      merged.push(candidate);
    }
  });

  return merged;
}

function buildUpscaledDetectionSource(image) {
  const longEdge = Math.max(image.width, image.height);
  const upscale = Math.min(2, 2600 / longEdge);
  if (upscale <= 1.05) {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * upscale);
  canvas.height = Math.round(image.height * upscale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { canvas, scale: upscale };
}

async function runDetectionPasses(source, sourceScale = 1, passes = DETECTION_PASSES) {
  let allDetections = [];

  for (const pass of passes) {
    const options = new faceapi.TinyFaceDetectorOptions({
      inputSize: pass.inputSize,
      scoreThreshold: pass.scoreThreshold,
    });

    try {
      const detections = await faceapi.detectAllFaces(source, options).withFaceExpressions();
      const normalized = detections.map((det) => ({
        box: {
          x: det.detection.box.x / sourceScale,
          y: det.detection.box.y / sourceScale,
          width: det.detection.box.width / sourceScale,
          height: det.detection.box.height / sourceScale,
        },
        expressions: det.expressions,
        score: Number(det.detection.score ?? 0),
      }));

      allDetections = allDetections.concat(normalized);
    } catch (error) {
      console.warn("Detection pass failed", pass, error);
    }
  }

  return allDetections;
}

function buildAxisTileStarts(total, tileSize, step) {
  if (total <= tileSize) {
    return [0];
  }

  const starts = [];
  for (let start = 0; start <= total - tileSize; start += step) {
    starts.push(start);
  }

  const lastStart = total - tileSize;
  if (starts[starts.length - 1] !== lastStart) {
    starts.push(lastStart);
  }

  return starts;
}

function buildTileRegions(width, height, config = TILE_SCAN_CONFIG) {
  const longEdge = Math.max(width, height);
  let tileSize = Math.min(config.initialTileSize, longEdge);

  while (true) {
    const step = Math.max(120, Math.round(tileSize * (1 - config.overlapRatio)));
    const xStarts = buildAxisTileStarts(width, tileSize, step);
    const yStarts = buildAxisTileStarts(height, tileSize, step);

    const regions = [];
    yStarts.forEach((y) => {
      xStarts.forEach((x) => {
        regions.push({
          x,
          y,
          width: Math.min(tileSize, width - x),
          height: Math.min(tileSize, height - y),
        });
      });
    });

    if (regions.length <= config.maxTiles || tileSize >= longEdge) {
      return regions;
    }

    tileSize = Math.min(Math.round(tileSize * 1.2), longEdge);
  }
}

function shouldRunTileScan(image, baselineDetectionCount) {
  const longEdge = Math.max(image.width, image.height);
  if (longEdge < TILE_SCAN_MIN_LONG_EDGE) {
    return false;
  }

  const expectedFaces = Math.max(10, Math.round(longEdge / 180));
  return baselineDetectionCount < expectedFaces;
}

async function runTiledDetectionPasses(image) {
  const regions = buildTileRegions(image.width, image.height);
  if (regions.length === 0) {
    return [];
  }

  const tileCanvas = document.createElement("canvas");
  const tileCtx = tileCanvas.getContext("2d");
  if (!tileCtx) {
    return [];
  }

  const candidates = [];

  for (const region of regions) {
    tileCanvas.width = region.width;
    tileCanvas.height = region.height;
    tileCtx.clearRect(0, 0, region.width, region.height);
    tileCtx.drawImage(
      image,
      region.x,
      region.y,
      region.width,
      region.height,
      0,
      0,
      region.width,
      region.height,
    );

    const tileDetections = await runDetectionPasses(tileCanvas, 1, TILE_DETECTION_PASSES);
    const edgePadding = Math.max(6, Math.min(region.width, region.height) * 0.03);

    tileDetections.forEach((det) => {
      const center = getBoxCenter(det.box);
      const nearLeftEdge = center.x < edgePadding;
      const nearRightEdge = center.x > region.width - edgePadding;
      const nearTopEdge = center.y < edgePadding;
      const nearBottomEdge = center.y > region.height - edgePadding;

      if (nearLeftEdge && region.x > 0) {
        return;
      }
      if (nearRightEdge && region.x + region.width < image.width) {
        return;
      }
      if (nearTopEdge && region.y > 0) {
        return;
      }
      if (nearBottomEdge && region.y + region.height < image.height) {
        return;
      }

      candidates.push({
        ...det,
        box: {
          x: det.box.x + region.x,
          y: det.box.y + region.y,
          width: det.box.width,
          height: det.box.height,
        },
      });
    });
  }

  return candidates;
}

function getSelectedFace() {
  return state.faces.find((face) => face.id === state.selectedFaceId) || null;
}

function updateOverlayCursor() {
  refs.overlayCanvas.style.cursor = state.editMode ? "crosshair" : "pointer";
}

function syncQuickUploadHint() {
  const hasImage = Boolean(state.image);
  refs.quickUploadHint.style.display = hasImage ? "none" : "grid";
  refs.previewActions.style.display = hasImage ? "flex" : "none";
}

function syncOpacityControl(opacity) {
  const value = opacityToPercent(opacity);
  refs.opacityRange.value = String(value);
  refs.opacityValue.textContent = `${value}%`;
}

function syncSizeControl(size) {
  const value = sizeToPercent(size);
  refs.sizeRange.value = String(value);
  refs.sizeValue.textContent = `${value}%`;
}

function setEditMode(active, announce = true) {
  state.editMode = active;
  refs.editBtn.classList.toggle("active", active);
  updateOverlayCursor();
  syncControlsForSelection();

  if (!announce) {
    return;
  }

  if (active) {
    setStatus("Edit mode on: drag empty space to add, or click sticker to move/resize.");
    return;
  }

  setStatus("Edit mode off.");
}

function syncControlsForSelection() {
  const selected = getSelectedFace();

  if (!state.editMode) {
    refs.selectedFaceMeta.textContent = "Turn on Edit to add stickers, then click one to move or resize.";
    refs.emojiSelect.value = state.defaultEmoji;
    refs.emojiSelect.disabled = true;
    refs.opacityRange.disabled = true;
    refs.sizeRange.disabled = true;
    refs.deleteSelectedBtn.disabled = true;
    syncOpacityControl(state.defaultOpacity);
    syncSizeControl(state.defaultSize);
    return;
  }

  refs.emojiSelect.disabled = false;
  refs.emojiSelect.value = selected ? selected.emoji : state.defaultEmoji;

  if (!selected) {
    refs.selectedFaceMeta.textContent = "Edit mode on. Drag empty space to add sticker, or click one to move/resize.";
    refs.opacityRange.disabled = true;
    refs.sizeRange.disabled = true;
    refs.deleteSelectedBtn.disabled = true;
    syncOpacityControl(state.defaultOpacity);
    syncSizeControl(state.defaultSize);
    return;
  }

  refs.selectedFaceMeta.textContent = `Selected face / Style ${getStickerDisplayLabel(selected.emoji)} / Opacity ${opacityToPercent(selected.opacity)}% / Size ${sizeToPercent(selected.size)}%`;
  refs.opacityRange.disabled = false;
  refs.sizeRange.disabled = false;
  refs.deleteSelectedBtn.disabled = false;
  syncOpacityControl(selected.opacity);
  syncSizeControl(selected.size);
}

function syncCanvasStageSize(imageWidth) {
  const containerWidth = refs.canvasContainer.getBoundingClientRect().width;
  const availableWidth = Math.max(220, containerWidth - 20);
  const stageWidth = Math.min(imageWidth, availableWidth);
  refs.canvasStage.style.width = `${stageWidth}px`;
}

function resizeCanvases(width, height) {
  refs.previewCanvas.width = width;
  refs.previewCanvas.height = height;
  refs.overlayCanvas.width = width;
  refs.overlayCanvas.height = height;
  syncCanvasStageSize(width);
}

function clearLoadedImage() {
  state.image = null;
  state.fileName = "facetoemoji";
  state.faces = [];
  state.selectedFaceId = null;
  state.drawing = false;
  state.drawStart = null;
  state.draftRect = null;
  refs.imageInput.value = "";
  refs.previewCanvas.width = 0;
  refs.previewCanvas.height = 0;
  refs.overlayCanvas.width = 0;
  refs.overlayCanvas.height = 0;
  refs.canvasStage.style.width = "100%";
  setEditMode(false, false);
  renderAll();
  setStatus("");
}

function normalizeBox(box) {
  const maxWidth = refs.previewCanvas.width;
  const maxHeight = refs.previewCanvas.height;
  const x = Math.max(0, box.x);
  const y = Math.max(0, box.y);
  const width = Math.min(box.width, maxWidth - x);
  const height = Math.min(box.height, maxHeight - y);

  return {
    x,
    y,
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}

function createFace({ box, emoji, opacity, size = 1, expression = "neutral", manual = false }) {
  return {
    id: makeFaceId(),
    box: normalizeBox(box),
    emoji,
    opacity: clampOpacity(opacity),
    size: clampSize(size),
    expression,
    manual,
  };
}

function drawEmojiSticker(ctx, face) {
  const { x, y, width, height } = face.box;
  const cx = x + width / 2;
  const cy = y + height / 2;

  if (face.emoji === BLUR_CIRCLE_VALUE && state.image) {
    const blurScale = clampSize(face.size ?? 1);
    const radius = Math.max(12, (Math.min(width, height) / 2) * blurScale);
    const blurStrength = Math.max(8, Math.min(42, Math.round(radius * 0.22)));

    ctx.save();
    ctx.globalAlpha = clampOpacity(face.opacity);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.filter = `blur(${blurStrength}px)`;
    ctx.drawImage(state.image, 0, 0);
    ctx.filter = "none";
    ctx.restore();
    return;
  }

  const fontSize = Math.max(20, Math.min(width, height) * 0.86) * clampSize(face.size ?? 1);

  ctx.save();
  ctx.globalAlpha = clampOpacity(face.opacity);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${fontSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  ctx.fillText(face.emoji || "🙂", cx, cy + fontSize * 0.03);
  ctx.restore();
}

function drawWatermark(ctx) {
  const text = "FaceToEmoji";
  const minSide = Math.min(refs.previewCanvas.width, refs.previewCanvas.height);
  const fontSize = Math.max(14, Math.min(64, minSide * 0.035));
  const margin = Math.max(10, Math.min(28, minSide * 0.018));

  ctx.save();
  ctx.font = `700 ${fontSize}px Inter, "Segoe UI", sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "rgba(255, 255, 255, 0.62)";
  ctx.shadowColor = "rgba(0, 0, 0, 0.38)";
  ctx.shadowBlur = Math.max(2, fontSize * 0.12);
  ctx.fillText(text, margin, refs.previewCanvas.height - margin);
  ctx.restore();
}

function drawPreview() {
  previewCtx.clearRect(0, 0, refs.previewCanvas.width, refs.previewCanvas.height);
  if (!state.image) {
    return;
  }

  previewCtx.drawImage(state.image, 0, 0);
  state.faces.forEach((face) => drawEmojiSticker(previewCtx, face));
  drawWatermark(previewCtx);
}

function drawFaceOutline(face, index) {
  const { x, y, width, height } = face.box;
  const selected = face.id === state.selectedFaceId;

  overlayCtx.save();
  overlayCtx.strokeStyle = selected ? "#2f58f0" : "#20a960";
  overlayCtx.lineWidth = selected ? 3 : 2;
  overlayCtx.strokeRect(x, y, width, height);

  const label = `${index + 1} · ${getStickerDisplayLabel(face.emoji)} · ${opacityToPercent(face.opacity)}%`;
  overlayCtx.font = "15px sans-serif";
  const metrics = overlayCtx.measureText(label);
  const labelWidth = metrics.width + 10;
  const labelHeight = 22;
  const labelX = x;
  const labelY = Math.max(0, y - labelHeight - 4);

  overlayCtx.fillStyle = "rgba(15,22,40,0.76)";
  overlayCtx.fillRect(labelX, labelY, labelWidth, labelHeight);
  overlayCtx.fillStyle = "#fff";
  overlayCtx.textBaseline = "middle";
  overlayCtx.fillText(label, labelX + 5, labelY + labelHeight / 2);

  if (state.editMode && selected) {
    const handle = getResizeHandleRect(face);
    overlayCtx.fillStyle = "#ffffff";
    overlayCtx.strokeStyle = "#2f58f0";
    overlayCtx.lineWidth = 2;
    overlayCtx.fillRect(handle.x, handle.y, handle.width, handle.height);
    overlayCtx.strokeRect(handle.x, handle.y, handle.width, handle.height);
  }

  overlayCtx.restore();
}

function drawDraftRect() {
  if (!state.draftRect) {
    return;
  }

  const { x, y, width, height } = state.draftRect;
  overlayCtx.save();
  overlayCtx.strokeStyle = "#2f58f0";
  overlayCtx.setLineDash([6, 4]);
  overlayCtx.lineWidth = 2;
  overlayCtx.strokeRect(x, y, width, height);
  overlayCtx.restore();
}

function drawOverlay() {
  overlayCtx.clearRect(0, 0, refs.overlayCanvas.width, refs.overlayCanvas.height);
  if (!state.image) {
    return;
  }
  state.faces.forEach(drawFaceOutline);
  drawDraftRect();
}

function renderAll() {
  syncQuickUploadHint();
  drawPreview();
  drawOverlay();
  syncControlsForSelection();
}

async function detectFaces() {
  if (!state.modelsReady) {
    setStatus("AI models are still loading. Please wait.", true);
    return;
  }
  if (!state.image) {
    setStatus("Quick upload an image first.", true);
    return;
  }

  setStatus("Detecting faces (multi-pass for small faces)...");
  try {
    let detectionCandidates = await runDetectionPasses(state.image, 1, DETECTION_PASSES);

    const upscaledSource = buildUpscaledDetectionSource(state.image);
    if (upscaledSource) {
      const upscaledDetections = await runDetectionPasses(upscaledSource.canvas, upscaledSource.scale, DETECTION_PASSES);
      detectionCandidates = detectionCandidates.concat(upscaledDetections);
    }

    const baselineDetections = dedupeDetections(detectionCandidates);
    if (shouldRunTileScan(state.image, baselineDetections.length)) {
      setStatus("Detecting small faces with tile scan...");
      const tileDetections = await runTiledDetectionPasses(state.image);
      detectionCandidates = detectionCandidates.concat(tileDetections);
    }

    const mergedDetections = dedupeDetections(detectionCandidates);

    state.faces = mergedDetections.map((det) => {
      const expression = pickExpression(det.expressions);
      const emoji = expressionToEmoji[expression] || state.defaultEmoji;
      return createFace({
        box: det.box,
        expression,
        emoji,
        opacity: state.defaultOpacity,
        size: state.defaultSize,
      });
    });

    state.selectedFaceId = state.faces[0]?.id ?? null;
    renderAll();

    if (state.faces.length === 0) {
      setStatus("No faces detected. Turn on Edit and drag to add one manually.");
      return;
    }

    setStatus(`Auto detected ${state.faces.length} face(s).`);
  } catch (error) {
    console.error(error);
    setStatus("Detection failed. Please try another photo.", true);
  }
}

function findFaceAtPoint(x, y) {
  for (let i = state.faces.length - 1; i >= 0; i -= 1) {
    const { box } = state.faces[i];
    if (x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) {
      return state.faces[i];
    }
  }
  return null;
}

function toCanvasPoint(pointerEvent) {
  const rect = refs.overlayCanvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return { x: 0, y: 0 };
  }
  const scaleX = refs.overlayCanvas.width / rect.width;
  const scaleY = refs.overlayCanvas.height / rect.height;
  return {
    x: (pointerEvent.clientX - rect.left) * scaleX,
    y: (pointerEvent.clientY - rect.top) * scaleY,
  };
}

function buildDraftRect(start, point, lockSquare = false) {
  const deltaX = point.x - start.x;
  const deltaY = point.y - start.y;
  const baseWidth = Math.abs(deltaX);
  const baseHeight = Math.abs(deltaY);

  let width = baseWidth;
  let height = baseHeight;

  if (lockSquare) {
    const side = Math.min(baseWidth, baseHeight);
    width = side;
    height = side;
  }

  const x = deltaX < 0 ? start.x - width : start.x;
  const y = deltaY < 0 ? start.y - height : start.y;

  return { x, y, width, height };
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to read image file."));
    };
    image.src = url;
  });
}

async function onFileSelected(file) {
  if (!file) {
    return;
  }
  if (!file.type.startsWith("image/")) {
    setStatus("Please upload an image file.", true);
    return;
  }

  try {
    setStatus("Loading image...");
    const image = await loadImageFromFile(file);
    state.image = image;
    state.fileName = file.name.replace(/\.[^.]+$/, "") || "facetoemoji";
    state.faces = [];
    state.selectedFaceId = null;
    state.draftRect = null;
    resizeCanvases(image.width, image.height);
    renderAll();
    await detectFaces();
  } catch (error) {
    console.error(error);
    setStatus("Image upload failed.", true);
  } finally {
    refs.imageInput.value = "";
  }
}

function setupQuickUploadArea() {
  refs.imageInput.addEventListener("change", (event) => {
    const [file] = event.target.files || [];
    onFileSelected(file);
  });

  refs.replaceImageBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    refs.imageInput.click();
  });

  refs.removeImageBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!state.image) {
      return;
    }
    clearLoadedImage();
  });

  refs.canvasContainer.addEventListener("click", () => {
    if (!state.image) {
      refs.imageInput.click();
    }
  });

  refs.canvasContainer.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && !state.image) {
      event.preventDefault();
      refs.imageInput.click();
    }
  });

  refs.canvasContainer.addEventListener("dragover", (event) => {
    event.preventDefault();
    refs.canvasContainer.classList.add("dragover");
  });

  refs.canvasContainer.addEventListener("dragleave", () => {
    refs.canvasContainer.classList.remove("dragover");
  });

  refs.canvasContainer.addEventListener("drop", (event) => {
    event.preventDefault();
    refs.canvasContainer.classList.remove("dragover");
    const [file] = event.dataTransfer?.files || [];
    onFileSelected(file);
  });
}

function getFaceById(faceId) {
  return state.faces.find((face) => face.id === faceId) || null;
}

function getResizeHandleRect(face) {
  const handleSize = 14;
  return {
    x: face.box.x + face.box.width - handleSize / 2,
    y: face.box.y + face.box.height - handleSize / 2,
    width: handleSize,
    height: handleSize,
  };
}

function isPointInRect(point, rect) {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function setupCanvasInteractions() {
  refs.overlayCanvas.addEventListener("pointerdown", (event) => {
    if (!state.image) {
      return;
    }

    const point = toCanvasPoint(event);
    const targetFace = findFaceAtPoint(point.x, point.y);

    if (!state.editMode) {
      state.selectedFaceId = targetFace?.id ?? null;
      renderAll();
      if (targetFace) {
        setStatus("Sticker selected. Turn on Edit to move, resize, or change style.");
      } else {
        setStatus("Turn on Edit to drag and add a sticker.");
      }
      return;
    }

    if (targetFace) {
      state.selectedFaceId = targetFace.id;
      const handleRect = getResizeHandleRect(targetFace);
      state.editDragging = true;
      state.editDragMode = isPointInRect(point, handleRect) ? "resize" : "move";
      state.editDragFaceId = targetFace.id;
      state.editDragStart = point;
      state.editDragStartBox = { ...targetFace.box };
      state.editDragStartSize = targetFace.size ?? 1;

      refs.overlayCanvas.setPointerCapture(event.pointerId);
      renderAll();
      setStatus(state.editDragMode === "resize" ? "Drag corner to resize selected sticker." : "Drag selected sticker to move.");
      return;
    }

    state.selectedFaceId = null;
    refs.overlayCanvas.setPointerCapture(event.pointerId);
    state.drawing = true;
    state.drawStart = point;
    state.draftRect = { x: point.x, y: point.y, width: 0, height: 0 };
    renderAll();
    setStatus("Drag to place a new sticker.");
  });

  refs.overlayCanvas.addEventListener("pointermove", (event) => {
    const point = toCanvasPoint(event);

    if (state.editDragging && state.editDragStart && state.editDragFaceId) {
      const targetFace = getFaceById(state.editDragFaceId);
      if (!targetFace) {
        return;
      }

      if (state.editDragMode === "move") {
        const dx = point.x - state.editDragStart.x;
        const dy = point.y - state.editDragStart.y;
        const maxX = Math.max(0, refs.previewCanvas.width - state.editDragStartBox.width);
        const maxY = Math.max(0, refs.previewCanvas.height - state.editDragStartBox.height);
        targetFace.box.x = Math.min(maxX, Math.max(0, state.editDragStartBox.x + dx));
        targetFace.box.y = Math.min(maxY, Math.max(0, state.editDragStartBox.y + dy));
      } else if (state.editDragMode === "resize") {
        const centerX = state.editDragStartBox.x + state.editDragStartBox.width / 2;
        const centerY = state.editDragStartBox.y + state.editDragStartBox.height / 2;
        const startDistance = Math.hypot(state.editDragStart.x - centerX, state.editDragStart.y - centerY) || 1;
        const currentDistance = Math.hypot(point.x - centerX, point.y - centerY);
        const scale = currentDistance / startDistance;
        targetFace.size = clampSize(state.editDragStartSize * scale);
      }

      renderAll();
      return;
    }

    if (!state.drawing || !state.drawStart) {
      return;
    }

    state.draftRect = buildDraftRect(state.drawStart, point);
    drawOverlay();
  });

  refs.overlayCanvas.addEventListener("pointerup", (event) => {
    if (refs.overlayCanvas.hasPointerCapture(event.pointerId)) {
      refs.overlayCanvas.releasePointerCapture(event.pointerId);
    }

    if (state.editDragging) {
      state.editDragging = false;
      state.editDragMode = null;
      state.editDragFaceId = null;
      state.editDragStart = null;
      state.editDragStartBox = null;
      state.editDragStartSize = 1;
      renderAll();
      setStatus("Selected sticker updated by mouse drag.");
      return;
    }

    if (!state.drawing) {
      return;
    }

    state.drawing = false;

    if (state.draftRect && state.draftRect.width >= 20 && state.draftRect.height >= 20) {
      const face = createFace({
        box: state.draftRect,
        emoji: state.defaultEmoji,
        opacity: state.defaultOpacity,
        size: state.defaultSize,
        expression: "manual",
      });
      state.faces.push(face);
      state.selectedFaceId = face.id;
      setStatus("Sticker added by drag.");
    }

    state.drawStart = null;
    state.draftRect = null;
    renderAll();
  });

  refs.overlayCanvas.addEventListener("pointercancel", () => {
    if (state.editDragging) {
      state.editDragging = false;
      state.editDragMode = null;
      state.editDragFaceId = null;
      state.editDragStart = null;
      state.editDragStartBox = null;
      state.editDragStartSize = 1;
    }

    if (state.drawing) {
      state.drawing = false;
      state.drawStart = null;
      state.draftRect = null;
    }

    drawOverlay();
  });

  refs.overlayCanvas.addEventListener(
    "wheel",
    (event) => {
      if (!state.image) {
        return;
      }

      event.preventDefault();

      if (!state.editMode) {
        setStatus("Turn on Edit first to adjust opacity with wheel.");
        return;
      }

      const selected = getSelectedFace();
      if (!selected) {
        setStatus("Click a sticker first, then use wheel to adjust opacity.");
        return;
      }

      const step = 0.02;
      const delta = event.deltaY < 0 ? step : -step;
      selected.opacity = clampOpacity(selected.opacity + delta);
      renderAll();
    },
    { passive: false },
  );
}

function setupControlEvents() {
  refs.detectBtn.addEventListener("click", () => {
    detectFaces();
  });

  refs.editBtn.addEventListener("click", () => {
    setEditMode(!state.editMode);
  });

  refs.clearBtn.addEventListener("click", () => {
    state.faces = [];
    state.selectedFaceId = null;
    state.draftRect = null;
    state.drawing = false;
    state.editDragging = false;
    renderAll();
    setStatus("Stickers reset.");
  });

  refs.emojiSelect.addEventListener("change", (event) => {
    if (!state.editMode) {
      syncControlsForSelection();
      setStatus("Turn on Edit first to change sticker style.");
      return;
    }

    const emoji = event.target.value;
    state.defaultEmoji = emoji;

    const selected = getSelectedFace();
    if (!selected) {
      syncControlsForSelection();
      setStatus("Sticker style set. Drag on preview to add it.");
      return;
    }

    selected.emoji = emoji;
    renderAll();
    setStatus("Selected sticker style updated.");
  });

  refs.opacityRange.addEventListener("input", (event) => {
    if (!state.editMode) {
      syncControlsForSelection();
      setStatus("Turn on Edit first to adjust opacity.");
      return;
    }

    const selected = getSelectedFace();
    if (!selected) {
      syncControlsForSelection();
      setStatus("Click one sticker first to adjust opacity.");
      return;
    }

    const opacity = clampOpacity(Number(event.target.value) / 100);
    selected.opacity = opacity;
    renderAll();
  });

  refs.sizeRange.addEventListener("input", (event) => {
    if (!state.editMode) {
      syncControlsForSelection();
      setStatus("Turn on Edit first to adjust size.");
      return;
    }

    const selected = getSelectedFace();
    if (!selected) {
      syncControlsForSelection();
      setStatus("Click one sticker first to adjust size.");
      return;
    }

    const size = clampSize(Number(event.target.value) / 100);
    selected.size = size;
    renderAll();
  });

  refs.deleteSelectedBtn.addEventListener("click", () => {
    if (!state.editMode) {
      setStatus("Turn on Edit first to delete stickers.");
      return;
    }

    const selected = getSelectedFace();
    if (!selected) {
      setStatus("Click one sticker first to delete.");
      return;
    }

    state.faces = state.faces.filter((face) => face.id !== selected.id);
    state.selectedFaceId = state.faces[0]?.id ?? null;
    renderAll();
    setStatus("Selected sticker deleted.");
  });

  refs.downloadBtn.addEventListener("click", () => {
    if (!state.image) {
      setStatus("No edited image to download yet.", true);
      return;
    }
    drawPreview();
    const link = document.createElement("a");
    link.href = refs.previewCanvas.toDataURL("image/png");
    link.download = `${state.fileName}-facetoemoji.png`;
    link.click();
  });
}

async function loadModels() {
  setStatus("Loading AI models...");
  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
    ]);
    state.modelsReady = true;
    setStatus("Models ready. Quick upload in Live Preview.");
  } catch (error) {
    console.error(error);
    setStatus("Failed to load AI models.", true);
  }
}

async function init() {
  refs.canvasStage.style.width = "100%";
  refs.emojiSelect.value = state.defaultEmoji;
  refs.editBtn.classList.remove("active");
  updateOverlayCursor();
  syncSizeControl(state.defaultSize);
  renderAll();

  setupQuickUploadArea();
  setupControlEvents();
  setupCanvasInteractions();

  window.addEventListener("resize", () => {
    if (!state.image) {
      return;
    }
    syncCanvasStageSize(state.image.width);
  });

  await loadModels();
}

window.addEventListener("DOMContentLoaded", init);
