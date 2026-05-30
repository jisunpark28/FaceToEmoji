/**
 * Internal product analytics (owner-only debug panel + Vercel custom events on production).
 * Enable debug UI: ?analytics_debug=1 or localStorage facetoemoji_analytics_debug=1
 */
(function initFaceToEmojiAnalytics() {
  const STORAGE_KEY = "facetoemoji_analytics_v1";
  const DEBUG_KEY = "facetoemoji_analytics_debug";
  const DEBUG_PANEL_ID = "fte-analytics-debug";

  let session = {
    uploaded: false,
    detected: false,
    detectSource: null,
  };

  function isDebugEnabled() {
    try {
      if (new URLSearchParams(window.location.search).get("analytics_debug") === "1") {
        return true;
      }
      return localStorage.getItem(DEBUG_KEY) === "1";
    } catch {
      return false;
    }
  }

  function isProductionHost() {
    const host = window.location.hostname;
    return (
      host === "www.getfacetoemoji.com" ||
      host === "getfacetoemoji.com" ||
      host.endsWith(".vercel.app")
    );
  }

  function getWeekId(date = new Date()) {
    const jan1 = new Date(date.getFullYear(), 0, 1);
    const days = Math.floor((date - jan1) / 86400000);
    const week = Math.ceil((days + jan1.getDay() + 1) / 7);
    return `${date.getFullYear()}-W${String(week).padStart(2, "0")}`;
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return { week: getWeekId(), events: {} };
      }
      const parsed = JSON.parse(raw);
      if (parsed.week !== getWeekId()) {
        return { week: getWeekId(), events: {} };
      }
      return { week: parsed.week, events: parsed.events || {} };
    } catch {
      return { week: getWeekId(), events: {} };
    }
  }

  function saveStore(store) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      /* private mode / quota */
    }
  }

  function incrementLocal(name) {
    const store = loadStore();
    store.events[name] = (store.events[name] || 0) + 1;
    saveStore(store);
    return store;
  }

  function sendVercel(name, props) {
    if (!isProductionHost()) {
      return;
    }
    window.va =
      window.va ||
      function vaQueue() {
        (window.vaq = window.vaq || []).push(arguments);
      };
    try {
      if (props && Object.keys(props).length > 0) {
        window.va("event", { name, data: props });
      } else {
        window.va("event", { name });
      }
    } catch (error) {
      console.warn("Vercel analytics event failed", name, error);
    }
  }

  function track(name, props = {}) {
    const store = incrementLocal(name);
    sendVercel(name, props);
    if (isDebugEnabled()) {
      renderDebugPanel(store);
    }
    return store;
  }

  function resetSession() {
    session = {
      uploaded: false,
      detected: false,
      detectSource: null,
    };
    if (isDebugEnabled()) {
      renderDebugPanel(loadStore());
    }
  }

  function ensureDebugPanel() {
    let panel = document.getElementById(DEBUG_PANEL_ID);
    if (panel) {
      return panel;
    }
    panel = document.createElement("aside");
    panel.id = DEBUG_PANEL_ID;
    panel.setAttribute("aria-label", "Internal analytics debug");
    panel.innerHTML = `
      <header>📊 Internal analytics</header>
      <p class="fte-analytics-note">Only you see this panel. Production also sends events to Vercel Analytics.</p>
      <dl></dl>
      <p class="fte-analytics-session"></p>
      <button type="button" data-reset-week>Reset week counts</button>
    `;
    document.body.appendChild(panel);
    panel.querySelector("[data-reset-week]").addEventListener("click", () => {
      saveStore({ week: getWeekId(), events: {} });
      renderDebugPanel(loadStore());
    });
    return panel;
  }

  function renderDebugPanel(store = loadStore()) {
    const panel = ensureDebugPanel();
    const dl = panel.querySelector("dl");
    const labels = {
      page_view_proxy: "Visits (proxy: open with debug)",
      upload: "Upload",
      auto_click: "Auto button",
      detect_ok: "Detect OK",
      detect_empty: "Detect 0 faces",
      detect_fail: "Detect fail",
      download: "Download",
      north_star: "★ North Star",
    };

    const keys = [
      "upload",
      "auto_click",
      "detect_ok",
      "detect_empty",
      "detect_fail",
      "download",
      "north_star",
    ];

    dl.innerHTML = keys
      .map((key) => {
        const count = store.events[key] || 0;
        return `<dt>${labels[key] || key}</dt><dd>${count}</dd>`;
      })
      .join("");

    panel.querySelector(".fte-analytics-session").textContent = `This session: upload ${
      session.uploaded ? "✓" : "—"
    } · detect ${session.detected ? "✓" : "—"} · source ${session.detectSource || "—"} · week ${
      store.week
    }`;
  }

  window.FTEAnalytics = {
    isDebugEnabled,
    resetSession,
    setDetectSource(source) {
      session.detectSource = source;
      if (isDebugEnabled()) {
        renderDebugPanel(loadStore());
      }
    },
    trackUpload() {
      session.uploaded = true;
      track("upload", {
        mobile: window.matchMedia("(max-width: 760px), (pointer: coarse)").matches,
      });
    },
    trackAutoClick() {
      track("auto_click", { mobile: window.matchMedia("(max-width: 760px), (pointer: coarse)").matches });
    },
    trackDetectOk(faceCount) {
      session.detected = true;
      track("detect_ok", {
        face_count: faceCount,
        source: session.detectSource || "unknown",
        mobile: window.matchMedia("(max-width: 760px), (pointer: coarse)").matches,
      });
      if (session.detectSource === "upload") {
        track("auto_detect_upload", { face_count: faceCount });
      }
    },
    trackDetectEmpty() {
      track("detect_empty", { source: session.detectSource || "unknown" });
    },
    trackDetectFail() {
      track("detect_fail", { source: session.detectSource || "unknown" });
    },
    trackDownload(method = "anchor") {
      track("download", { method });
      if (session.uploaded && session.detected) {
        track("north_star", {
          method,
          source: session.detectSource || "unknown",
        });
      }
    },
    init() {
      window.va =
        window.va ||
        function vaQueue() {
          (window.vaq = window.vaq || []).push(arguments);
        };
      if (isDebugEnabled()) {
        incrementLocal("page_view_proxy");
        renderDebugPanel(loadStore());
      }
    },
    getWeekCounts() {
      return loadStore();
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => window.FTEAnalytics.init());
  } else {
    window.FTEAnalytics.init();
  }
})();
