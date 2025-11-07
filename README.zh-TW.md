# 🥇 競技疊杯網站

一個用於管理競技疊杯比賽、運動員資料和競賽記錄的綜合性網路應用程式。採用現代化網路技術打造，為賽事主辦方、運動員和管理員提供無縫體驗。

**[中文版 README](README.zh-TW.md)** | **[English Version](README.md)**

<!-- 在此添加主要網站截圖 -->
![網站預覽](image.png)

---

## ✨ 主要功能

### 🏆 賽事管理
*   **建立賽事**：設定包含多個項目的比賽（個人 3-3-3、3-6-3、Cycle、團體 3-6-3、雙人）
*   **分組設定**：自訂年齡組別和性別分組
*   **分級系統**：將決賽分為進階級、中級和初級

<!-- 在此添加賽事管理截圖 -->
![賽事管理](image-1.png)

### 📊 計分系統
*   **初賽計分**：記錄初賽成績並自動判定晉級資格
*   **決賽計分**：管理不同分級的多層級決賽
*   **即時排名**：根據成績自動更新排名
*   **顏色標示分級**：使用視覺標記區分不同晉級等級

<!-- 在此添加計分介面截圖 -->
![計分介面](image-2.png)

### 👤 運動員管理
*   **運動員檔案**：包含個人最佳成績和比賽歷史的完整檔案
*   **全球識別碼系統**：每位運動員在所有比賽中的唯一識別碼
*   **成績追蹤**：追蹤運動員在多個項目和賽季的表現
*   **頭像上傳**：個人化大頭照

<!-- 在此添加運動員檔案截圖 -->
![運動員檔案](image-3.png)

### 📈 記錄與排名
*   **項目記錄**：追蹤所有競技疊杯項目的記錄
*   **分組排名**：依年齡組別和性別分別排名
*   **歷史數據**：每位運動員的完整比賽歷史
*   **最佳成績**：自動追蹤個人和賽事最佳成績

<!-- 在此添加記錄頁面截圖 -->
![記錄與排名](image-4.png)

### 📝 報名系統
*   **線上報名**：簡便的賽事參賽者註冊
*   **多項目報名**：同時報名多個比賽項目
*   **團隊管理**：建立和管理團隊名單
*   **報名驗證**：自動驗證參賽者資訊

<!-- 在此添加報名表單截圖 -->
![報名系統](image-5.png)

### 📄 PDF 匯出
*   **成績匯出**：產生專業的賽事成績 PDF 報告
*   **分級圖例**：彩色圖例說明晉級等級
*   **完整分組**：匯出所有組別和分級

<!-- 在此添加 PDF 匯出範例 -->
![PDF 匯出範例](image-6.png)

### 🔐 使用者認證
*   **安全登入**：使用 Firebase 認證確保安全存取
*   **角色權限**：為使用者、主辦方和管理員設定不同權限等級
*   **受保護路由**：需要認證才能存取的安全頁面

### 🎯 管理員儀表板
*   **使用者管理**：管理使用者角色和權限
*   **輪播管理**：更新首頁輪播圖片
*   **團隊招募**：管理團隊招募公告
*   **網站設定**：配置全域應用程式設定

<!-- 在此添加管理員儀表板截圖 -->
![管理員儀表板](image-7.png)

### 📱 響應式設計
*   **行動優化**：所有裝置的完整響應式佈局
*   **觸控友善**：針對觸控互動優化
*   **跨瀏覽器**：相容所有現代瀏覽器

<!-- 在此添加響應式設計展示 -->
![響應式設計](image-8.png)

---

## 🚀 技術棧

### 前端框架

| 類別 | 技術 | 說明 |
| --- | --- | --- |
| **介面框架** | [React 18](https://reactjs.org/) | 現代化組件式函式庫 |
| **建置工具** | [Vite](https://vitejs.dev/) | 極速開發伺服器與打包工具 |
| **型別系統** | [TypeScript](https://www.typescriptlang.org/) | 靜態型別檢查 |
| **介面組件** | [Arco Design React](https://arco.design/) | 企業級 UI 組件庫 |
| **路由** | [React Router v6](https://reactrouter.com/) | 聲明式路由 |
| **狀態管理** | [Jotai](https://jotai.org/) | 原子化且靈活的狀態管理 |

### 樣式設計

| 類別 | 技術 | 說明 |
| --- | --- | --- |
| **CSS 框架** | [Tailwind CSS](https://tailwindcss.com/) | 工具優先的 CSS 框架 |
| **CSS 預處理器** | SCSS | 支援變數與巢狀的增強 CSS |
| **PostCSS** | [PostCSS](https://postcss.org/) | CSS 轉換工具 |

### 表單與驗證

| 類別 | 技術 | 說明 |
| --- | --- | --- |
| **表單處理** | [React Hook Form](https://react-hook-form.com/) | 高效能表單驗證 |
| **模式驗證** | [Zod](https://zod.dev/) | TypeScript 優先的模式驗證 |

### 後端與服務

| 類別 | 技術 | 說明 |
| --- | --- | --- |
| **後端即服務** | [Firebase](https://firebase.google.com/) | 完整後端解決方案 |
| **資料庫** | [Cloud Firestore](https://firebase.google.com/docs/firestore) | NoSQL 雲端資料庫 |
| **身份認證** | [Firebase Auth](https://firebase.google.com/docs/auth) | 安全的使用者認證 |
| **雲端函數** | [Firebase Functions](https://firebase.google.com/docs/functions) | 無伺服器後端邏輯 |
| **託管** | [Firebase Hosting](https://firebase.google.com/docs/hosting) | 快速且安全的網頁託管 |
| **儲存** | [Firebase Storage](https://firebase.google.com/docs/storage) | 檔案儲存與傳輸 |

### PDF 生成

| 類別 | 技術 | 說明 |
| --- | --- | --- |
| **PDF 函式庫** | [jsPDF](https://github.com/parallax/jsPDF) | 客戶端 PDF 生成 |
| **表格插件** | jsPDF-AutoTable | PDF 自動表格生成 |

### 開發工具

| 類別 | 技術 | 說明 |
| --- | --- | --- |
| **程式碼品質** | [Biome](https://biomejs.dev/) | 快速格式化與檢查工具 |
| **程式碼檢查** | [ESLint](https://eslint.org/) | 可插拔的 JavaScript 檢查工具 |
| **程式碼格式化** | [Prettier](https://prettier.io/) | 固定風格的程式碼格式化工具 |
| **套件管理** | [Yarn](https://yarnpkg.com/) | 快速可靠的依賴管理 |

### 其他函式庫

| 類別 | 技術 | 說明 |
| --- | --- | --- |
| **日期處理** | Custom hooks | 智慧型賽事日期處理 |
| **圖示** | [Arco Design Icons](https://arco.design/react/components/icon) | 圖示庫 |
| **通知** | Arco Message & Notification | 通知訊息 |

<!-- 在此添加技術棧視覺化圖表 -->
![技術棧圖表](link-to-your-image)

---

## 📦 可用指令

### 開發

| 指令 | 說明 |
| --- | --- |
| `yarn dev` | 啟動開發伺服器 |
| `yarn build` | 建置專案至生產環境 |
| `yarn preview` | 預覽生產環境建置結果 |

### 程式碼品質

| 指令 | 說明 |
| --- | --- |
| `yarn typecheck` | 執行 TypeScript 型別檢查 |
| `yarn lint` | 使用 Biome 檢查檔案 |
| `yarn format` | 使用 Biome 格式化檔案 |
| `yarn fix` | 使用 Biome 自動修正問題 |
| `yarn validate` | 同時執行型別檢查和程式碼檢查 |

### 雲端函數

| 指令 | 說明 |
| --- | --- |
| `yarn workspace functions build` | 建置雲端函數 |
| `yarn workspace functions serve` | 本地執行函數模擬器 |
| `yarn workspace functions deploy` | 部署函數至 Firebase |

---

## 🏁 開始使用

### 前置需求

*   [Node.js](https://nodejs.org/) (v18 或更高版本)
*   [Yarn](https://yarnpkg.com/) - 套件管理工具
*   [Firebase](https://firebase.google.com/) 專案

### 安裝步驟

1.  **複製儲存庫:**
    ```bash
    git clone https://github.com/KJiShou/Sport-Stacking-Website.git
    cd Sport-Stacking-Website
    ```

2.  **安裝依賴套件:**
    ```bash
    yarn
    ```

3.  **設定 Firebase:**
    *   在專案根目錄建立 `.env` 檔案
    *   將 Firebase 專案配置加入 `.env` 檔案
    *   可從 Firebase 控制台取得此資訊
    *   路徑：`專案設定 > 一般 > 您的應用程式 > 網頁應用程式`

    ```env
    VITE_API_KEY=your-api-key
    VITE_AUTH_DOMAIN=your-auth-domain
    VITE_PROJECT_ID=your-project-id
    VITE_STORAGE_BUCKET=your-storage-bucket
    VITE_MESSAGING_SENDER_ID=your-messaging-sender-id
    VITE_APP_ID=your-app-id
    ```

4.  **執行開發伺服器:**
    ```bash
    yarn dev
    ```
    應用程式將在 `http://localhost:5173` 上運行

5.  **建置並部署雲端函數:**
    ```bash
    cd functions
    yarn build
    yarn deploy
    ```

6.  **返回開發模式:**
    ```bash
    cd ..
    yarn dev
    ```

<!-- 在此添加安裝指南截圖 -->
![安裝指南](link-to-your-image)

---

## 📂 專案結構

```
/
├── public/                      # 靜態資源
│   ├── robots.txt              # SEO 爬蟲檔案
│   ├── sitemap.xml             # 網站地圖
│   └── images/                 # 公開圖片
│
├── src/
│   ├── assets/                 # 圖片、圖示等
│   │   └── icon.avif           # 應用程式圖示
│   │
│   ├── components/             # 可重用的 React 組件
│   │   ├── common/             # 通用組件
│   │   │   ├── AvatarUploader.tsx    # 頭像上傳組件
│   │   │   ├── Login.tsx             # 登入組件
│   │   │   └── ProtectedRoute.tsx    # 路由保護
│   │   └── layout/             # 佈局組件
│   │       ├── Navbar.tsx            # 導覽列
│   │       └── Footer.tsx            # 頁尾
│   │
│   ├── config/                 # 應用程式配置
│   │   └── routes.tsx          # 路由定義
│   │
│   ├── constants/              # 常數值
│   │   └── tournamentDefaults.ts     # 賽事預設值
│   │
│   ├── context/                # React 上下文提供者
│   │   └── AuthContext.tsx     # 認證上下文
│   │
│   ├── hooks/                  # 自訂 React hooks
│   │   └── DateHandler/        # 日期處理 hooks
│   │       └── useSmartDateHandlers.ts
│   │
│   ├── pages/                  # 頁面組件
│   │   ├── Admin/              # 管理員頁面
│   │   │   ├── AdminPermission.tsx          # 權限管理
│   │   │   ├── CarouselManagement.tsx       # 輪播管理
│   │   │   └── TeamRecruitmentManagement.tsx # 團隊招募
│   │   ├── Athletes/           # 運動員頁面
│   │   ├── Home/               # 首頁
│   │   ├── Records/            # 記錄頁面
│   │   ├── Tournaments/        # 賽事頁面
│   │   │   ├── Scoring/        # 計分介面
│   │   │   ├── FinalResults/   # 決賽結果
│   │   │   └── Component/      # 賽事組件
│   │   └── User/               # 使用者頁面
│   │
│   ├── schema/                 # Zod 驗證模式
│   │   ├── TournamentSchema.ts        # 賽事模式
│   │   ├── RecordSchema.ts            # 記錄模式
│   │   ├── UserProfileSchema.ts       # 使用者檔案模式
│   │   ├── AuthSchema.ts              # 認證模式
│   │   └── ...                        # 其他模式
│   │
│   ├── services/               # API 服務
│   │   └── firebase/           # Firebase 服務
│   │       ├── recordService.ts       # 記錄操作
│   │       ├── athleteService.ts      # 運動員操作
│   │       ├── userHistoryService.ts  # 使用者歷史
│   │       └── ...                    # 其他服務
│   │
│   ├── types/                  # TypeScript 型別定義
│   │
│   ├── utils/                  # 工具函數
│   │   ├── PDF/                # PDF 工具
│   │   │   └── pdfExport.ts    # PDF 匯出函數
│   │   ├── Date/               # 日期工具
│   │   ├── tournament/         # 賽事工具
│   │   └── ...                 # 其他工具
│   │
│   ├── App.tsx                 # 主應用程式組件
│   ├── main.tsx                # 進入點
│   ├── firebaseConfig.js       # Firebase 配置
│   └── global.scss             # 全域樣式
│
├── functions/                  # Firebase 雲端函數
│   ├── src/
│   │   ├── index.ts            # 函數進入點
│   │   └── schema/             # 函數模式
│   ├── lib/                    # 編譯輸出
│   ├── package.json            # 函數依賴
│   └── tsconfig.json           # TypeScript 配置
│
├── config/                     # 配置檔案
│   ├── biome/                  # Biome 配置
│   ├── eslint/                 # ESLint 配置
│   ├── firebase/               # Firebase 配置
│   ├── prettier/               # Prettier 配置
│   ├── tailwind/               # Tailwind 配置
│   └── vite/                   # Vite 配置
│
├── firebase.json               # Firebase 配置
├── firestore.rules             # Firestore 安全規則
├── firestore.indexes.json      # Firestore 索引
├── vite.config.js              # Vite 配置
├── tailwind.config.js          # Tailwind 配置
├── biome.json                  # Biome 配置
├── package.json                # 專案依賴
└── tsconfig.json               # TypeScript 配置
```

<!-- 在此添加專案結構圖表 -->
![專案結構](link-to-your-image)

---

## 🗃️ 混合式使用者歷史快取

### 概述

本應用程式實現了一個高效的運動員賽事歷史快取系統，以優化效能並減少資料庫查詢。

<!-- 在此添加快取架構圖 -->
![快取架構](link-to-your-image)

### 運作方式

- **快取歷史文件**: 雲端函數在 `user_tournament_history/{globalId}` 為每位運動員維護快取歷史文件，透過聚合賽事記錄寫入。

- **自動同步**: 觸發器 `syncUserTournamentHistory` 監聽 `tournaments/{id}/events/**/records` 下的更新，並為每位受影響的參賽者、領隊和團隊成員重建快取。

- **客戶端存取**: 從客戶端使用 `src/services/firebase/userHistoryService.ts` 中的 `fetchUserTournamentHistory` 或 `subscribeUserTournamentHistory` 來消費快取，避免每次載入頁面時掃描賽事子集合。

- **模式驗證**: 快取資料透過 `UserTournamentHistorySchema` 驗證，確保雲端函數和客戶端消費者之間的一致性。

### 優勢

✅ **效能**: 快速減少頁面載入時間，避免深層子集合查詢

✅ **可擴展性**: 有效處理大型賽事資料集

✅ **一致性**: 自動同步確保資料始終保持最新

✅ **成本效益**: 大幅減少 Firestore 讀取操作

---

## 🎨 關鍵功能實作

### 分級系統

賽事系統支援精密的分級機制：

- **初賽**: 所有參賽者參加（`prelim`）

- **決賽分級**:
  - **進階級** (`advance`): 頂尖表現者
  - **中級** (`intermediate`): 中級競爭者
  - **初級** (`beginner`): 入門級決賽

### 顏色編碼

**介面顯示**:
- 🟢 綠色 (#52c41a) = 進階級
- 🔵 藍色 (#1890ff) = 中級
- 🟠 橘色 (#fa8c16) = 初級

**PDF 匯出**:
- 🟡 黃色 = 進階級
- 🟢 淺綠色 = 中級
- 🔵 淺藍色 = 初級
- 🟠 橘粉色 = 未晉級

<!-- 在此添加分級系統截圖 -->
![分級系統](link-to-your-image)

---

## 🤝 貢獻

歡迎貢獻！請隨時提交 Pull Request。

### 開發指南

1. 遵循 `biome.json` 中定義的編碼風格

2. 提交前執行 `yarn validate`

3. 所有新程式碼使用 TypeScript

4. 為資料驗證添加適當的 Zod 模式

5. 遵循專案結構慣例

---

## 📝 授權

本專案採用 MIT 授權 - 詳見 [LICENSE](LICENSE) 檔案。

---

## 👥 作者

- **KJiShou** - [GitHub 個人檔案](https://github.com/KJiShou)

---

## 🙏 致謝

- 感謝所有幫助此專案成長的貢獻者

- 採用現代網路技術和最佳實踐建置

- 特別感謝競技疊杯社群

---

## 📧 聯絡方式

如有問題或需要支援，請在 GitHub 上開啟 issue。

---

<div align="center">

**為競技疊杯社群用心打造 ❤️**

<!-- 在此添加頁尾標誌或圖片 -->
![頁尾](link-to-your-image)

</div>
