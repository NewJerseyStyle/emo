# omo 專案管理層 (Project Management Layer) — PLAN

> Status: **final**（已定案，2026-09-08）
> Started: 2026-09-07
> 開放問題以 LEAN MVP 模式決策（見 §11）。開始 P2 prototyping。

---

## 1. 願景

把 oh-my-openagent (omo) 從「單一執行 agent」擴展成一個 **PMI 方法論驅動的多 agent 專案管理層**：

- 用戶輸入 → **BA**（業務分析）→ **PM**（專案規劃）→ **ulw-loop**（執行）
- 所有專案文件（plan/spec/decisions/change-requests/closures/todos）存於 **git 共享 repo**，跨 omo 實例共享、版本化、可審計
- 原本的 **cache-compaction 變成階段性 project closure 文件**（成本管理 + 知識管理合一）

## 2. 核心架構

```
┌────────────────────────────────────────────────────────────┐
│ ① 智慧層 (Agents)                                          │
│    Main Process (薄路由器)                                  │
│      ├─ BA (subagent, read-only) → 分類/釐清/CR/安撫        │
│      ├─ PM (subagent, read-only) → 規劃/可行性/validation   │
│      └─ ulw-loop (執行) → 文件 + 代碼 (TDD)                 │
├────────────────────────────────────────────────────────────┤
│ ② 記憶層 (HL repo - git, 本地共享 + server remote 鏡像)      │
│    project-plan / spec / decisions / change-requests /      │
│    closures / todos / skills                                │
├────────────────────────────────────────────────────────────┤
│ ③ 編排層 (Plugin)                                          │
│    路由用戶輸入 → BA → PM → ulw；交接點觸發壓縮→closure     │
├────────────────────────────────────────────────────────────┤
│ ④ 成本層 (Cache-compaction, P1 已做)                       │
│    決策引擎 → 壓縮 → 產出階段性 closure 文件                │
└────────────────────────────────────────────────────────────┘
```

### 2.1 記憶原則（重要）

- **不靠 context 累積，靠 documents 累積**：所有分析/知識/歷史寫入 HL repo 文件，**不留在 context**。
- **context 只維持 working memory**：當前任務的即時狀態（正在做什麼、下一步）。
- BA/PM subagent **stateless**：讀取相關文件 → 分類/規劃 → 寫回更新 → 返回。不累積跨 session 分析。
- 這解決 context rot：分析不腐化，因為分析不在 context，而在版本化的 documents。

### 2.2 語言無關

- 輸入語言不固定（簡/繁中、英、日…）。
- BA 偵測輸入語言，**以同語言回應**。
- 分類是語意層面，與語言無關（intent 語意跨語言一致）。

## 3. 角色定義

### Main Process（薄路由器 / orchestrator）
- 用戶的主要介面
- 只做路由：委派 BA → PM → ulw-loop，自己保持精簡
- **不累積分析**（避免 context rot）— 重活全在 subagent

### BA（Business Analyst）— subagent, read-only
- **輸入分類（LLM-first）**：每個用戶輸入都過 BA，用 LLM 析出**原子意圖**（多數輸入混雜）
- **引導用戶行為（elicitation）**：PMBOK「需求是引出而非收集」——BA 用結構化提問引導用戶，並**教導用戶**用更清晰的格式（如「新目標: …」「反饋: …」），讓未來輸入更易分類、未來可規則化
- **混雜輸入處理**：一次互動混雜多種意圖 → BA 拆解、排序、甚至安撫
- **新目標** → 依 PMI/PMBOK 釐清 scope、objectives、deliverables → 產出 `project-plan.md` 草稿
- **反饋** → 反思「如何在更少步數/token 做得更好」→ 起草 `change-request.md`
- **Change requirement** → BA 負責編寫文件，確保流程可 audit/distill
- **資訊管理**：業務層（用戶要什麼）+ 邏輯層（約束、依賴、風險）
- **Living document**：維護 `ba-memory.md`（工作記憶，跨 session 演化）
- **直通情境**：判斷無需工作 → 直接交還 ulw（fast path，不經 PM）
- **語言無關**：偵測輸入語言，以同語言回應
- **確認 + tl;dr**：分類/起草文件後，提供文件 + `tl;dr` 給用戶確認 align
- **分階段拆分**：用戶對部分功能猶豫不決時 → 提議分階段實施，先做已確認部分，拆成多個 sub-project
- **安撫策略（4F）**：見 §3.5

#### 3.5 安撫策略（4F surviving strategies）

> 參考 4F（Fight / Flight / Freeze / Fawn）——創傷生存反應。

- 若用戶展現 **defensive / 4F surviving strategies**（防禦、逃避、僵住、討好）：
  - **少量安撫**，但**依然聚焦工作目標**，不做情緒支援
  - 偶爾鼓勵用戶休息一下，之後再討論
- 界線：安撫是手段，不是目的；不偏離工作目標
- 偵測訊號：防禦性措辭、反覆抱怨、逃避具體任務、過度討好 → 寫入 living doc（用戶狀態）

#### 3.1 BA 輸入分類 Taxonomy（LLM-first）

> 分類由 BA（LLM）執行，輸出結構化 JSON：`{intents: [{type, summary, confidence}], needs_clarification, guidance}`。
> **不設規則層**（初期）——多數輸入混雜，規則太脆。BA 引導用戶行為後，未來可視情況加入規則 fast-path。

| 類別 | 描述 | 路由 |
|------|------|------|
| **NEW_GOAL** | 新目標/新功能/新專案 | → PM 規劃 |
| **NEXT_STEP** | 繼續目前工作，plan 的下個任務 | → 直接 ulw（無需 PM） |
| **CHANGE_REQUEST** | 修改既有需求/scope | → PM 更新 plan |
| **FEEDBACK** | 對先前工作的反應（正面/負面） | → 反思 + 可能 CR |
| **BUG_DEBUG** | 缺陷回報 / debug 任務 | → PM（或 trivial 直接 ulw） |
| **QUESTION** | 澄清問題，無開發工作 | → BA 直接回答 |
| **COMPLAINT** | 埋怨/挫折 | → BA 安撫，可能轉 CR |
| **CONTEXT_DUMP** | 提供大量資訊，無立即動作 | → BA 記錄到 living doc |
| **PREFERENCE** | 風格/慣例偏好 | → BA 記錄，可能 CR |
| **PROCESS_FEEDBACK** | 工作流本身該怎麼改 | → 更新流程 |
| **STATUS_INQUIRY** | 我們到哪了/狀態 | → BA/PM 回報 |
| **CONTINUE** | 只是繼續 | → 直接 ulw（BA 直通） |
| **CANCEL_SCOPE** | 取消/縮減 scope | → PM 更新 plan |
| **META** | 改 omo/plugin/工具本身 | → 特殊處理 |
| **NOISE** | 離題 | → 忽略/確認 |

**混雜輸入**：拆解成原子意圖 → 排序（如「埋怨+新目標」→ 先安撫再釐清目標）→ 各自路由。

**用戶使用習慣觀察**：冗長度、偏好 stack、常見失敗模式、反饋頻率、滿意度訊號、時間模式 → 寫入 living doc。

**BA 引導用戶**：分類後，BA 可教導用戶用更清晰格式（elicitation），逐步讓輸入更結構化 → 未來可規則化 fast-path。

**直通 ulw 情境**：CONTINUE / NEXT_STEP / 已回答的 QUESTION → BA 直通 ulw，**不經 PM 規劃**（薄路由器 fast path）。

#### 3.2 BA Living Document（工作記憶）

`ba-memory.md`（存於 HL repo `projects/<id>/`）：
- 用戶偏好、溝通風格、冗長度
- 開放問題、假設（assumption log）、決策（decision log）
- 持續關注、未解決的埋怨/顧慮
- 使用習慣觀察
- 跨 session 演化（每次 BA 互動後更新）

#### 3.3 PMI/PMBOK 文檔類型對映（已上網查證）

> PMBOK 8 將文件分三類：**project management plan**（如何管理）、**project documents**（支持執行）、**business documents**（商業理由）。BA 主要產出 project documents。

| PMI 文檔 | 對應 HL repo 位置 | 由誰維護 |
|---|---|---|
| Project Charter | `project-plan.md`（願景/目標/scope） | BA |
| Scope Statement / WBS | `project-plan.md`（deliverables/milestones） | PM |
| Business Case | `project-plan.md`（business need） | BA |
| Stakeholder Register/Map | `ba-memory.md`（stakeholders） | BA |
| Requirements Doc（BRD/FRD） | `spec.md` | BA+PM |
| Requirements Traceability Matrix (RTM) | `spec.md`（req→source→acceptance→test） | BA+PM |
| Change Request / Change Log | `change-requests/` | BA |
| Decision Log | `decisions/`（ADR） | BA+PM |
| Assumption Log | `ba-memory.md`（assumptions） | BA |
| Issue Log | `ba-memory.md`（issues） | BA |
| Risk Register | `project-plan.md`（risk） | PM |
| Lessons Learned Register | `closures/` | 壓縮 |
| Project Closure / Closeout / Final Report | `closures/` | 壓縮 |

**需求屬性**（BABOK）：每個需求帶 unique ID、source、priority、status、acceptance criteria → 存於 `spec.md` 的 frontmatter/表格。

**優先級技術**：MoSCoW（Must/Should/Could/Won't）、加權評分、Kano → PM 用於排程。

**引導技術**（elicitation）：interviews、workshops、document analysis、observation、prototyping、questionnaires → BA 用於釐清混雜輸入。

### PM（Project Manager）— subagent, read-only
- 讀取 BA 的 plan/spec + 先前 closures → 規劃具體開發
- **技術選型 + token 估算**（每任務）— 見 §3.4
- **可行性研究**（參考網上資訊/文件，用 librarian）
- **plan & spec 編輯確認 + validation loop**（驗證基準可測）
- 產出**可執行任務** → 交給 ulw-loop

#### 3.4 Token 估算（類比人類 PM 估 man-day）

> 人類 PM 估 man-day，我們估 tokens。估算基準 = 文件長度 + 代碼長度 + 複雜度。

```
token_estimate = f(doc_length, code_length, complexity)
```

- **文件長度**：spec/plan 的 token 數（直接量測）
- **代碼長度**：新增/修改代碼的估算 token 數
- **複雜度**：用 **Model of Hierarchical Complexity (MHC)** 判定任務的階層複雜度（0-14 階），越高階 = 越多遞迴協調 = 需要越多 **reasoning budget**
  - 低階（concrete/abstract，8-9）：直接實作，少 reasoning
  - 中階（formal/systematic，10-11）：需協調多子任務
  - 高階（metasystematic/paradigmatic，12-13）：跨系統整合、架構決策
- 每任務輸出 `{estimated_tokens, reasoning_budget, confidence}` → 供 PM 排程 + closure 對比實際

### ulw-loop（執行）
- 依 PM 的任務 + 可驗證框架（TDD）建立文件與代碼
- 完成任務

## 4. PMBOK 方法論對映

| PMBOK Process Group | 角色 | 產出 |
|---|---|---|
| **Initiating** | BA | 釐清目標、scope、stakeholder（用戶）、安撫 |
| **Planning** | PM | scope/schedule/cost(token)/risk/quality |
| **Executing** | ulw-loop | 文件 + 代碼（TDD 可驗證框架） |
| **Monitoring & Controlling** | PM+BA | validation loop、change request |
| **Closing** | 壓縮 | closure 文件 |

## 5. 記憶層：HL repo（git, 本地共享為主 + server remote 鏡像）

```
<hl-repo>/
├── projects/
│   └── <project-id>/
│       ├── project-plan.md      # PMI：scope/objectives/deliverables/milestones
│       ├── spec.md              # 規格（驗證基準）
│       ├── decisions/           # ADR（含 supersedes chain）
│       ├── change-requests/     # CR（BA 起草，PM 排程）
│       ├── closures/            # 階段性 closure（由壓縮產出）
│       └── todos/               # 任務狀態（供 ulw 執行）
├── skills/                      # 共享 skills（ba/pm/ulw-loop）
│   ├── ba/SKILL.md
│   ├── pm/SKILL.md
│   └── ...
└── index.md                     # 目錄
```

- **兩種部署模式（本地共享為主，不採 repo-local clone）**：
  - **本地共享（預設）**：`~/.hl` 本地共享目錄即為主要工作儲存，其他 session 直接共享同一目錄
  - **server remote（鏡像備份）**：本地共享目錄仍是主要工作儲存；server remote 僅作為 push 鏡像（備份/同步），**不 clone remote 當 local cache**。有 remote 且 autoPush 時，每次 commit 後 push 到 remote
- 接線：opencode `references`（git repository 或 local path）+ `skills.paths`
- Git 紀律：1 壓縮/CR = 1 commit = 1 revert；supersession chain；frontmatter 驗證

## 6. 工作流

```
用戶輸入 (chat.message) — 每個輸入都過 BA
   │
   ▼
BA 分類 ──新目標──→ BA 釐清 scope → PM 規劃+可行性 → ulw-loop 執行
   │                    │
   ├──下一步──→ PM 讀 plan → 排下個任務 → ulw-loop 執行
   │
   ├──反饋──→ BA 反思+起草 CR → PM 更新 plan/spec → ulw-loop 執行
   │
   └──埋怨/混雜──→ BA 拆解 + 安撫 → 分類後走對應路徑
                    │
                    ▼
           交接點 (session.idle)
                    │
                    ▼
         Cache-compaction 決策引擎 (P1)
                    │
             壓縮 → 寫 closure 文件 → git commit
```

## 7. 成本層整合

P1 決策引擎（已做）輸出到 git：
- `compact` action → `session.summarize` → 結構化萃取 → 寫 `closures/<phase>.md` → git commit
- closure 帶 frontmatter：`phase`、`tokens_saved`、`decisions`、`supersedes`

### 7.1 Closure 文件格式（參考 PMI project closure / final report）

> PMBOK 8 final report 結構。closure 是「階段性」的 final report。

```
closures/<phase>.md
├── Project Summary        # objectives / scope / outcomes
├── Performance vs Baseline # 預估 tokens vs 實際 tokens（§3.4）
├── Deliverables Summary    # 交付物 + acceptance status
├── Issues & Changes        # 重要 issue + change requests
├── Risk Summary            # 已實現風險 + 緩解結果
├── Lessons Learned         # what happened / why / what to do differently
├── Value Realization       # 對 business case 的價值
├── Handover                # 交接給下一 phase / operations
└── Closure Approval        # 用戶確認
```

- **Lessons Learned 三要素**：what happened / why it happened / what to do differently（缺一不可）
- **tokens_saved**：實際節省的 token（對比不壓縮的 cold start）
- 產出後 → git commit → 供 PM 未來規劃參考（EvolveR 式經驗檢索）

### 7.2 Plugin 的角色：context 管理（核心）

> Plugin **基本上只在與用戶交互時觸發**。主要任務是**管理 context**：
> 1. **注入經驗資訊**（從 HL repo 檢索相關 closures/lessons/decisions → 注入當前 context）
> 2. **整理經驗**（把 context 中的經驗萃取 → 寫入 HL repo，節省 long context 下的 token）
> 3. **避免 rot**（documents 累積，context 只留 working memory）

```
用戶交互 (chat.message)
   │
   ▼
Plugin 觸發
   ├─ 注入：從 HL repo 檢索相關經驗 → 注入 context
   ├─ 路由：BA → PM → ulw
   └─ 整理：交接點 → 萃取經驗 → 寫 closure → git commit
```

### 7.3 BA/PM 自我強化（經驗管理系統）

> BA/PM 自己的工作也可用類似經驗管理系統逐漸強化。參考 **MemSkill**（meta-memory）+ **EvolveR**（經驗生命週期）。

- **MemSkill 洞察**：演化出的 skills 不是經驗本身，而是 **meta-memory**——「該提取什麼、怎麼記、聚焦哪、保留/遺忘什麼」
- **EvolveR 洞察**：從過去 trajectory 蒸餾抽象原則 → 檢索引導未來行動 → 閉環
- 應用於 BA/PM：
  - **BA**：從過往分類/引導互動中學習「如何更好分類、如何更好引導用戶」→ 寫入 `skills/ba/` 的經驗文件
  - **PM**：從過往 token 估算/規劃中學習「如何更準估算、如何更好排程」→ 寫入 `skills/pm/` 的經驗文件
  - 每個 closure 的 lessons learned → 反饋回 BA/PM 的經驗庫
  - 逐步強化分類準確度、token 估算準確度、引導效果

## 8. 分階段實作

| 階段 | 內容 | 驗證 |
|------|------|------|
| **P1** ✅ | 決策引擎 + 狀態機（已做） | bun test 23 pass |
| **P2** | git 文件庫模組（ensure/read/write/commit/push + schema） | 單元測試 + 真實 git repo |
| **P3** | BA agent（分類 + 釐清 + CR 起草 + 安撫） | agent 定義 + 分類邏輯測試 |
| **P4** | PM agent（規劃 + token 估算 + 可行性 + validation） | agent 定義 + 規劃邏輯測試 |
| **P5** | 編排層（路由 BA→PM→ulw + 交接點） | 端到端流程測試 |
| **P6** | 壓縮→closure 寫入 git 整合 | 端到端 + 真實 repo 驗證 |
| **P7** | 分發（npm + postinstall + HL repo 設定） | 安裝測試 |

## 9. 已確認決策

- [x] BA/PM = **subagents**（非 skills）— 解決 context rot
- [x] Main process = **薄路由器**（不累積分析）
- [x] HL repo = **server remote + local cache**；無 server 時「遠端」= `~/.hl` 本地共享目錄
- [x] BA 每個用戶輸入都過
- [x] 引入 PMBOK 方法論
- [x] Change requirement 由 BA 編寫文件，可 audit/distill
- [x] BA 維護 living document（`ba-memory.md`）作為工作記憶
- [x] BA 有「直通 ulw」fast path（無需工作時不經 PM）
- [x] **不靠 context 累積，靠 documents 累積；context 只維持 working memory**
- [x] **語言無關**（簡/繁中、英、日…），BA 以輸入語言回應
- [x] **LLM-first 分類**（不設規則層初期）——多數輸入混雜；BA 引導用戶行為以利未來規則化
- [x] **Token 估算** = f(文件長度, 代碼長度, MHC 複雜度→reasoning budget)，類比 man-day
- [x] **Closure 文件**參考 PMI project closure / final report 格式
- [x] **安撫策略**參考 4F：少量安撫但聚焦工作目標，偶爾鼓勵休息
- [x] **Plugin 只在用戶交互時觸發**，主要任務 = context 管理（注入經驗 + 整理經驗 + 避免 rot）
- [x] **BA 確認 + tl;dr**：分類/起草後提供文件 + tl;dr 給用戶確認 align
- [x] **分階段拆分**：用戶猶豫時提議分階段實施，拆 sub-project
- [x] **BA/PM 自我強化**：用經驗管理系統（MemSkill meta-memory + EvolveR 經驗生命週期）

## 10. 開放問題 → LEAN MVP 決策

> 以 MVP LEAN 模式決策：能做的進 MVP，太複雜的進 backlog。

| 開放問題 | MVP 決策 | Backlog |
|---|---|---|
| Main process 路由實作 | **plugin event hook**（P1 已用 plugin，自然延伸） | skill 引導 |
| BA 分類 confidence 門檻 | BA 起草後**一律提供 tl;dr + 確認**（無獨立 confidence 評分） | 精細 confidence 分數 |
| BA 引導用戶行為機制 | BA 偵測到模糊輸入時，在回應中**附一行引導** | 獨立引導機制 |
| Token 估算準確度 | **MVP heuristic**：doc_len + code_len + 粗略複雜度（低/中/高） | 精細 MHC 階層→token 映射 |
| Closure 萃取 schema | **MVP 基本 schema**（frontmatter + PMI 章節） | 精細萃取 |
| 4F 安撫偵測 | **MVP 基本偵測**（防禦性關鍵字）+ 少量安撫 + 聚焦目標 | 精細偵測 |
| BA/PM 經驗管理系統 | **MVP**：closure 的 lessons 反饋為 PM 參考文件 | 完整 MemSkill/EvolveR |

**Backlog（明確延後）**：
- 精細 MHC→token 映射
- 精細 closure 萃取 schema
- 精細 4F 偵測
- 完整 MemSkill/EvolveR 經驗系統
- 規則層 fast-path（等 BA 引導用戶行為成熟後再評估）

## 11. 分階段實作（MVP 範圍）

| 階段 | 內容 | 驗證 |
|------|------|------|
| **P1** ✅ | 決策引擎 + 狀態機（已做） | bun test 23 pass |
| **P2** | git 文件庫模組（ensure/read/write/commit/push + schema） | 單元測試 + 真實 git repo |
| **P3** | BA agent（分類 + 釐清 + CR 起草 + 安撫 + tl;dr） | agent 定義 + 分類邏輯測試 |
| **P4** | PM agent（規劃 + token 估算 heuristic + 可行性 + validation） | agent 定義 + 規劃邏輯測試 |
| **P5** | 編排層（plugin event hook 路由 BA→PM→ulw + 交接點） | 端到端流程測試 |
| **P6** | 壓縮→closure 寫入 git 整合 | 端到端 + 真實 repo 驗證 |
| **P7** | 分發（npm + postinstall + HL repo 設定） | 安裝測試 |
