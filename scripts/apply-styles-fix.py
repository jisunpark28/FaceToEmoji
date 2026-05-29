#!/usr/bin/env python3
from pathlib import Path

css_path = Path(__file__).resolve().parents[1] / "styles.css"
css = css_path.read_text()

if ".canvas-container.has-image" not in css:
    css = css.replace(
        ".canvas-container.dragover .quick-upload-hint {",
        ".canvas-container.has-image {\n  cursor: default;\n  padding: 0;\n}\n\n.canvas-container.dragover .quick-upload-hint {",
        1,
    )

if "#previewCanvas" not in css:
    css = css.replace(
        ".canvas-stage canvas {",
        "#previewCanvas {\n  pointer-events: none;\n}\n\n.canvas-stage canvas {",
        1,
    )

if "touch-action: none" not in css.split(".canvas-stage {", 1)[1].split("}", 1)[0]:
    css = css.replace(
        ".canvas-stage {\n  position: relative;\n  width: 100%;\n  max-width: 100%;\n  line-height: 0;\n}",
        ".canvas-stage {\n  position: relative;\n  width: 100%;\n  max-width: 100%;\n  line-height: 0;\n  touch-action: none;\n}",
        1,
    )

overlay_block = """#overlayCanvas {
  position: absolute;
  inset: 0;
  z-index: 2;
  width: 100%;
  height: 100%;
  cursor: pointer;
  pointer-events: auto;
  touch-action: none;
}"""

if "z-index: 2" not in css:
    css = css.replace(
        """#overlayCanvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  cursor: pointer;
}""",
        """#overlayCanvas {
  position: absolute;
  inset: 0;
  z-index: 2;
  width: 100%;
  height: 100%;
  pointer-events: none;
  touch-action: none;
}""",
        1,
    )

if "pointer-events: auto" not in css.split(".preview-actions {", 1)[1].split("}", 1)[0]:
    css = css.replace(
        ".preview-actions {\n  position: absolute;\n  top: 16px;\n  right: 16px;\n  z-index: 4;\n  display: none;\n  gap: 8px;\n}",
        ".preview-actions {\n  position: absolute;\n  top: 16px;\n  right: 16px;\n  z-index: 4;\n  display: none;\n  gap: 8px;\n  pointer-events: auto;\n}",
        1,
    )

css_path.write_text(css)
print("Patched", css_path)
