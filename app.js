const MODEL_URL = "https://justadudewhohacks.github.io/face-api.js/models";

const expressionToEmoji = {
  neutral: "🙂",
  happy: "😄",
  sad: "😢",
  angry: "😠",
  fearful: "😨",
  disgusted: "🤢",
  surprised: "😲",
};

const state = {
  modelsReady: false,
  image: null,
  fileName: "facetoemoji",
  faces: [],
  selectedFaceId: null,
  defaultMode: "emoji",
  defaultEmojiOpacity: 0.95,
  defaultBlurOpacity: 0.9,
  manualMode: false,
  drawing: false,
  drawStart: null,
  draftRect: null,
};

const refs = {
  imageInput: document.getElementById("imageInput"),
  dropzone: document.getElementById("dropzone"),
  statusText: document.getElementById("statusText"),
  detectBtn: document.getElementById("detectBtn"),
  manualBtn: document.getElementById("manualBtn"),
  clearBtn: document.getElementById("clearBtn"),
  defaultModeSelect: document.getElementById("defaultModeSelect"),
  applyDefaultBtn: document.getElementById("applyDefaultBtn"),
  defaultEmojiOpacityRange: document.getElementById("defaultEmojiOpacityRange"),
  defaultEmojiOpacityValue: document.getElementById("defaultEmojiOpacityValue"),
  defaultBlurOpacityRange: document.getElementById("defaultBlurOpacityRange"),
  defaultBlurOpacityValue: document.getElementById("defaultBlurOpacityValue"),
  applyOpacityDefaultsBtn: document.getElementById("applyOpacityDefaultsBtn"),
  selectedFaceMeta: document.getElementById("selectedFaceMeta"),
  selectedModeSelect: document.getElementById("selectedModeSelect"),
  selectedOpacityRange: document.getElementById("selectedOpacityRange"),
  selectedOpacityValue: document.getElementById("selectedOpacityValue"),
  excludeCheckbox: document.getElementById("excludeCheckbox"),
  removeFaceBtn: document.getElementById("removeFaceBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  previewCanvas: document.getElementById("previewCanvas"),
  overlayCanvas: document.getElementById("overlayCanvas"),
  canvasStage: document.getElementById("canvasStage"),
  canvasContainer: document.getElementById("canvasContainer"),
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

function formatExpression(expression) {
  if (!expression) {
    return "Neutral";
  }
  return expression.charAt(0).toUpperCase() + expression.slice(1);
}

function faceLabelMode(face) {
  return face.mode === "emoji" ? `${face.emoji} Emoji` : "Blur";
}

function clampOpacity(value) {
  if (Number.isNaN(value)) {
    return 1;
  }
  return Math.min(1, Math.max(0.1, value));
}

function opacityToPercent(opacity) {
  return Math.round(clampOpacity(opacity) * 100);
}

function readFaceOpacityForMode(face, mode = face.mode) {
  if (!face) {
    return 1;
  }

  if (mode === "emoji") {
    return clampOpacity(face.emojiOpacity ?? state.defaultEmojiOpacity);
  }

  return clampOpacity(face.blurOpacity ?? state.defaultBlurOpacity);
}

function setFaceOpacityForMode(face, mode, opacity) {
  if (!face) {
    return;
  }

  if (mode === "emoji") {
    face.emojiOpacity = clampOpacity(opacity);
    return;
  }

  face.blurOpacity = clampOpacity(opacity);
}

function syncDefaultOpacityControls() {
  refs.defaultEmojiOpacityRange.value = String(opacityToPercent(state.defaultEmojiOpacity));
  refs.defaultBlurOpacityRange.value = String(opacityToPercent(state.defaultBlurOpacity));
  refs.defaultEmojiOpacityValue.textContent = `${opacityToPercent(state.defaultEmojiOpacity)}%`;
  refs.defaultBlurOpacityValue.textContent = `${opacityToPercent(state.defaultBlurOpacity)}%`;
}

function syncSelectedOpacityControl(face) {
  if (!face) {
    refs.selectedOpacityRange.disabled = true;
    refs.selectedOpacityValue.textContent = "--";
    return;
  }

  refs.selectedOpacityRange.disabled = false;
  const opacityPercent = opacityToPercent(readFaceOpacityForMode(face, face.mode));
  refs.selectedOpacityRange.value = String(opacityPercent);
  refs.selectedOpacityValue.textContent = `${opacityPercent}%`;
}

function getSelectedFace() {
  return state.faces.find((face) => face.id === state.selectedFaceId) || null;
}

function syncSelectedFacePanel() {
  const selected = getSelectedFace();

  if (!selected) {
    refs.selectedFaceMeta.textContent = "Select a face directly on the preview";
    refs.selectedModeSelect.disabled = true;
    refs.excludeCheckbox.disabled = true;
    refs.removeFaceBtn.disabled = true;
    refs.excludeCheckbox.checked = false;
    syncSelectedOpacityControl(null);
    return;
  }

  refs.selectedModeSelect.disabled = false;
  refs.excludeCheckbox.disabled = false;
  refs.removeFaceBtn.disabled = false;
  refs.selectedModeSelect.value = selected.mode;
  refs.excludeCheckbox.checked = selected.excluded;

  const faceIndex = state.faces.findIndex((face) => face.id === selected.id) + 1;
  const expressionText = selected.manual
    ? "Manually added"
    : `Expression: ${formatExpression(selected.expression)}`;
  const opacityPercent = opacityToPercent(readFaceOpacityForMode(selected, selected.mode));
  refs.selectedFaceMeta.textContent = `Face #${faceIndex} / ${expressionText} / Style: ${faceLabelMode(selected)} / Opacity: ${opacityPercent}% / ${selected.excluded ? "Excluded" : "Applied"}`;
  syncSelectedOpacityControl(selected);
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

function drawEmojiSticker(ctx, face) {
  const { x, y, width, height } = face.box;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const radius = Math.max(18, Math.min(width, height) * 0.55);
  const fontSize = Math.max(20, Math.min(width, height) * 0.86);
  const effectOpacity = readFaceOpacityForMode(face, "emoji");

  ctx.save();
  ctx.globalAlpha = effectOpacity;
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${fontSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  ctx.fillText(face.emoji || "🙂", cx, cy + fontSize * 0.03);
  ctx.restore();
}

function clipRoundedRect(ctx, x, y, w, h, radius) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawBlurFace(ctx, face) {
  const { x, y, width, height } = face.box;
  const blur = Math.max(8, Math.floor(Math.min(width, height) * 0.22));
  const effectOpacity = readFaceOpacityForMode(face, "blur");
  ctx.save();
  clipRoundedRect(ctx, x, y, width, height, Math.min(width, height) * 0.25);
  ctx.clip();
  ctx.globalAlpha = effectOpacity;
  ctx.filter = `blur(${blur}px)`;
  ctx.drawImage(state.image, x, y, width, height, x, y, width, height);
  ctx.restore();
}

function drawPreview() {
  previewCtx.clearRect(0, 0, refs.previewCanvas.width, refs.previewCanvas.height);
  if (!state.image) {
    return;
  }

  previewCtx.drawImage(state.image, 0, 0);

  state.faces.forEach((face) => {
    if (face.excluded) {
      return;
    }

    if (face.mode === "blur") {
      drawBlurFace(previewCtx, face);
      return;
    }

    drawEmojiSticker(previewCtx, face);
  });
}

function drawFaceOutline(face, index) {
  const { x, y, width, height } = face.box;
  const selected = face.id === state.selectedFaceId;
  const stroke = face.excluded ? "#d83d47" : selected ? "#2f58f0" : "#20a960";
  const lineWidth = selected ? 3 : 2;

  overlayCtx.save();
  overlayCtx.strokeStyle = stroke;
  overlayCtx.lineWidth = lineWidth;
  overlayCtx.strokeRect(x, y, width, height);

  const effectOpacity = opacityToPercent(readFaceOpacityForMode(face, face.mode));
  const label = `${index + 1} · ${face.mode === "emoji" ? face.emoji : "BLUR"} ${effectOpacity}% ${face.excluded ? "(EXCLUDED)" : ""}`;
  overlayCtx.font = "16px sans-serif";
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
  drawPreview();
  drawOverlay();
  syncSelectedFacePanel();
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

function createFace(box, expression = "neutral", manual = false) {
  const normalizedExpression = expressionToEmoji[expression] ? expression : "neutral";
  return {
    id: makeFaceId(),
    box: normalizeBox(box),
    mode: state.defaultMode,
    excluded: false,
    manual,
    expression: normalizedExpression,
    emoji: expressionToEmoji[normalizedExpression],
    emojiOpacity: state.defaultEmojiOpacity,
    blurOpacity: state.defaultBlurOpacity,
  };
}

async function detectFaces() {
  if (!state.modelsReady) {
    setStatus("AI models are still loading. Please wait a moment.", true);
    return;
  }
  if (!state.image) {
    setStatus("Upload a photo first to start detection.", true);
    return;
  }

  setStatus("Detecting faces and reading expressions...");
  try {
    const options = new faceapi.TinyFaceDetectorOptions({
      inputSize: 416,
      scoreThreshold: 0.35,
    });

    const detections = await faceapi
      .detectAllFaces(state.image, options)
      .withFaceExpressions();

    state.faces = detections.map((det) => {
      const expression = pickExpression(det.expressions);
      return createFace(det.detection.box, expression, false);
    });
    state.selectedFaceId = state.faces[0]?.id ?? null;
    renderAll();

    if (state.faces.length === 0) {
      setStatus("No faces found automatically. Try Add Face Manually.");
      return;
    }
    setStatus(`Auto-detected ${state.faces.length} face(s).`);
  } catch (error) {
    console.error(error);
    setStatus("An error occurred while detecting faces.", true);
  }
}

function findFaceAtPoint(x, y) {
  for (let i = state.faces.length - 1; i >= 0; i -= 1) {
    const { box } = state.faces[i];
    if (
      x >= box.x &&
      x <= box.x + box.width &&
      y >= box.y &&
      y <= box.y + box.height
    ) {
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

function setManualMode(active) {
  state.manualMode = active;
  refs.manualBtn.classList.toggle("active", active);
  refs.overlayCanvas.style.cursor = active ? "crosshair" : "pointer";
  if (active) {
    setStatus("Manual mode on: drag on the preview to add a missed face.");
  } else {
    setStatus("Normal mode on: click a face in the preview to select it.");
  }
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
      reject(new Error("Unable to read this image file."));
    };
    image.src = url;
  });
}

async function onFileSelected(file) {
  if (!file) {
    return;
  }
  if (!file.type.startsWith("image/")) {
    setStatus("Please upload an image file only.", true);
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
    setManualMode(false);
    renderAll();
    await detectFaces();
  } catch (error) {
    console.error(error);
    setStatus("An error occurred while uploading the image.", true);
  }
}

function handleDropZoneEvents() {
  refs.dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    refs.dropzone.classList.add("dragover");
  });

  refs.dropzone.addEventListener("dragleave", () => {
    refs.dropzone.classList.remove("dragover");
  });

  refs.dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    refs.dropzone.classList.remove("dragover");
    const [file] = event.dataTransfer?.files || [];
    onFileSelected(file);
  });
}

function setupCanvasInteractions() {
  refs.overlayCanvas.addEventListener("click", (event) => {
    if (!state.image || state.manualMode || state.drawing) {
      return;
    }

    const point = toCanvasPoint(event);
    const targetFace = findFaceAtPoint(point.x, point.y);

    if (!targetFace) {
      state.selectedFaceId = null;
      renderAll();
      setStatus("No face selected. Click a face box in the preview.");
      return;
    }

    state.selectedFaceId = targetFace.id;

    if (event.shiftKey || event.altKey) {
      targetFace.excluded = !targetFace.excluded;
      setStatus(targetFace.excluded ? "Selected face is now excluded." : "Selected face is restored.");
    } else {
      setStatus("Face selected. Adjust options in the right panel.");
    }

    renderAll();
  });

  refs.overlayCanvas.addEventListener("pointerdown", (event) => {
    if (!state.image || !state.manualMode) {
      return;
    }
    refs.overlayCanvas.setPointerCapture(event.pointerId);
    const point = toCanvasPoint(event);
    state.drawing = true;
    state.drawStart = point;
    state.draftRect = { x: point.x, y: point.y, width: 0, height: 0 };
    drawOverlay();
  });

  refs.overlayCanvas.addEventListener("pointermove", (event) => {
    if (!state.drawing || !state.drawStart) {
      return;
    }
    const point = toCanvasPoint(event);
    const width = point.x - state.drawStart.x;
    const height = point.y - state.drawStart.y;
    state.draftRect = {
      x: width < 0 ? point.x : state.drawStart.x,
      y: height < 0 ? point.y : state.drawStart.y,
      width: Math.abs(width),
      height: Math.abs(height),
    };
    drawOverlay();
  });

  refs.overlayCanvas.addEventListener("pointerup", (event) => {
    if (!state.drawing) {
      return;
    }
    state.drawing = false;
    if (refs.overlayCanvas.hasPointerCapture(event.pointerId)) {
      refs.overlayCanvas.releasePointerCapture(event.pointerId);
    }

    if (state.draftRect && state.draftRect.width >= 20 && state.draftRect.height >= 20) {
      const face = createFace(state.draftRect, "neutral", true);
      state.faces.push(face);
      state.selectedFaceId = face.id;
      setStatus("Manual face area added.");
    }

    state.drawStart = null;
    state.draftRect = null;
    renderAll();
  });

  refs.overlayCanvas.addEventListener("pointercancel", () => {
    if (!state.drawing) {
      return;
    }
    state.drawing = false;
    state.drawStart = null;
    state.draftRect = null;
    drawOverlay();
  });
}


function setupControlEvents() {
  refs.imageInput.addEventListener("change", (event) => {
    const [file] = event.target.files || [];
    onFileSelected(file);
  });

  refs.detectBtn.addEventListener("click", () => {
    detectFaces();
  });

  refs.manualBtn.addEventListener("click", () => {
    setManualMode(!state.manualMode);
  });

  refs.clearBtn.addEventListener("click", () => {
    state.faces = [];
    state.selectedFaceId = null;
    state.draftRect = null;
    setManualMode(false);
    renderAll();
    setStatus("Face data has been reset.");
  });

  refs.defaultModeSelect.addEventListener("change", (event) => {
    state.defaultMode = event.target.value;
  });

  refs.defaultEmojiOpacityRange.addEventListener("input", (event) => {
    state.defaultEmojiOpacity = clampOpacity(Number(event.target.value) / 100);
    refs.defaultEmojiOpacityValue.textContent = `${opacityToPercent(state.defaultEmojiOpacity)}%`;
  });

  refs.defaultBlurOpacityRange.addEventListener("input", (event) => {
    state.defaultBlurOpacity = clampOpacity(Number(event.target.value) / 100);
    refs.defaultBlurOpacityValue.textContent = `${opacityToPercent(state.defaultBlurOpacity)}%`;
  });

  refs.applyDefaultBtn.addEventListener("click", () => {
    if (state.faces.length === 0) {
      setStatus("There are no faces to apply this style to.");
      return;
    }
    state.faces = state.faces.map((face) => ({ ...face, mode: state.defaultMode }));
    renderAll();
    setStatus(`Updated all faces to ${state.defaultMode === "emoji" ? "Emoji" : "Blur"}.`);
  });

  refs.applyOpacityDefaultsBtn.addEventListener("click", () => {
    if (state.faces.length === 0) {
      setStatus("There are no faces to apply opacity settings to.");
      return;
    }

    state.faces = state.faces.map((face) => ({
      ...face,
      emojiOpacity: state.defaultEmojiOpacity,
      blurOpacity: state.defaultBlurOpacity,
    }));
    renderAll();
    setStatus("Applied default emoji/blur opacity to all faces.");
  });

  refs.selectedModeSelect.addEventListener("change", (event) => {
    const selected = getSelectedFace();
    if (!selected) {
      return;
    }
    selected.mode = event.target.value;
    syncSelectedOpacityControl(selected);
    renderAll();
  });

  refs.selectedOpacityRange.addEventListener("input", (event) => {
    const selected = getSelectedFace();
    if (!selected) {
      return;
    }

    const opacity = clampOpacity(Number(event.target.value) / 100);
    setFaceOpacityForMode(selected, selected.mode, opacity);
    refs.selectedOpacityValue.textContent = `${opacityToPercent(opacity)}%`;
    renderAll();
  });

  refs.excludeCheckbox.addEventListener("change", (event) => {
    const selected = getSelectedFace();
    if (!selected) {
      return;
    }
    selected.excluded = event.target.checked;
    renderAll();
  });

  refs.removeFaceBtn.addEventListener("click", () => {
    const selected = getSelectedFace();
    if (!selected) {
      return;
    }
    state.faces = state.faces.filter((face) => face.id !== selected.id);
    state.selectedFaceId = state.faces[0]?.id ?? null;
    renderAll();
    setStatus("Selected face has been deleted.");
  });

  refs.downloadBtn.addEventListener("click", () => {
    if (!state.image) {
      setStatus("There is no edited image to download yet.", true);
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
    setStatus("Models are ready. Upload a photo to auto-detect faces.");
  } catch (error) {
    console.error(error);
    setStatus("Failed to load models. Check your network connection.", true);
  }
}

async function init() {
  refs.canvasStage.style.width = "100%";
  refs.overlayCanvas.style.cursor = "pointer";
  refs.selectedModeSelect.disabled = true;
  refs.selectedOpacityRange.disabled = true;
  refs.excludeCheckbox.disabled = true;
  refs.removeFaceBtn.disabled = true;

  syncDefaultOpacityControls();
  syncSelectedOpacityControl(null);
  setupControlEvents();
  setupCanvasInteractions();
  handleDropZoneEvents();

  window.addEventListener("resize", () => {
    if (!state.image) {
      return;
    }
    syncCanvasStageSize(state.image.width);
  });

  await loadModels();
}

window.addEventListener("DOMContentLoaded", init);
