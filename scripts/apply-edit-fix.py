#!/usr/bin/env python3
"""Apply edit-mode interaction fixes to app.js."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
app_path = ROOT / "app.js"
app = app_path.read_text()

if "MIN_STICKER_DRAG_SIZE" not in app:
    app = app.replace(
        "const MIN_FACE_BOX_SIZE = 10;",
        "const MIN_FACE_BOX_SIZE = 10;\nconst MIN_STICKER_DRAG_SIZE = 12;",
    )

app = app.replace(
    """function syncQuickUploadHint() {
  const hasImage = Boolean(state.image);
  refs.quickUploadHint.style.display = hasImage ? "none" : "grid";
  refs.previewActions.style.display = hasImage ? "flex" : "none";
  refs.previewActions.style.pointerEvents = "auto";
  refs.canvasContainer.style.pointerEvents = hasImage ? "none" : "auto";
  refs.canvasStage.style.pointerEvents = hasImage ? "auto" : "none";
  if (hasImage) {
    refs.canvasContainer.removeAttribute("role");
    refs.canvasContainer.removeAttribute("tabindex");
  } else {
    refs.canvasContainer.setAttribute("role", "button");
    refs.canvasContainer.setAttribute("tabindex", "0");
  }
}""",
    """function syncQuickUploadHint() {
  const hasImage = Boolean(state.image);
  refs.quickUploadHint.style.display = hasImage ? "none" : "grid";
  refs.previewActions.style.display = hasImage ? "flex" : "none";
  refs.canvasContainer.classList.toggle("has-image", hasImage);
  if (hasImage) {
    refs.canvasContainer.removeAttribute("role");
    refs.canvasContainer.removeAttribute("tabindex");
    refs.canvasStage.style.width = "100%";
  } else {
    refs.canvasContainer.setAttribute("role", "button");
    refs.canvasContainer.setAttribute("tabindex", "0");
    refs.canvasStage.style.width = "100%";
  }
}""",
)

app = app.replace(
    "  const selected = selectedFaces[0] || null;",
    "  const selected = getSelectedFace();",
    1,
)

app = app.replace(
    """function updateOverlayCursor() {
  refs.overlayCanvas.style.cursor = state.editMode ? "crosshair" : "pointer";
}""",
    """function updateOverlayCursor() {
  const cursor = state.editMode ? "crosshair" : "pointer";
  refs.canvasStage.style.cursor = cursor;
  refs.overlayCanvas.style.cursor = cursor;
}""",
)

helpers = """
function waitForModels() {
  if (state.modelsReady) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const started = Date.now();
    const check = () => {
      if (state.modelsReady) {
        resolve();
        return;
      }
      if (Date.now() - started > 120000) {
        resolve();
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

async function finishImageProcessing() {
  if (!state.image) {
    return;
  }

  if (!state.modelsReady) {
    setStatus("Loading AI models...");
    await waitForModels();
  }

  if (!state.modelsReady) {
    setEditMode(true);
    setStatus("AI models are not ready yet. Edit mode is on — drag on the image to add stickers.", true);
    return;
  }

  await detectFaces({ enableEditAfter: true });
}

"""

if "function waitForModels" not in app:
    app = app.replace("async function onFileSelected(file) {", helpers + "async function onFileSelected(file) {")

app = app.replace(
    "    renderAll();\n    await detectFaces();",
    "    renderAll();\n    await finishImageProcessing();",
    1,
)

app = app.replace(
    "async function detectFaces() {",
    "async function detectFaces({ enableEditAfter = false } = {}) {",
    1,
)

app = app.replace(
    """    if (state.faces.length === 0) {
      setStatus("No faces detected. Turn on Edit and drag to add one manually.");
      return;
    }

    setStatus(`Auto detected ${state.faces.length} face(s).`);""",
    """    if (state.faces.length === 0) {
      if (enableEditAfter) {
        setEditMode(true);
        setStatus("No faces detected. Edit mode is on — drag on the image to add a sticker.");
      } else {
        setStatus("No faces detected. Turn on Edit and drag to add one manually.");
      }
      return;
    }

    if (enableEditAfter) {
      setEditMode(true);
      setStatus(`Auto detected ${state.faces.length} face(s). Edit mode is on — drag stickers to adjust.`);
    } else {
      setStatus(`Auto detected ${state.faces.length} face(s).`);
    }""",
    1,
)

app = app.replace(
    """function toCanvasPoint(pointerEvent) {
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
}""",
    """function toCanvasPoint(pointerEvent) {
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
}""",
)

start = app.index("function setupCanvasInteractions() {")
end = app.index("\nfunction setupControlEvents()", start)
if start < 0 or end < 0:
    raise SystemExit("setupCanvasInteractions block not found")

new_setup = (ROOT / "scripts" / "setup-canvas-interactions.js.txt").read_text()
app = app[:start] + new_setup + app[end:]

app_path.write_text(app)
print("Patched", app_path)
