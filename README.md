# Ayanami

A personal, dark-themed Windows desktop game launcher built for offline and DRM-free games. Inspired by Hydra Launcher, Ayanami combines local library management, automated playtime tracking, Google Drive cloud save backups, hardware compatibility checks, and an integrated download/torrent manager into one unified desktop client.

---

## 1. Tech Stack & Architecture

- **Target OS:** Windows 10 / 11 (x64)
- **Desktop Shell:** Electron + React + TypeScript + Tailwind CSS
- **Local Database:** SQLite (`better-sqlite3`) stored locally for library entries, playtime logs, download history, and cached metadata
- **Metadata & Artwork APIs:**
  - **SteamGridDB API:** Vertical grid cover art, hero banners, and logos
  - **IGDB API (via Twitch Developer OAuth):** Game descriptions, genres, release dates, and hardware requirements
  - **Steam public storefront endpoints:** Keyless catalog enrichment (cover art, descriptions, screenshots, genres, and system requirements) for imported Store titles
- **System Hardware Detection:** `systeminformation` (Node.js) to detect local CPU, GPU, RAM, and drives for spec comparisons
- **Benchmark Data:** A bundled PassMark snapshot (`src/main/data/hardware-benchmarks.json`, 4,500+ CPUs and 2,800+ GPUs) powers CPU Mark and G3D Mark comparisons. Refresh it with `npm run benchmarks:update` — no API key required
- **Cloud Storage:** Official Google Drive API (`googleapis` Node SDK with OAuth2)
- **Download & Torrent Engine:**
  - Embedded BitTorrent/Magnet engine (via `webtorrent` or `libtorrent` bindings) + multi-connection HTTP/HTTPS downloader (inspired by Free Download Manager) supporting pause, resume, speed throttling, and progress tracking
  - Archive extraction via `7zip-bin` for automated `.rar` and `.zip` unpacking, with a Windows `tar.exe` fallback for formats the bundled 7-Zip build cannot read (notably RAR)
- **Configuration & Secrets:** `.env` for API keys (`STEAMGRIDDB_API_KEY`, `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) and local `sources.json` for user-supplied catalog feeds. In development the file lives at the project root; an installed copy reads `%APPDATA%\ayanami\.env` (a template ships in `resources\.env.example`). Missing keys fall back to built-in demo metadata and artwork.

---

## 2. UI & Layout Specification

- **Theme:** Dark mode by default (deep charcoal/slate background `#0f1115`, elevated card surfaces `#181b20`, crisp subtle borders `#262a33`).
- **Navigation Layout (Hydra-Style Left Sidebar):**
  - Persistent vertical left sidebar containing the **Ayanami** logo at the top and three primary navigation tabs:
    1. **Library**
    2. **Store**
    3. **Downloads**
  - Bottom sidebar footer showing Google Drive connection status and quick Settings access.

---

## 3. Core Features & Functional Requirements

### A. Library Tab
- **Manual Game Addition Flow:**
  1. User clicks **"+ Add Game"** and types the game's title.
  2. App queries SteamGridDB & IGDB in real time and displays matching results with cover art previews.
  3. User selects the matching game entry and browses to select the local game `.exe` file on their PC.
  4. User optionally selects the local save-file folder path (can also be configured or changed later on the game page).
  5. Game is saved to SQLite and rendered in the Library grid.
- **Game Launching:**
  - Direct `.exe` execution with no extra launch arguments required.
  - Displays a live `"Running"` state while the game process is active.

### B. Playtime Tracking
- **Process Monitoring:** Monitors the launched `.exe` process from launch until exit.
- **Metrics Tracked:**
  - **Total Hours Played:** Cumulative playtime formatted cleanly (e.g., `14.5 hrs` or `45 mins`).
  - **Last Played:** Human-readable timestamp/date (e.g., `Today`, `Yesterday`, `Nov 14, 2026`).
- **Granularity:** Strictly tracks total cumulative hours and last played date (no per-session charts required).

### C. Google Drive Cloud Saves
- **User-Defined Save Paths:** Save folder location is manually picked by the user per game (explicitly overrides any automatic detection).
- **Sync Triggers:**
  - **Manual Sync (Default):** Prominent **"Sync Now"** button on each game's detail page to upload/restore saves on demand.
  - **Optional Auto-Sync Timer:** Per-game or global toggle to automatically zip and upload the save folder **2 minutes after the game closes**.
- **Version History & Retention:**
  - Uploads compressed `.zip` archives into a dedicated `Ayanami_Saves/<Game_Name>/` folder on Google Drive.
  - **3-Version Rolling Retention:** Automatically keeps the **latest save + 2 previous saves** (3 total backups per game) and deletes older archives on Drive.
  - Allows restoring any of the 3 saved versions back into the user's configured local save path.

### D. Store Tab (User-Supplied Catalog & Compatibility)
- **Source Architecture:** Reads from user-supplied local JSON/manifest files (`sources.json`) imported via Settings—no hardcoded external websites inside the source code. A clean install imports the bundled sample catalog once, so the Store is populated on first launch; removing that source afterwards is remembered and not undone on the next start.
- **Popular Front Page:** The default Store shelf shows the **20 most popular Steam games** matched against Steam’s live most-played chart (supplemented by SteamSpy and Steam featured names). The shelf is capped at twenty titles and eagerly enriched so cover art and descriptions load reliably. Searching or applying an online/compatibility filter switches back to the full local catalog.
- **Supported Manifests:** Ayanami's `{ "games": [...] }` format and Hydra-style `{ "name": "...", "downloads": [...] }` sources (for example SteamRip exports). Hydra entries map `title`, `uris`, `uploadDate`, and `fileSize`; missing artwork or hardware metadata is shown as unknown. When an entry mixes sources, the order is direct file/magnet first, then verifiably automatic hosts such as Buzzheavier, then manual download pages, then unknown hosts; the remaining links stay available as mirrors.
- **Partial-Name Search:** Search folds punctuation, accents, and spacing, then ranks token matches. Queries like `automata` or `nier automata` find `NieR:Automata`, and developer, publisher, genre, and synopsis matches are included after title matches.
- **Steam Metadata Enrichment:** Titles visible in the Store are matched lazily against Steam's public storefront (no API key required). Requests use a reduced `appdetails` payload, age-check cookies, short timeouts, shared caches, and parallel candidate checks, so cover art, hero banners, descriptions, genres, screenshots, and system requirements appear quickly. Match misses and network errors cool down separately (one day for misses, twenty minutes for retryable errors), and the game page includes a **Refresh Steam** action to retry immediately.
- **Version Grouping:** Store results collapse releases that differ only by version/build/update marker and show only the newest entry. Opening a game exposes a **Previous versions** tab with older grouped releases, or **No previous versions found** when there are none.
- **Game Store Page Details:**
  - Cover art, hero banner, synopsis, and screenshots.
  - **System Requirements & Compatibility:**
    - Displays **Minimum** and **Recommended** hardware specs (CPU, GPU, RAM, Storage). The Recommended card is hidden when Steam provides no recommended specifications.
    - CPU and GPU targets are compared with this PC using a bundled PassMark snapshot (**CPU Mark** and **G3D Mark**). When Steam lists alternatives, the strongest listed model sets a consistent, conservative bar. Generic legacy specs such as “DirectX compatible”, “128 MB video memory”, or “3.8 GHz” are assumed satisfied; specific models missing from the database are reported as unknown instead of guessed.
    - Storage is checked against the **largest drive** by total capacity, not the Windows system drive, and free space is re-read whenever the profile is loaded.
    - Individual spec checks show pass/warn/fail marks without separate "meets minimum/recommended" verdict badges. The spec sheet and GPU benchmark video are the performance reference.
  - **GPU Benchmark Video:** Replaces estimated FPS with a click-to-play YouTube clip found for `<graphics card> <game> benchmark`, played through `youtube-nocookie.com` and cached in SQLite. A clip must mention the graphics card’s model number and every distinctive game-name token (or at least 75% for long titles), so generic GPU tests, clips for another graphics card (such as a GTX 1050 instead of a GTX 1650), franchise compilations, and unrelated games are never presented as this title’s benchmark; when nothing relevant is found, Ayanami links to a YouTube search instead.
  - **Online Status Badge:** Combines a strict title match on `online-fix.me` with an automatic keyword check for co-op, multiplayer, or online play in the **title only**. online-fix.me is checked only when a title is opened (recent results are reused for seven days), so importing a large catalog never starts a background crawl:
    - 🟢 **Green:** `Online-Fix Available`
    - 🔵 **Cyan:** `Online Play` (title keyword match, no online-fix.me listing yet)
    - No badge is shown for offline, not-yet-checked, or checking states. Network failures never become a false offline result.

### E. Downloads Tab (FDM-Style Manager & Post-Download Automation)
- **Download Engine:**
  - Supports **BitTorrent / Magnet links**, local **`.torrent` files**, and **multi-threaded direct HTTP downloads** with pause, resume, queue management, download/upload speed readouts, and ETA (modeled after Free Download Manager).
  - Two ordinary transfers run at a time; queued items start automatically. A download captured from a source page may start as a third transfer when both slots are busy, because those signed links expire quickly. Large HTTP files use four ranged parts with resumable sidecar state, then merge locally. Servers that ignore range requests fall back to a single resumable stream.
  - Manual hosts (**1fichier**, **Gofile**, **MegaDB**, **VikingFile**, **Datanodes**) open their file page in a dedicated, non-modal Ayanami window. The real download Chromium starts is captured, handed back to the download engine with the page's cookies and referer, and queued automatically. Closing that window never stops an already-captured transfer.
  - HTML pages are rejected with a clear message explaining that the catalog link is a download page or has expired, and suggesting the source page, a catalog re-import, or a direct file/magnet link instead of saving the web page.
- **Folder Settings:** Download and Games directories are configurable in the Downloads tab and persist in `download-settings.json` inside Electron’s `userData` directory.
- **Post-Download Handling (Automated Workflows):**
  - **Pre-installed Games (`.rar` / `.zip` archives):** Automatically extracts the archive into the user's configured Games directory using the bundled `7za.exe`, falling back to Windows `tar.exe` when 7-Zip cannot read the format (for example RAR), and **deletes the original `.rar`/`.zip` archive** once extraction succeeds. Every entry is checked before a byte is written: archives containing absolute paths, parent-directory traversal, or link entries are refused with an explanation instead of extracting outside the Games folder.
  - **Repacked Games (Installer `.exe`):** Automatically launches the setup/installer `.exe` upon completion so the user can step through the installation wizard manually. Archives are unpacked first when the installer is still compressed.
  - Post-processing shows extracting/installing/ready/error states on the download card, with a retry action when extraction or installer detection fails.

---

## 4. Database Schema (SQLite)

```sql
CREATE TABLE games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  igdb_id INTEGER,
  steamgriddb_id INTEGER,
  cover_url TEXT,
  hero_url TEXT,
  exe_path TEXT NOT NULL,
  save_folder_path TEXT,
  total_playtime_seconds INTEGER DEFAULT 0,
  last_played_at TEXT,
  auto_sync_enabled INTEGER DEFAULT 0,
  last_synced_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  source_uri TEXT NOT NULL,
  download_type TEXT CHECK(download_type IN ('torrent', 'http')) NOT NULL,
  release_type TEXT CHECK(release_type IN ('preinstalled', 'repack')) NOT NULL,
  status TEXT DEFAULT 'queued',
  progress REAL DEFAULT 0,
  save_path TEXT NOT NULL,
  downloaded_bytes INTEGER DEFAULT 0,
  total_bytes INTEGER,
  download_speed REAL DEFAULT 0,
  upload_speed REAL DEFAULT 0,
  eta_seconds INTEGER,
  file_path TEXT,
  error_message TEXT,
  postprocess_status TEXT DEFAULT 'idle',
  postprocess_message TEXT,
  completed_at TEXT,
  updated_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);