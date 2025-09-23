// popup.js — MV3 popup script (no Grab).
// - 顯示題名：僅在網址是 LeetCode 題目時顯示 pageTitle；否則不顯示
// - keep-alive：與 background 建立 Port 並每 20s ping，避免 worker 被回收
// - Save：60s 保險逾時 + 進度訊息；


const $ = (id) => document.getElementById(id);

// ---- keep-alive port ----
let bgPort = null;
function openKeepAlive() {
  try {
    bgPort = chrome.runtime.connect({ name: "keepalive" });
    const timer = setInterval(() => {
      try { bgPort.postMessage({ type: "ping" }); } catch {}
    }, 20000);
    window.addEventListener("unload", () => {
      clearInterval(timer);
      try { bgPort.disconnect(); } catch {}
    });
    bgPort.onDisconnect.addListener(() => { /* 背景結束 */ });
  } catch {}
}
openKeepAlive();

// ---- utilities ----
function extractSlug(url) {
  const m = String(url).match(/leetcode\.com\/problems\/([^\/?#]+)/i);
  return m ? m[1] : "";
}

(function init() {
  // 取得目前分頁
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    const pageURL = tab?.url || "";
    const pageTitle = (tab?.title || "").replace(/ - LeetCode.*/i, "").trim();
    const slug = extractSlug(pageURL);

    // 只在 LeetCode 題目頁顯示題名；非 LeetCode 不顯示
    if (/leetcode\.com\/problems\//i.test(pageURL)) {
      const metaEl = $("meta");
      if (metaEl) metaEl.textContent = pageTitle || "";
    } else {
      const metaEl = $("meta");
      if (metaEl) metaEl.textContent = "";
    }

    // 預熱：抓一次 meta
    if (slug) chrome.runtime.sendMessage({ action: "fetchLeetCodeMeta", slug }, () => {});

    // 僅註冊一次進度監聽
    let progressListenerInstalled = false;
    function ensureProgressListener() {
      if (progressListenerInstalled) return;
      chrome.runtime.onMessage.addListener(function progressListener(m) {
        if (m && m.__progress === true && m.msg) {
          const s = $("status");
          if (s) s.textContent = m.msg;
        }
      });
      progressListenerInstalled = true;
    }

    // Save 按鈕
    $("save").onclick = () => {
      ensureProgressListener();

      const btn = $("save");
      btn.disabled = true;
      const prevText = btn.textContent;
      btn.textContent = "Saving… (start)";
      const statusEl = $("status");
      if (statusEl) statusEl.textContent = "";

      // 從 Options 取 token/dbid
      chrome.storage.sync.get(["token", "dbid"], (cfg) => {
        if (!cfg?.token || !cfg?.dbid) {
          if (statusEl) statusEl.textContent = "❌ 請先在 Settings 設定 Token 與 Database ID";
          btn.disabled = false; btn.textContent = prevText;
          return;
        }

        const isCorrect = !!($("correctChk") && $("correctChk").checked);
        const payload = {
          slug,
          // 由 background - slug 補全其餘中繼資料
          problemId: undefined,
          title: pageTitle || "LeetCode Problem",
          url: pageURL,
          difficulty: undefined,
          topics: [],
          importance: $("importance")?.value || "基礎",
          reviewStatus: $("review")?.value || "need review",
          code: $("code")?.value || "",
          language: $("lang")?.value || "c++",
          correct: isCorrect
        };

        let responded = false;
        const timeout = setTimeout(() => {
          if (!responded) {
            if (statusEl) statusEl.textContent = "⚠️ 儲存較久，請稍候或再試一次（已超過 60 秒）";
            btn.disabled = false; btn.textContent = prevText;
          }
        }, 45000); // 45s 保險

        chrome.runtime.sendMessage({ action: "saveToNotion", payload }, (resp) => {
          responded = true;
          clearTimeout(timeout);

          if (chrome.runtime.lastError) {
            if (statusEl) statusEl.textContent = "❌ " + chrome.runtime.lastError.message;
            btn.disabled = false; btn.textContent = prevText;
            return;
          }
          if (resp?.ok) {
            if (statusEl) statusEl.textContent = "✅ Saved";
          } else {
            if (statusEl) statusEl.textContent = "❌ " + JSON.stringify(resp?.error || "Unknown error");
          }
          // 不自動開 Notion 頁面
          btn.disabled = false; btn.textContent = prevText;
        });
      });
    };

    // Settings 按鈕
    $("openOptions").onclick = () => {
      if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
      else window.open(chrome.runtime.getURL("options.html"));
    };
  });
})();
