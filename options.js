(async function() {
  const $ = id => document.getElementById(id);

  // 載入已儲存的設定
  chrome.storage.sync.get(["token", "dbid", "importance", "review"], (cfg) => {
    $("token").value = cfg.token || "";
    $("dbid").value = cfg.dbid || "";
    // $("importance").value = cfg.importance || "基礎";
    // $("review").value = cfg.review || "need review";
  });

  // 儲存設定
  $("save").onclick = () => {
    chrome.storage.sync.set({
      token: $("token").value.trim(),
      dbid: $("dbid").value.trim(),
      // importance: $("importance").value.trim() || "基礎",
      // review: $("review").value.trim() || "need review"
    }, () => $("msg").textContent = "已儲存 ✓");
  };

  // 測試連線到 Notion
  $("test").onclick = async () => {
    const token = $("token").value.trim();
    const dbid = $("dbid").value.trim();
    if (!token || !dbid) {
      $("testResult").textContent = "❌ 請先輸入 Notion Token 與 Database ID";
      return;
    }

    $("testResult").textContent = "⏳ 測試中...";

    try {
      const resp = await fetch(`https://api.notion.com/v1/databases/${dbid}`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28"
        }
      });

      const data = await resp.json();
      if (resp.ok) {
        $("testResult").textContent = "✅ 測試成功！已連線到資料庫: " + (data.title?.[0]?.plain_text || "無標題");
      } else {
        $("testResult").textContent = "❌ 測試失敗: " + JSON.stringify(data);
      }
    } catch (e) {
      $("testResult").textContent = "❌ 測試錯誤: " + e.message;
    }
  };
})();
