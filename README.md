# Google Meet MCP Server

一個為 AI 助手（如 Claude）提供 Google Meet 整合功能的 Model Context Protocol (MCP) 伺服器。

## ✨ 主要功能

- **🚀 自動認證**：首次啟動或 token 過期時自動開啟瀏覽器認證，無需手動操作
- **📅 會議管理**：創建、更新、刪除和列出 Google Meet 會議
- **⚠️ 時間衝突檢測**：自動檢查並警告時間衝突
- **⏰ 可用性檢查**：查詢特定時間範圍的日曆可用性
- **🔗 完整的會議資訊**：提供詳細的會議連結、參與者資訊等
- **🌏 繁體中文介面**：完整的繁體中文使用者體驗
- **🔄 智慧回應**：創建會議後提供豐富的資訊給 LLM
- **🔐 安全認證**：支援 OAuth 2.0 安全認證，與 google-calendar-mcp 一致的配置方式

## 🚀 快速開始

### 前置需求

1. Node.js 18.0.0 或更高版本
2. 擁有 Google Cloud 專案並啟用 Calendar API
3. OAuth 2.0 憑證（Desktop App 類型）

### Google Cloud 設定

1. **前往 [Google Cloud Console](https://console.cloud.google.com)**
2. **創建或選擇專案**
3. **啟用 Google Calendar API**
   - 前往 [API 庫](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com)
   - 確認已選擇正確的專案
   - 點擊「啟用」
4. **創建 OAuth 2.0 憑證**
   - 前往「憑證」頁面
   - 點擊「創建憑證」>「OAuth 客戶端 ID」
   - 選擇「應用程式類型」為「桌面應用程式」（重要！）
   - 下載憑證檔案並儲存到安全位置
5. **設定 OAuth 同意畫面**
   - 新增您的電子郵件為測試用戶
   - 注意：測試模式下 token 每週會過期

### 安裝方式

**方式 1：使用 npx（推薦）**

在 Claude Desktop 配置中新增：

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "google-meet": {
      "command": "npx",
      "args": ["google-meet-mcp"],
      "env": {
        "GOOGLE_OAUTH_CREDENTIALS": "/path/to/your/credentials.json"
      }
    }
  }
}
```

**方式 2：本地安裝**

```bash
git clone https://github.com/your-repo/google-meet-mcp.git
cd google-meet-mcp
npm install
```

然後在 Claude Desktop 配置中使用本地路徑：

```json
{
  "mcpServers": {
    "google-meet": {
      "command": "node",
      "args": ["/path/to/google-meet-mcp/src/index.js"],
      "env": {
        "GOOGLE_OAUTH_CREDENTIALS": "/path/to/your/credentials.json"
      }
    }
  }
}
```

### 🎯 自動認證啟動

本專案採用與 [google-calendar-mcp](https://github.com/nspady/google-calendar-mcp) 相同的自動認證機制：

1. **設定環境變數**：
   ```bash
   export GOOGLE_OAUTH_CREDENTIALS="/path/to/your/credentials.json"
   ```

2. **啟動即自動認證**：
   - 首次啟動或 token 過期時，系統會自動開啟瀏覽器進行 Google OAuth 認證
   - 認證完成後，服務器會自動繼續啟動
   - 下次啟動時會自動使用已儲存的 token，無需重新認證

3. **重新啟動 Claude Desktop**

🎉 **就是這麼簡單！無需手動執行認證命令。**

## 🛠️ 環境變數配置

本專案支援與 [google-calendar-mcp](https://github.com/nspady/google-calendar-mcp) 一致的環境變數：

| 環境變數 | 描述 | 必需 |
|---------|------|------|
| `GOOGLE_OAUTH_CREDENTIALS` | OAuth 憑證檔案路徑（主要） | ✅ |
| `GOOGLE_MEET_CREDENTIALS_PATH` | 替代的憑證檔案路徑 | - |
| `GOOGLE_CALENDAR_MCP_TOKEN_PATH` | 自訂 token 儲存路徑 | - |
| `GOOGLE_MEET_TOKEN_PATH` | 替代的 token 儲存路徑 | - |

## 📋 可用工具

| 工具名稱 | 描述 | 主要參數 |
|---------|------|---------|
| `list_meetings` | 📅 列出即將到來的會議 | `max_results`, `time_min`, `time_max` |
| `get_meeting` | 🔍 獲取特定會議詳情 | `meeting_id` |
| `create_meeting` | ✨ 創建新會議（含衝突檢測） | `summary`, `start_time`, `end_time`, `attendees`, `check_conflicts` |
| `update_meeting` | 📝 更新現有會議 | `meeting_id`, `summary`, `start_time`, `end_time`, `attendees` |
| `delete_meeting` | 🗑️ 刪除會議 | `meeting_id` |
| `check_availability` | ⏰ 檢查時間可用性 | `start_time`, `end_time`, `calendars` |

## 💬 使用範例

### 創建會議
```
請幫我創建一個明天下午 2 點到 3 點的團隊會議，主題是「專案進度討論」，邀請 john@example.com 和 mary@example.com
```

### 檢查時間衝突
```
我想安排一個下週一上午 10 點到 11 點的會議，請先檢查是否有時間衝突
```

### 列出即將到來的會議
```
請顯示我今天的所有 Google Meet 會議
```

### 多步驟操作
```
請幫我：
1. 檢查明天下午 3-4 點的時間是否可用
2. 如果可用，創建一個客戶會議
3. 邀請 client@example.com 參加
```

## 🔧 故障排除

### 常見問題

**1. OAuth 憑證檔案找不到**
- 確認 `GOOGLE_OAUTH_CREDENTIALS` 環境變數設定正確
- 檢查檔案路徑是否存在且可讀取
- 使用絕對路徑

**2. 認證錯誤**
- 確認憑證檔案為「桌面應用程式」類型
- 檢查您的 Google 帳號是否為測試用戶
- 重新啟動服務器會自動觸發認證流程

**3. Token 每週過期**
- 這是 Google Cloud 測試模式的限制
- 考慮將應用程式發布到生產模式（需要 Google 審核）
- 或定期重新認證

**4. API 權限錯誤**
- 確認 Google Calendar API 已啟用
- 檢查 OAuth 範圍是否正確
- 確認帳號有存取日曆的權限

### 手動重新認證

```bash
# 刪除現有 token
rm ~/.config/google-meet-mcp/token.json  # Linux/macOS
# 或 del "%LOCALAPPDATA%\google-meet-mcp\token.json"  # Windows

# 重新啟動服務器會自動觸發認證流程
# 無需手動執行認證命令
```

## 🏗️ 開發

### 本地開發設定

```bash
git clone https://github.com/your-repo/google-meet-mcp.git
cd google-meet-mcp
npm install
npm start  # 會自動處理認證
```

### 專案結構

```
google-meet-mcp/
├── src/
│   ├── index.js          # 主要 MCP 伺服器（含自動認證）
│   ├── GoogleMeetAPI.js  # Google Calendar API 封裝
│   └── AuthServer.js     # 自動認證服務器
├── package.json
└── README.md
```

## 🤝 貢獻

歡迎提交 Issue 和 Pull Request！

## 📄 授權

ISC License

## 🙏 致謝

- 參考了 [google-calendar-mcp](https://github.com/nspady/google-calendar-mcp) 的環境變數配置方式
- 使用 [Model Context Protocol](https://github.com/modelcontextprotocol) 框架
- 感謝 Google Calendar API 提供強大的日曆整合功能

---
