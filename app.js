const MODEL_URL = "https://justadudewhohacks.github.io/face-api.js/models";
const FACE_API_SCRIPT_URL =
  "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js";
const FACE_API_SCRIPT_INTEGRITY =
  "sha384-gzn2n++arkvyhdNLmUf1s6F5NZ8iAbZ7FhIt+Zw7Jlf1n/vNTmZ3+cYr7S4ogyco=";

let faceApiScriptPromise = null;
let modelsLoadPromise = null;

const BLUR_CIRCLE_VALUE = "__blur_circle__";
const TINY_DETECTION_PASSES = [
  { inputSize: 608, scoreThreshold: 0.22 },
  { inputSize: 512, scoreThreshold: 0.26 },
  { inputSize: 416, scoreThreshold: 0.3 },
];
const MOBILE_TINY_DETECTION_PASSES = [{ inputSize: 416, scoreThreshold: 0.3 }];
const SSD_DETECTION_PASSES = [
  { minConfidence: 0.2, maxResults: 180 },
  { minConfidence: 0.15, maxResults: 220 },
];
const MIN_FACE_BOX_SIZE = 10;
const MAX_IMAGE_LONG_EDGE_MOBILE = 720;
const MAX_MOBILE_MEGAPIXELS = 0.7;

const MIN_STICKER_DRAG_SIZE = 12;

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
  ssdModelReady: false,
  image: null,
  fileName: "facetoemoji",
  faces: [],
  selectedFaceId: null,
  selectedFaceIds: [],
  editMode: false,
  drawing: false,
  drawStart: null,
  draftRect: null,
  editDragging: false,
  editDragMode: null,
  editDragFaceId: null,
  editDragFaceIds: [],
  editDragStart: null,
  editDragStartBox: null,
  editDragStartBoxes: {},
  editDragStartSize: 1,
  editDragStartSizes: {},
  defaultEmoji: "🙂",
  defaultOpacity: 1,
  defaultSize: 1,
  isProcessing: false,
  processingGeneration: 0,
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
  titleResetBtn: document.getElementById("titleResetBtn"),
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

function getStickerEmojiForDetection(det) {
  if (isMobileLayout()) {
    return BLUR_CIRCLE_VALUE;
  }
  const expression = pickExpression(det.expressions);
  return expressionToEmoji[expression] || state.defaultEmoji;
}

function normalizeDetectionEntry(det, sourceScale = 1, mirroredWidth = 0) {
  const rawBox = det?.detection?.box;
  if (!rawBox) {
    return null;
  }

  const scaledBox = {
    x: rawBox.x / sourceScale,
    y: rawBox.y / sourceScale,
    width: rawBox.width / sourceScale,
    height: rawBox.height / sourceScale,
  };

  const box = mirroredWidth > 0
    ? {
        x: mirroredWidth - (scaledBox.x + scaledBox.width),
        y: scaledBox.y,
        width: scaledBox.width,
        height: scaledBox.height,
      }
    : scaledBox;

  return {
    box,
    expressions: det.expressions || {},
    score: Number(det?.detection?.score ?? 0),
  };
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
  if (intersectionArea <= 0) {
    return 0;
  }

  const areaA = Math.max(1, boxA.width * boxA.height);
  const areaB = Math.max(1, boxB.width * boxB.height);
  return intersectionArea / (areaA + areaB - intersectionArea);
}

function areBoxesLikelySameFace(boxA, boxB) {
  if (getBoxIou(boxA, boxB) >= 0.32) {
    return true;
  }

  const centerA = getBoxCenter(boxA);
  const centerB = getBoxCenter(boxB);
  const distance = Math.hypot(centerA.x - centerB.x, centerA.y - centerB.y);
  const minDim = Math.max(8, Math.min(boxA.width, boxA.height, boxB.width, boxB.height));
  return distance <= minDim * 0.45;
}

function dedupeDetectionCandidates(candidates) {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const kept = [];

  sorted.forEach((candidate) => {
    if (!candidate?.box) {
      return;
    }

    if (candidate.box.width < MIN_FACE_BOX_SIZE || candidate.box.height < MIN_FACE_BOX_SIZE) {
      return;
    }

    if (kept.some((existing) => areBoxesLikelySameFace(existing.box, candidate.box))) {
      return;
    }

    kept.push(candidate);
  });

  return kept;
}



function yieldToMainThread() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function getTinyDetectionPasses() {
  return isMobileLayout() ? MOBILE_TINY_DETECTION_PASSES : TINY_DETECTION_PASSES;
}

function isMobileLayout() {
  return window.matchMedia("(max-width: 760px), (pointer: coarse)").matches;
}

function normalizeImageForProcessing(image) {
  if (!isMobileLayout()) {
    return image;
  }

  let scale = 1;
  const longEdge = Math.max(image.width, image.height);
  if (longEdge > MAX_IMAGE_LONG_EDGE_MOBILE) {
    scale = Math.min(scale, MAX_IMAGE_LONG_EDGE_MOBILE / longEdge);
  }

  const megapixels = (image.width * image.height) / 1_000_000;
  if (megapixels > MAX_MOBILE_MEGAPIXELS) {
    scale = Math.min(scale, Math.sqrt(MAX_MOBILE_MEGAPIXELS / megapixels));
  }

  if (scale >= 0.999) {
    return image;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return image;
  }
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function shouldRunEnhancedDetection(image, baselineCount) {
  if (isMobileLayout()) {
    return false;
  }

  const longEdge = Math.max(image.width, image.height);
  const shortEdge = Math.max(1, Math.min(image.width, image.height));
  const aspectRatio = longEdge / shortEdge;
  const megapixels = (image.width * image.height) / 1000000;

  if (baselineCount <= 1) {
    return true;
  }

  if (longEdge >= 1500 && baselineCount <= 4) {
    return true;
  }

  if (megapixels < 1.8) {
    return false;
  }

  const expected = Math.max(6, Math.round((longEdge / 260) * Math.min(1.6, aspectRatio)));
  return baselineCount < expected;
}

function buildUpscaledSource(image) {
  const longEdge = Math.max(image.width, image.height);
  const targetLongEdge = Math.min(2600, Math.max(longEdge, 1800));
  const scale = targetLongEdge / longEdge;
  if (scale <= 1.08) {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { canvas, scale };
}

function buildMirroredSource(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function runTinyDetectionPasses(source, sourceScale = 1, mirroredWidth = 0) {
  let candidates = [];
  const passes = getTinyDetectionPasses();
  const withExpressions = !isMobileLayout();

  for (const pass of passes) {
    const options = new faceapi.TinyFaceDetectorOptions({
      inputSize: pass.inputSize,
      scoreThreshold: pass.scoreThreshold,
    });

    try {
      const detector = faceapi.detectAllFaces(source, options);
      const detections = withExpressions ? await detector.withFaceExpressions() : await detector;
      detections.forEach((det) => {
        const normalized = normalizeDetectionEntry(det, sourceScale, mirroredWidth);
        if (normalized) {
          candidates.push(normalized);
        }
      });

      if (isMobileLayout() && candidates.length > 0) {
        break;
      }
    } catch (error) {
      console.warn("Tiny detection pass failed", pass, error);
    }

    if (isMobileLayout()) {
      await yieldToMainThread();
    }
  }

  return candidates;
}

async function runSsdDetectionPasses(source, sourceScale = 1, mirroredWidth = 0) {
  if (!state.ssdModelReady) {
    return [];
  }

  let candidates = [];

  for (const pass of SSD_DETECTION_PASSES) {
    const options = new faceapi.SsdMobilenetv1Options({
      minConfidence: pass.minConfidence,
      maxResults: pass.maxResults,
    });

    try {
      const detections = await faceapi.detectAllFaces(source, options).withFaceExpressions();
      detections.forEach((det) => {
        const normalized = normalizeDetectionEntry(det, sourceScale, mirroredWidth);
        if (normalized) {
          candidates.push(normalized);
        }
      });
    } catch (error) {
      console.warn("SSD detection pass failed", pass, error);
    }
  }

  return candidates;
}

function setSelectedFaces(faceIds = []) {
  const faceIdSet = new Set(faceIds);
  const next = state.faces
    .map((face) => face.id)
    .filter((faceId) => faceIdSet.has(faceId));

  state.selectedFaceIds = next;
  state.selectedFaceId = next[0] ?? null;
}

function isFaceSelected(faceId) {
  return state.selectedFaceIds.includes(faceId);
}

function getSelectedFaces() {
  if (state.selectedFaceIds.length === 0) {
    return [];
  }

  const faceIdSet = new Set(state.selectedFaceIds);
  return state.faces.filter((face) => faceIdSet.has(face.id));
}

function getSelectedFace() {
  return getSelectedFaces()[0] || null;
}

function toggleSelectedFace(faceId) {
  if (!faceId) {
    return;
  }

  if (isFaceSelected(faceId)) {
    setSelectedFaces(state.selectedFaceIds.filter((id) => id !== faceId));
    return;
  }

  setSelectedFaces([...state.selectedFaceIds, faceId]);
}

function updateOverlayCursor() {
  const cursor = state.editMode ? "crosshair" : "pointer";
  refs.canvasStage.style.cursor = cursor;
  refs.overlayCanvas.style.cursor = cursor;
  refs.overlayCanvas.style.touchAction = state.editMode ? "none" : "pan-y";
}

function syncQuickUploadHint() {
  const hasImage = Boolean(state.image);
  refs.quickUploadHint.style.display = hasImage ? "none" : "grid";
  refs.previewActions.style.display = hasImage ? "flex" : "none";
  refs.canvasContainer.classList.toggle("has-image", hasImage);
  if (hasImage) {
    refs.canvasContainer.removeAttribute("role");
    refs.canvasContainer.removeAttribute("tabindex");
    if (isMobileLayout()) {
      syncCanvasStageSize(state.image.width);
    } else {
      refs.canvasStage.style.width = "100%";
    }
  } else {
    refs.canvasContainer.setAttribute("role", "button");
    refs.canvasContainer.setAttribute("tabindex", "0");
    refs.canvasStage.style.width = "100%";
  }
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
  const selectedFaces = getSelectedFaces();
  const selectedCount = selectedFaces.length;
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

  if (selectedCount === 0) {
    refs.emojiSelect.value = state.defaultEmoji;
    refs.selectedFaceMeta.textContent =
      "Edit mode on. Drag on the image to add, or adjust defaults below before placing.";
    refs.opacityRange.disabled = false;
    refs.sizeRange.disabled = false;
    refs.deleteSelectedBtn.disabled = true;
    syncOpacityControl(state.defaultOpacity);
    syncSizeControl(state.defaultSize);
    return;
  }

  const hasSameEmoji = selectedFaces.every((face) => face.emoji === selectedFaces[0].emoji);
  refs.emojiSelect.value = hasSameEmoji ? selectedFaces[0].emoji : state.defaultEmoji;
  refs.opacityRange.disabled = false;
  refs.sizeRange.disabled = false;
  refs.deleteSelectedBtn.disabled = false;

  if (selectedCount === 1 && selected) {
    refs.selectedFaceMeta.textContent = `Selected face / Style ${getStickerDisplayLabel(selected.emoji)} / Opacity ${opacityToPercent(selected.opacity)}% / Size ${sizeToPercent(selected.size)}%`;
    syncOpacityControl(selected.opacity);
    syncSizeControl(selected.size);
    return;
  }

  const averageOpacity = selectedFaces.reduce((sum, face) => sum + clampOpacity(face.opacity), 0) / selectedCount;
  const averageSize = selectedFaces.reduce((sum, face) => sum + clampSize(face.size), 0) / selectedCount;
  refs.selectedFaceMeta.textContent = `Selected ${selectedCount} stickers / Avg Opacity ${opacityToPercent(averageOpacity)}% / Avg Size ${sizeToPercent(averageSize)}%`;
  syncOpacityControl(averageOpacity);
  syncSizeControl(averageSize);
}

let canvasLayoutWidth = 0;

function syncCanvasStageSize(imageWidth) {
  if (!state.image) {
    refs.canvasStage.style.width = "100%";
    refs.canvasStage.style.aspectRatio = "";
    return;
  }

  if (isMobileLayout()) {
    refs.canvasStage.style.width = "100%";
    refs.canvasStage.style.maxWidth = "100%";
    refs.canvasStage.style.aspectRatio = `${state.image.width} / ${state.image.height}`;
    return;
  }

  const containerWidth = refs.canvasContainer.getBoundingClientRect().width;
  const availableWidth = Math.max(220, containerWidth - 20);
  const stageWidth = Math.min(imageWidth, availableWidth);
  refs.canvasStage.style.width = `${stageWidth}px`;
  refs.canvasStage.style.maxWidth = "100%";
  refs.canvasStage.style.aspectRatio = "";
}

function handleWindowLayoutChange() {
  if (!state.image) {
    return;
  }
  if (isMobileLayout()) {
    return;
  }
  const containerWidth = refs.canvasContainer.getBoundingClientRect().width;
  if (Math.abs(containerWidth - canvasLayoutWidth) < 4) {
    return;
  }
  canvasLayoutWidth = containerWidth;
  syncCanvasStageSize(state.image.width);
}

function handleOrientationChange() {
  if (!state.image) {
    return;
  }
  window.setTimeout(() => {
    canvasLayoutWidth = 0;
    syncCanvasStageSize(state.image.width);
  }, 150);
}

function resizeCanvases(width, height) {
  refs.previewCanvas.width = width;
  refs.previewCanvas.height = height;
  refs.overlayCanvas.width = width;
  refs.overlayCanvas.height = height;
  syncCanvasStageSize(width);
}

function clearLoadedImage() {
  if (isMobileLayout() && state.isProcessing) {
    return;
  }
  state.image = null;
  state.fileName = "facetoemoji";
  state.faces = [];
  setSelectedFaces([]);
  state.drawing = false;
  state.drawStart = null;
  state.draftRect = null;
  refs.imageInput.value = "";
  refs.previewCanvas.width = 0;
  refs.previewCanvas.height = 0;
  refs.overlayCanvas.width = 0;
  refs.overlayCanvas.height = 0;
  refs.canvasStage.style.width = "100%";
  refs.canvasStage.style.aspectRatio = "";
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


let canvasFilterBlurSupported;

const blurPatchCanvas = document.createElement("canvas");
const blurPatchCtx = blurPatchCanvas.getContext("2d", { willReadFrequently: true });

function supportsCanvasFilterBlur() {
  if (canvasFilterBlurSupported !== undefined) {
    return canvasFilterBlurSupported;
  }

  try {
    const src = document.createElement("canvas");
    src.width = 5;
    src.height = 5;
    const sctx = src.getContext("2d");
    sctx.fillStyle = "#000";
    sctx.fillRect(0, 0, 5, 5);
    sctx.fillStyle = "#fff";
    sctx.fillRect(2, 2, 1, 1);

    const dest = document.createElement("canvas");
    dest.width = 5;
    dest.height = 5;
    const dctx = dest.getContext("2d");
    dctx.filter = "blur(2px)";
    dctx.drawImage(src, 0, 0);
    dctx.filter = "none";
    const sample = dctx.getImageData(2, 1, 1, 1).data;
    canvasFilterBlurSupported = sample[0] > 12 || sample[1] > 12 || sample[2] > 12;
  } catch {
    canvasFilterBlurSupported = false;
  }

  return canvasFilterBlurSupported;
}

function boxBlurImageData(imageData, width, height, radius) {
  const r = Math.max(1, Math.min(48, Math.floor(radius)));
  let channel = imageData.data;
  const tmp = new Uint8ClampedArray(channel.length);
  const w = width;
  const h = height;

  const blurHorizontal = (input, output) => {
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        let rs = 0;
        let gs = 0;
        let bs = 0;
        let as = 0;
        let count = 0;
        for (let k = -r; k <= r; k += 1) {
          const px = Math.min(w - 1, Math.max(0, x + k));
          const i = (y * w + px) * 4;
          rs += input[i];
          gs += input[i + 1];
          bs += input[i + 2];
          as += input[i + 3];
          count += 1;
        }
        const o = (y * w + x) * 4;
        output[o] = (rs / count) | 0;
        output[o + 1] = (gs / count) | 0;
        output[o + 2] = (bs / count) | 0;
        output[o + 3] = (as / count) | 0;
      }
    }
  };

  const blurVertical = (input, output) => {
    for (let x = 0; x < w; x += 1) {
      for (let y = 0; y < h; y += 1) {
        let rs = 0;
        let gs = 0;
        let bs = 0;
        let as = 0;
        let count = 0;
        for (let k = -r; k <= r; k += 1) {
          const py = Math.min(h - 1, Math.max(0, y + k));
          const i = (py * w + x) * 4;
          rs += input[i];
          gs += input[i + 1];
          bs += input[i + 2];
          as += input[i + 3];
          count += 1;
        }
        const o = (y * w + x) * 4;
        output[o] = (rs / count) | 0;
        output[o + 1] = (gs / count) | 0;
        output[o + 2] = (bs / count) | 0;
        output[o + 3] = (as / count) | 0;
      }
    }
  };

  const blurPasses = isMobileLayout() ? 2 : 3;
  for (let pass = 0; pass < blurPasses; pass += 1) {
    blurHorizontal(channel, tmp);
    blurVertical(tmp, channel);
  }
}

function createBlurredPatch(source, cx, cy, radius, blurStrength) {
  const sourceWidth = source.naturalWidth || source.width;
  const sourceHeight = source.naturalHeight || source.height;
  const pad = Math.ceil(blurStrength * 2.5);
  const left = Math.max(0, Math.floor(cx - radius - pad));
  const top = Math.max(0, Math.floor(cy - radius - pad));
  const right = Math.min(sourceWidth, Math.ceil(cx + radius + pad));
  const bottom = Math.min(sourceHeight, Math.ceil(cy + radius + pad));
  const patchWidth = Math.max(1, right - left);
  const patchHeight = Math.max(1, bottom - top);

  blurPatchCanvas.width = patchWidth;
  blurPatchCanvas.height = patchHeight;
  blurPatchCtx.clearRect(0, 0, patchWidth, patchHeight);
  blurPatchCtx.drawImage(source, left, top, patchWidth, patchHeight, 0, 0, patchWidth, patchHeight);

  const imageData = blurPatchCtx.getImageData(0, 0, patchWidth, patchHeight);
  const stackRadius = Math.max(4, Math.round(blurStrength * 0.45));
  boxBlurImageData(imageData, patchWidth, patchHeight, stackRadius);
  blurPatchCtx.putImageData(imageData, 0, 0);

  return { canvas: blurPatchCanvas, left, top };
}

function drawBlurCircleSticker(ctx, face) {
  const { x, y, width, height } = face.box;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const blurScale = clampSize(face.size ?? 1);
  const radius = Math.max(12, (Math.min(width, height) / 2) * blurScale);
  const blurStrength = Math.max(8, Math.min(42, Math.round(radius * 0.22)));

  ctx.save();
  ctx.globalAlpha = clampOpacity(face.opacity);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();

  if (supportsCanvasFilterBlur()) {
    ctx.filter = `blur(${blurStrength}px)`;
    ctx.drawImage(state.image, 0, 0);
    ctx.filter = "none";
    ctx.restore();
    return;
  }

  const patch = createBlurredPatch(state.image, cx, cy, radius, blurStrength);
  ctx.drawImage(patch.canvas, patch.left, patch.top);
  ctx.restore();
}

function drawEmojiSticker(ctx, face) {
  const { x, y, width, height } = face.box;
  const cx = x + width / 2;
  const cy = y + height / 2;

  if (face.emoji === BLUR_CIRCLE_VALUE && state.image) {
    drawBlurCircleSticker(ctx, face);
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
  const selected = isFaceSelected(face.id);

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

function sanitizeDownloadBaseName(name) {
  const cleaned = String(name || "facetoemoji")
    .replace(/[/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, "-")
    .trim();
  return cleaned.slice(0, 80) || "facetoemoji";
}

function isIosDevice() {
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/i.test(ua)) {
    return true;
  }
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve) => {
    if (!canvas.width || !canvas.height) {
      resolve(null);
      return;
    }
    canvas.toBlob((blob) => resolve(blob), "image/png", 1);
  });
}

function triggerAnchorDownload(url, fileName) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function openBlobInNewTab(url) {
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (opened) {
    return true;
  }

  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
  return true;
}

async function downloadEditedImage() {
  if (!state.image) {
    setStatus("No edited image to download yet.", true);
    return;
  }

  drawPreview();
  const fileName = `${sanitizeDownloadBaseName(state.fileName)}-facetoemoji.png`;
  setStatus("Preparing download...");

  let blob;
  try {
    blob = await canvasToPngBlob(refs.previewCanvas);
  } catch (error) {
    console.error(error);
    setStatus("Could not export image. Try a smaller photo.", true);
    return;
  }

  if (!blob) {
    setStatus("Could not export image. Try a smaller photo.", true);
    return;
  }

  const file = new File([blob], fileName, { type: "image/png" });

  if (isIosDevice() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "FaceToEmoji" });
      setStatus("Tap Save Image in the share sheet.");
      return;
    } catch (error) {
      if (error?.name === "AbortError") {
        setStatus("Share cancelled.");
        return;
      }
      console.warn("navigator.share failed", error);
    }
  }

  const url = URL.createObjectURL(blob);

  try {
    if (!isIosDevice()) {
      triggerAnchorDownload(url, fileName);
      URL.revokeObjectURL(url);
      setStatus("Download started.");
      return;
    }

    openBlobInNewTab(url);
    setStatus("Image opened — long-press and choose Save Image.");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    URL.revokeObjectURL(url);
    console.error(error);
    setStatus("Download failed. Try again.", true);
  }
}


async function detectFaces({ enableEditAfter = false } = {}) {
  const ready = await ensureModelsReady();
  if (!ready) {
    return;
  }
  if (!state.image) {
    setStatus("Quick upload an image first.", true);
    return;
  }

  setStatus(
    isMobileLayout() ? "Detecting faces and applying blur..." : "Detecting faces...",
  );
  try {
    let candidates = await runTinyDetectionPasses(state.image, 1, 0);
    if (isMobileLayout()) {
      await yieldToMainThread();
    }

    const baseline = dedupeDetectionCandidates(candidates);
    if (shouldRunEnhancedDetection(state.image, baseline.length)) {
      if (isMobileLayout()) {
        const mirrored = buildMirroredSource(state.image);
        if (mirrored) {
          const tinyMirrored = await runTinyDetectionPasses(mirrored, 1, state.image.width);
          candidates = candidates.concat(tinyMirrored);
        }
      } else {
        const upscaled = buildUpscaledSource(state.image);
        if (upscaled) {
          const tinyUpscaled = await runTinyDetectionPasses(upscaled.canvas, upscaled.scale, 0);
          candidates = candidates.concat(tinyUpscaled);

          const ssdUpscaled = await runSsdDetectionPasses(upscaled.canvas, upscaled.scale, 0);
          candidates = candidates.concat(ssdUpscaled);
        }

        const mirrored = buildMirroredSource(state.image);
        if (mirrored) {
          const tinyMirrored = await runTinyDetectionPasses(mirrored, 1, state.image.width);
          candidates = candidates.concat(tinyMirrored);
        }

        const ssdBase = await runSsdDetectionPasses(state.image, 1, 0);
        candidates = candidates.concat(ssdBase);
      }
    }

    const merged = dedupeDetectionCandidates(candidates);

    state.faces = merged.map((det) => {
      const expression = isMobileLayout() ? "neutral" : pickExpression(det.expressions);
      const emoji = getStickerEmojiForDetection(det);
      return createFace({
        box: det.box,
        expression,
        emoji,
        opacity: state.defaultOpacity,
        size: state.defaultSize,
      });
    });

    setSelectedFaces(state.faces[0] ? [state.faces[0].id] : []);
    renderAll();

    if (state.faces.length === 0) {
      if (enableEditAfter) {
        setEditMode(true);
        setStatus("No faces detected. Edit mode is on — drag on the image to add a sticker.");
      } else if (isMobileLayout()) {
        setEditMode(true);
        setStatus("No faces detected. Edit mode is on — drag on the image to add blur.");
      } else {
        setStatus("No faces detected. Turn on Edit and drag to add one manually.");
      }
      return;
    }

    if (enableEditAfter) {
      setEditMode(true);
      setStatus(`Auto detected ${state.faces.length} face(s). Edit mode is on — drag stickers to adjust.`);
    } else if (isMobileLayout()) {
      setStatus(
        `Blurred ${state.faces.length} face(s). Tap Download, or Edit to adjust stickers.`,
      );
    } else {
      setStatus(`Auto detected ${state.faces.length} face(s).`);
    }
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
  const canvas = refs.overlayCanvas;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0 || canvas.width === 0 || canvas.height === 0) {
    return { x: 0, y: 0 };
  }
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
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

async function loadImageFromFile(file) {
  if (isMobileLayout() && typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, {
        resizeWidth: MAX_IMAGE_LONG_EDGE_MOBILE,
        resizeQuality: "medium",
      });
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        bitmap.close?.();
        throw new Error("Canvas unavailable");
      }
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close?.();
      return canvas;
    } catch (error) {
      console.warn("createImageBitmap resize failed, falling back to Image()", error);
    }
  }

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


async function finishImageProcessing() {
  if (!state.image) {
    return;
  }

  const ready = await ensureModelsReady();
  if (!ready) {
    setEditMode(true);
    setStatus("AI models are not ready yet. Edit mode is on — drag on the image to add stickers.", true);
    return;
  }

  await detectFaces({ enableEditAfter: !isMobileLayout() });
}

async function onFileSelected(file) {
  if (!file) {
    return;
  }
  if (!file.type.startsWith("image/")) {
    setStatus("Please upload an image file.", true);
    return;
  }
  const onMobile = isMobileLayout();
  if (onMobile && state.isProcessing) {
    return;
  }

  const generation = onMobile ? ++state.processingGeneration : 0;
  if (onMobile) {
    state.isProcessing = true;
  }

  try {
    setStatus("Loading image...");
    let image = await loadImageFromFile(file);
    if (onMobile && generation !== state.processingGeneration) {
      return;
    }
    image = normalizeImageForProcessing(image);
    if (onMobile && generation !== state.processingGeneration) {
      return;
    }
    state.image = image;
    state.fileName = file.name.replace(/\.[^.]+$/, "") || "facetoemoji";
    state.faces = [];
    setSelectedFaces([]);
    state.draftRect = null;
    resizeCanvases(image.width, image.height);
    renderAll();
    await finishImageProcessing();
  } catch (error) {
    console.error(error);
    setStatus("Image upload failed.", true);
  } finally {
    refs.imageInput.value = "";
    if (onMobile && generation === state.processingGeneration) {
      state.isProcessing = false;
    }
  }
}

function setupTitleReset() {
  if (!refs.titleResetBtn) {
    return;
  }

  refs.titleResetBtn.addEventListener("click", () => {
    if (isMobileLayout() && state.isProcessing) {
      return;
    }
    clearLoadedImage();
  });
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
    if (!state.image || (isMobileLayout() && state.isProcessing)) {
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

function getInteractionSurface() {
  return refs.canvasStage;
}

function releasePointerCaptureSafe(event) {
  const surface = getInteractionSurface();
  if (surface.hasPointerCapture?.(event.pointerId)) {
    surface.releasePointerCapture(event.pointerId);
  }
}

function setupCanvasInteractions() {
  const surface = getInteractionSurface();
  surface.style.touchAction = "none";

  surface.addEventListener("pointerdown", (event) => {
    if (!state.image) {
      return;
    }
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const point = toCanvasPoint(event);
    const targetFace = findFaceAtPoint(point.x, point.y);

    if (!state.editMode) {
      setSelectedFaces(targetFace ? [targetFace.id] : []);
      renderAll();
      if (targetFace) {
        setStatus("Sticker selected. Turn on Edit to move, resize, or change style.");
      } else {
        setStatus("Turn on Edit to drag and add a sticker.");
      }
      return;
    }

    if (targetFace) {
      if (event.shiftKey) {
        toggleSelectedFace(targetFace.id);
        renderAll();
        const selectedCount = getSelectedFaces().length;
        setStatus(selectedCount > 0 ? `${selectedCount} sticker(s) selected.` : "Selection cleared.");
        return;
      }

      const activeSelection = isFaceSelected(targetFace.id) && state.selectedFaceIds.length > 0
        ? [...state.selectedFaceIds]
        : [targetFace.id];
      setSelectedFaces(activeSelection);

      const handleRect = getResizeHandleRect(targetFace);
      state.editDragging = true;
      state.editDragMode = isPointInRect(point, handleRect) ? "resize" : "move";
      state.editDragFaceId = targetFace.id;
      state.editDragFaceIds = [...state.selectedFaceIds];
      state.editDragStart = point;
      state.editDragStartBox = { ...targetFace.box };
      state.editDragStartSize = targetFace.size ?? 1;
      state.editDragStartBoxes = {};
      state.editDragStartSizes = {};

      state.editDragFaceIds.forEach((faceId) => {
        const face = getFaceById(faceId);
        if (!face) {
          return;
        }
        state.editDragStartBoxes[faceId] = { ...face.box };
        state.editDragStartSizes[faceId] = face.size ?? 1;
      });

      surface.setPointerCapture(event.pointerId);
      renderAll();
      if (state.editDragMode === "resize") {
        setStatus(
          state.editDragFaceIds.length > 1
            ? `Drag to resize ${state.editDragFaceIds.length} selected stickers.`
            : "Drag corner to resize selected sticker.",
        );
      } else {
        setStatus(
          state.editDragFaceIds.length > 1
            ? `Drag to move ${state.editDragFaceIds.length} selected stickers.`
            : "Drag selected sticker to move.",
        );
      }
      return;
    }

    setSelectedFaces([]);
    surface.setPointerCapture(event.pointerId);
    state.drawing = true;
    state.drawStart = point;
    state.draftRect = { x: point.x, y: point.y, width: 0, height: 0 };
    renderAll();
    setStatus("Drag to place a new sticker.");
  });

  surface.addEventListener("pointermove", (event) => {
    if (!state.image) {
      return;
    }

    const point = toCanvasPoint(event);

    if (state.editDragging && state.editDragStart && state.editDragFaceId) {
      if (state.editDragMode === "move") {
        const dx = point.x - state.editDragStart.x;
        const dy = point.y - state.editDragStart.y;

        state.editDragFaceIds.forEach((faceId) => {
          const targetFace = getFaceById(faceId);
          const startBox = state.editDragStartBoxes[faceId];
          if (!targetFace || !startBox) {
            return;
          }

          const maxX = Math.max(0, refs.previewCanvas.width - startBox.width);
          const maxY = Math.max(0, refs.previewCanvas.height - startBox.height);
          targetFace.box.x = Math.min(maxX, Math.max(0, startBox.x + dx));
          targetFace.box.y = Math.min(maxY, Math.max(0, startBox.y + dy));
        });
      } else if (state.editDragMode === "resize") {
        const centerX = state.editDragStartBox.x + state.editDragStartBox.width / 2;
        const centerY = state.editDragStartBox.y + state.editDragStartBox.height / 2;
        const startDistance = Math.hypot(state.editDragStart.x - centerX, state.editDragStart.y - centerY) || 1;
        const currentDistance = Math.hypot(point.x - centerX, point.y - centerY);
        const scale = currentDistance / startDistance;

        state.editDragFaceIds.forEach((faceId) => {
          const targetFace = getFaceById(faceId);
          if (!targetFace) {
            return;
          }
          const startSize = state.editDragStartSizes[faceId] ?? 1;
          targetFace.size = clampSize(startSize * scale);
        });
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

  surface.addEventListener("pointerup", (event) => {
    releasePointerCaptureSafe(event);

    if (state.editDragging) {
      const editedCount = state.editDragFaceIds.length;
      state.editDragging = false;
      state.editDragMode = null;
      state.editDragFaceId = null;
      state.editDragFaceIds = [];
      state.editDragStart = null;
      state.editDragStartBox = null;
      state.editDragStartBoxes = {};
      state.editDragStartSize = 1;
      state.editDragStartSizes = {};
      renderAll();
      setStatus(
        editedCount > 1
          ? `Updated ${editedCount} selected stickers by drag.`
          : "Selected sticker updated by mouse drag.",
      );
      return;
    }

    if (!state.drawing) {
      return;
    }

    state.drawing = false;

    if (state.draftRect && state.draftRect.width >= MIN_STICKER_DRAG_SIZE && state.draftRect.height >= MIN_STICKER_DRAG_SIZE) {
      const face = createFace({
        box: state.draftRect,
        emoji: state.defaultEmoji,
        opacity: state.defaultOpacity,
        size: state.defaultSize,
        expression: "manual",
      });
      state.faces.push(face);
      setSelectedFaces([face.id]);
      setStatus("Sticker added by drag.");
    }

    state.drawStart = null;
    state.draftRect = null;
    renderAll();
  });

  surface.addEventListener("pointercancel", (event) => {
    releasePointerCaptureSafe(event);

    if (state.editDragging) {
      state.editDragging = false;
      state.editDragMode = null;
      state.editDragFaceId = null;
      state.editDragFaceIds = [];
      state.editDragStart = null;
      state.editDragStartBox = null;
      state.editDragStartBoxes = {};
      state.editDragStartSize = 1;
      state.editDragStartSizes = {};
    }

    if (state.drawing) {
      state.drawing = false;
      state.drawStart = null;
      state.draftRect = null;
    }

    drawOverlay();
  });

  surface.addEventListener(
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

      const selectedFaces = getSelectedFaces();
      if (selectedFaces.length === 0) {
        setStatus("Click a sticker first, then use wheel to adjust opacity.");
        return;
      }

      const step = 0.02;
      const delta = event.deltaY < 0 ? step : -step;
      selectedFaces.forEach((face) => {
        face.opacity = clampOpacity(face.opacity + delta);
      });
      renderAll();
    },
    { passive: false },
  );

  window.addEventListener("keydown", (event) => {
    const isSelectAll = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a";
    if (!isSelectAll) {
      return;
    }

    if (!state.image || !state.editMode) {
      return;
    }

    const tagName = event.target?.tagName;
    if (tagName && ["INPUT", "TEXTAREA", "SELECT"].includes(tagName)) {
      return;
    }

    event.preventDefault();
    if (state.faces.length === 0) {
      setStatus("No stickers available to select.");
      return;
    }

    setSelectedFaces(state.faces.map((face) => face.id));
    renderAll();
    setStatus(`Selected all ${state.faces.length} stickers.`);
  });
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
    setSelectedFaces([]);
    state.draftRect = null;
    state.drawing = false;
    state.editDragging = false;
    state.editDragFaceIds = [];
    state.editDragStartBoxes = {};
    state.editDragStartSizes = {};
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

    const selectedFaces = getSelectedFaces();
    if (selectedFaces.length === 0) {
      syncControlsForSelection();
      setStatus("Sticker style set. Drag on preview to add it.");
      return;
    }

    selectedFaces.forEach((face) => {
      face.emoji = emoji;
    });
    renderAll();
    setStatus(
      selectedFaces.length > 1
        ? `Updated style for ${selectedFaces.length} selected stickers.`
        : "Selected sticker style updated.",
    );
  });

  refs.opacityRange.addEventListener("input", (event) => {
    if (!state.editMode) {
      syncControlsForSelection();
      setStatus("Turn on Edit first to adjust opacity.");
      return;
    }

    const opacity = clampOpacity(Number(event.target.value) / 100);
    const selectedFaces = getSelectedFaces();
    if (selectedFaces.length === 0) {
      state.defaultOpacity = opacity;
      syncControlsForSelection();
      setStatus("Default opacity set for new stickers.");
      return;
    }

    selectedFaces.forEach((face) => {
      face.opacity = opacity;
    });
    renderAll();
  });

  refs.sizeRange.addEventListener("input", (event) => {
    if (!state.editMode) {
      syncControlsForSelection();
      setStatus("Turn on Edit first to adjust size.");
      return;
    }

    const size = clampSize(Number(event.target.value) / 100);
    const selectedFaces = getSelectedFaces();
    if (selectedFaces.length === 0) {
      state.defaultSize = size;
      syncControlsForSelection();
      setStatus("Default size set for new stickers.");
      return;
    }

    selectedFaces.forEach((face) => {
      face.size = size;
    });
    renderAll();
  });

  refs.deleteSelectedBtn.addEventListener("click", () => {
    if (!state.editMode) {
      setStatus("Turn on Edit first to delete stickers.");
      return;
    }

    const selectedFaces = getSelectedFaces();
    if (selectedFaces.length === 0) {
      setStatus("Click one or more stickers first to delete.");
      return;
    }

    const selectedIdSet = new Set(selectedFaces.map((face) => face.id));
    state.faces = state.faces.filter((face) => !selectedIdSet.has(face.id));
    setSelectedFaces(state.faces[0] ? [state.faces[0].id] : []);
    renderAll();
    setStatus(
      selectedFaces.length > 1
        ? `Deleted ${selectedFaces.length} selected stickers.`
        : "Selected sticker deleted.",
    );
  });

  refs.downloadBtn.addEventListener("click", () => {
    void downloadEditedImage();
  });
}

function loadFaceApiScript() {
  if (typeof faceapi !== "undefined") {
    return Promise.resolve();
  }
  if (faceApiScriptPromise) {
    return faceApiScriptPromise;
  }

  faceApiScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = FACE_API_SCRIPT_URL;
    script.integrity = FACE_API_SCRIPT_INTEGRITY;
    script.crossOrigin = "anonymous";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      faceApiScriptPromise = null;
      reject(new Error("Failed to load face-api.js"));
    };
    document.head.appendChild(script);
  });

  return faceApiScriptPromise;
}

async function loadModels() {
  try {
    const modelLoads = [faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL)];
    if (!isMobileLayout()) {
      modelLoads.push(faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL));
    }
    await Promise.all(modelLoads);

    state.modelsReady = true;
    setStatus(
      isMobileLayout()
        ? "Models ready. Upload a photo — faces blur automatically."
        : "Models ready. Quick upload in Live Preview.",
    );

    if (!isMobileLayout()) {
      faceapi.nets.ssdMobilenetv1
        .loadFromUri(MODEL_URL)
        .then(() => {
          state.ssdModelReady = true;
        })
        .catch((error) => {
          console.warn("Optional SSD model failed to load", error);
        });
    }
  } catch (error) {
    console.error(error);
    setStatus("Failed to load AI models.", true);
    throw error;
  }
}

async function ensureModelsReady() {
  if (state.modelsReady) {
    return true;
  }

  if (!modelsLoadPromise) {
    modelsLoadPromise = (async () => {
      setStatus("Loading AI models...");
      try {
        await loadFaceApiScript();
        await loadModels();
        return state.modelsReady;
      } catch (error) {
        console.error(error);
        setStatus("Failed to load AI models.", true);
        modelsLoadPromise = null;
        return false;
      }
    })();
  }

  return modelsLoadPromise;
}

function shouldLoadVercelInsights() {
  const host = window.location.hostname;
  return (
    host === "www.getfacetoemoji.com" ||
    host === "getfacetoemoji.com" ||
    host.endsWith(".vercel.app")
  );
}

function loadVercelInsights() {
  if (!shouldLoadVercelInsights()) {
    return;
  }

  const inject = () => {
    if (document.querySelector("script[data-vercel-insights]")) {
      return;
    }
    const script = document.createElement("script");
    script.src = "/_vercel/insights/script.js";
    script.defer = true;
    script.dataset.vercelInsights = "true";
    document.body.appendChild(script);
  };

  if ("requestIdleCallback" in window) {
    requestIdleCallback(inject, { timeout: 4000 });
  } else {
    setTimeout(inject, 2000);
  }
}

let appInitialized = false;

async function init() {
  if (appInitialized) {
    return;
  }
  appInitialized = true;

  refs.canvasStage.style.width = "100%";
  if (isMobileLayout()) {
    state.defaultEmoji = BLUR_CIRCLE_VALUE;
  }
  refs.emojiSelect.value = state.defaultEmoji;
  refs.editBtn.classList.remove("active");
  updateOverlayCursor();
  syncSizeControl(state.defaultSize);
  renderAll();

  setupQuickUploadArea();
  setupControlEvents();
  setupCanvasInteractions();
  setupTitleReset();

  canvasLayoutWidth = refs.canvasContainer.getBoundingClientRect().width;
  window.addEventListener("resize", handleWindowLayoutChange);
  window.addEventListener("orientationchange", handleOrientationChange);

  setStatus("Quick upload in Live Preview — tap Auto when you're ready.");
  loadVercelInsights();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
