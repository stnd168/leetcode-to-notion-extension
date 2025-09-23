# LeetCode → Notion (Chrome Extension)

我製作了一個 Chrome 擴充功能，能夠將 **LeetCode 題目與程式碼** 一鍵保存到 **Notion Database**。

![image](https://github.com/stnd168/leetcode-to-notion-extension/blob/main/info/info.png)

---

## ✨ 功能
- 只需在Options 頁面設定 **Notion Token** 與 **Database ID**即可開始使用
- 自動讀取 LeetCode 題目資訊（標題、難度、Topic、描述）
- 一鍵 Save 到 Notion Database
- 更新同一題目時，自動覆蓋（支援 Times/Correct 累積）
- 會根據Review 狀態自動幫你設定下次複習時間
- UI 正確回答可勾選「Correct」、並選擇 Importance / Review / Language
---

## ⚙️ 安裝與使用

1. 下載或 clone 此專案：
   git clone https://github.com/stnd168/leetcode-to-notion-extension.git
2. 打開 Chrome → chrome://extensions/
3. 開啟右上角「開發人員模式」
4. 點選「載入未封裝項目」並選擇專案資料夾
5. 點擊插件圖示，開啟 Options，輸入：
6. Notion Token（從 Notion Developer Portal 取得），Database ID（你的 Notion Database ID）
7. 打開任一 LeetCode 題目頁 → 點 Save，即可同步到 Notion 🎉

![image](https://github.com/stnd168/leetcode-to-notion-extension/blob/main/info/option.png)

---
## 📖 LeetCode 模板
我所使用的模板可以在[這裡](https://chrome-saturn-552.notion.site/277a5cc67b55808481fce692b517c255?v=277a5cc67b558144949c000ccdc1de77&source=copy_link)找到，歡迎使用。
如果您喜歡使用自己的表格，請確保欄位設定與我的一致。如果不一致，您可能需要相應地修改腳本。

---
## 📝 Notion 設定
1. 請依照[Notion API 官方文件](https://developers.notion.com/docs/create-a-notion-integration)中的教學課程，從步驟 1 到步驟 3 進行操作。
2. 複製您的Notion token 和 Database ID 至插件中。

如果您有任何其他問題或需要額外協助，歡迎詢問我。
