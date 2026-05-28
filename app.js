const MODEL_URL = "https://justadudewhohacks.github.io/face-api.js/models";

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
  manualMode: false,
  drawing: false,
  drawStart: null,
  draftRect: null,
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
  manualBtn: document.getElementById("manualBtn"),
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

function getSelectedFace() {
  return state.faces.find((face) => face.id === state.selectedFaceId) || null;
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
  syncControlsForSelection();

  if (!announce) {
    return;
  }

  if (active) {
    setStatus("Edit mode on: click an emoji to edit size, opacity, emoji, or delete.");
    return;
  }

  setStatus("Edit mode off.");
}

function syncControlsForSelection() {
  const selected = getSelectedFace();
  const canEditSelected = state.editMode && Boolean(selected);

  if (!state.editMode) {
    refs.selectedFaceMeta.textContent = "Turn on Edit mode to change selected emoji options.";
    refs.emojiSelect.value = state.defaultEmoji;
    refs.emojiSelect.disabled = true;
    refs.opacityRange.disabled = true;
    refs.sizeRange.disabled = true;
    refs.deleteSelectedBtn.disabled = true;
    syncOpacityControl(state.defaultOpacity);
    syncSizeControl(state.defaultSize);
    return;
  }

  if (!canEditSelected) {
    refs.selectedFaceMeta.textContent = "Edit mode on. Click an emoji on preview to edit it.";
    refs.emojiSelect.disabled = true;
    refs.opacityRange.disabled = true;
    refs.sizeRange.disabled = true;
    refs.deleteSelectedBtn.disabled = true;
    syncOpacityControl(state.defaultOpacity);
    syncSizeControl(state.defaultSize);
    return;
  }

  refs.selectedFaceMeta.textContent = `Selected face / Emoji ${selected.emoji} / Opacity ${opacityToPercent(selected.opacity)}% / Size ${sizeToPercent(selected.size)}%`;
  refs.emojiSelect.value = selected.emoji;
  refs.emojiSelect.disabled = false;
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
  setManualMode(false);
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
  const text = "Made with FaceToEmoji";
  const fontSize = Math.max(11, Math.min(18, refs.previewCanvas.width * 0.018));
  const margin = Math.max(10, fontSize * 0.7);

  ctx.save();
  ctx.font = `600 ${fontSize}px Inter, "Segoe UI", sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
  ctx.shadowBlur = 2;
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

  const label = `${index + 1} · ${face.emoji} · ${opacityToPercent(face.opacity)}%`;
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

  setStatus("Detecting faces...");
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
      const emoji = expressionToEmoji[expression] || state.defaultEmoji;
      return createFace({
        box: det.detection.box,
        expression,
        emoji,
        opacity: state.defaultOpacity,
        size: state.defaultSize,
      });
    });

    state.selectedFaceId = state.faces[0]?.id ?? null;
    renderAll();

    if (state.faces.length === 0) {
      setStatus("No faces detected. Use Manual and drag on preview.");
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

function setManualMode(active) {
  state.manualMode = active;
  refs.manualBtn.classList.toggle("active", active);
  refs.overlayCanvas.style.cursor = active ? "crosshair" : "pointer";
  setStatus(active ? "Manual on: drag in photo to add emoji (hold Shift for perfect square)." : "Manual off: click face to edit.");
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
    setManualMode(false);
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
      setStatus("No face selected.");
      return;
    }

    state.selectedFaceId = targetFace.id;
    renderAll();
    setStatus(state.editMode ? "Emoji selected. Edit options are now enabled." : "Emoji selected. Turn on Edit mode to modify it.");
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
    state.draftRect = buildDraftRect(state.drawStart, point, event.shiftKey);
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
      const face = createFace({
        box: state.draftRect,
        emoji: state.defaultEmoji,
        opacity: state.defaultOpacity,
        size: state.defaultSize,
        expression: "manual",
        manual: true,
      });
      state.faces.push(face);
      state.selectedFaceId = face.id;
      setStatus("Emoji face added by drag.");
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

  refs.overlayCanvas.addEventListener(
    "wheel",
    (event) => {
      if (!state.image) {
        return;
      }

      event.preventDefault();
      if (!state.editMode) {
        setStatus("Turn on Edit mode first.");
        return;
      }

      const selected = getSelectedFace();
      if (!selected) {
        setStatus("Click an emoji first, then use wheel to adjust its opacity.");
        return;
      }

      const step = event.shiftKey ? 0.01 : 0.02;
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

  refs.manualBtn.addEventListener("click", () => {
    setManualMode(!state.manualMode);
  });

  refs.editBtn.addEventListener("click", () => {
    setEditMode(!state.editMode);
  });

  refs.clearBtn.addEventListener("click", () => {
    state.faces = [];
    state.selectedFaceId = null;
    state.draftRect = null;
    setManualMode(false);
    renderAll();
    setStatus("Faces reset.");
  });

  refs.emojiSelect.addEventListener("change", (event) => {
    const selected = getSelectedFace();
    if (!state.editMode || !selected) {
      syncControlsForSelection();
      setStatus("Turn on Edit mode and select an emoji to change it.");
      return;
    }

    const emoji = event.target.value;
    selected.emoji = emoji;
    state.defaultEmoji = emoji;
    renderAll();
    setStatus("Selected emoji updated.");
  });

  refs.opacityRange.addEventListener("input", (event) => {
    const selected = getSelectedFace();
    if (!state.editMode || !selected) {
      syncControlsForSelection();
      setStatus("Turn on Edit mode and select one emoji to adjust opacity.");
      return;
    }

    const opacity = clampOpacity(Number(event.target.value) / 100);
    selected.opacity = opacity;
    renderAll();
  });

  refs.sizeRange.addEventListener("input", (event) => {
    const selected = getSelectedFace();
    if (!state.editMode || !selected) {
      syncControlsForSelection();
      setStatus("Turn on Edit mode and select one emoji to adjust size.");
      return;
    }

    const size = clampSize(Number(event.target.value) / 100);
    selected.size = size;
    renderAll();
  });

  refs.deleteSelectedBtn.addEventListener("click", () => {
    const selected = getSelectedFace();
    if (!state.editMode || !selected) {
      setStatus("Turn on Edit mode and select one emoji to delete.");
      return;
    }

    state.faces = state.faces.filter((face) => face.id !== selected.id);
    state.selectedFaceId = state.faces[0]?.id ?? null;
    renderAll();
    setStatus("Selected emoji deleted.");
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
  refs.overlayCanvas.style.cursor = "pointer";
  refs.emojiSelect.value = state.defaultEmoji;
  refs.editBtn.classList.remove("active");
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
