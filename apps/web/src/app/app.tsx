import { useState, useEffect, useRef } from 'react';
import {
  Drawnix,
  DrawnixToolState,
  serializeAsJSON,
  isDesktop,
  getDesktopPath,
  fileNameOf,
  readFileText,
  writeFileText,
  readAppState,
  writeAppState,
  launchFilePath,
  createMindMap,
  saveBoardVersion,
  readBoardVersion,
  listBoardVersions,
  deleteBoardVersion,
  listRecentMaps,
  getStorageStats,
  previewStorageCleanup,
  cleanupStorage,
  pickOpen,
  getRecentBoards,
  setRecentBoards,
  OPEN_RECENT_EVENT,
  EVENT,
  type BoardVersionInfo,
  type RecentMapInfo,
  type StorageStats,
  type StorageCleanupInfo,
} from '@drawnix/drawnix';
import { PlaitBoard, PlaitElement, PlaitTheme, Viewport } from '@plait/core';
import type { BoardChangeData } from '@plait-board/react-board';
import { MindPointerType } from '@plait/mind';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import localforage from 'localforage';
import { TabStrip, DiscardDialog, type TabView } from './tab-strip';
import { HistoryDrawer, ConfirmDialog, HomePanel, formatSize, type VersionPreview } from './panels';
import { compareBoardVersions, type VersionDiff } from './version-diff';
import { uiCopy } from './i18n';

type AppValue = {
  children: PlaitElement[];
  viewport?: Viewport;
  theme?: PlaitTheme;
};

type Language = 'zh' | 'en' | 'ru' | 'ar' | 'vi';

type MainBoardPreference = {
  language: Language;
  copyTransparent: boolean;
  exportTransparent: boolean;
};

type BoardTab = {
  id: string;
  title: string;
  filePath: string | null;
  versionDir: string | null;
  nextVersion: number;
  value: AppValue;
  toolState?: Partial<DrawnixToolState>;
  dirty: boolean;
};

type VersionActionRequest = {
  kind: 'restore' | 'delete';
  tabId: string;
  versionDir: string;
  version: number;
};

type CleanupRequest = {
  keepLatest: number;
  info: StorageCleanupInfo;
};

const MAIN_BOARD_CONTENT_KEY = 'main_board_content';
const MAIN_BOARD_TOOL_STATE_KEY = 'main_board_tool_state';
const WORKSPACE_KEY = 'workspace_v2';

const SAVE_DEBOUNCE_MS = 600;
const PERSIST_DEBOUNCE_MS = 500;

localforage.config({
  name: 'Drawnix',
  storeName: 'drawnix_store',
  driver: [localforage.INDEXEDDB, localforage.LOCALSTORAGE],
});

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const parseBoard = (raw: string): AppValue | null => {
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data.elements)) {
      return { children: data.elements, viewport: data.viewport, theme: data.theme };
    }
  } catch {}
  return null;
};

const emptyBoardJSON = () =>
  JSON.stringify(
    {
      type: 'drawnix',
      version: 1,
      source: 'web',
      elements: [],
      viewport: { zoom: 1, origination: [0, 0] },
      theme: { themeColorMode: 'default' },
    },
    null,
    2
  );

const boardSignature = (value: AppValue) =>
  JSON.stringify({ children: value.children, theme: value.theme });

export function App() {
  const [tabs, setTabs] = useState<BoardTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [preference, setPreference] = useState<MainBoardPreference>({
    language: 'zh',
    copyTransparent: false,
    exportTransparent: false,
  });
  const [loaded, setLoaded] = useState(false);
  const [closeRequest, setCloseRequest] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyVersions, setHistoryVersions] = useState<BoardVersionInfo[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [previews, setPreviews] = useState<Record<number, VersionPreview>>({});
  const [compareSelection, setCompareSelection] = useState<number[]>([]);
  const [versionDiff, setVersionDiff] = useState<VersionDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [homeOpen, setHomeOpen] = useState(false);
  const [recentMaps, setRecentMaps] = useState<RecentMapInfo[]>([]);
  const [homeLoading, setHomeLoading] = useState(false);
  const [versionRequest, setVersionRequest] = useState<VersionActionRequest | null>(null);
  const [versionActionPending, setVersionActionPending] = useState(false);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [keepLatest, setKeepLatest] = useState(20);
  const [cleanupPreview, setCleanupPreview] = useState<CleanupRequest | null>(null);
  const [cleanupPreviewLoading, setCleanupPreviewLoading] = useState(false);
  const [cleanupPending, setCleanupPending] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<StorageCleanupInfo | null>(null);

  const tabsRef = useRef<BoardTab[]>([]);
  const activeRef = useRef<string | null>(null);
  const closeRequestRef = useRef<string | null>(null);
  const versionRequestRef = useRef<VersionActionRequest | null>(null);
  const versionActionPendingRef = useRef(false);
  const cleanupPreviewRef = useRef<CleanupRequest | null>(null);
  const cleanupPendingRef = useRef(false);
  const historyRequestRef = useRef(0);
  const diffRequestRef = useRef(0);
  const openingMapsRef = useRef(new Set<string>());
  const preferenceRef = useRef(preference);
  const boardRefs = useRef(new Map<string, PlaitBoard>());
  const fileTimers = useRef(new Map<string, number>());
  const versionQueues = useRef(new Map<string, Promise<void>>());
  const userInteracted = useRef(new Set<string>());
  const pointerGestureTab = useRef<string | null>(null);
  const pendingVersionTabs = useRef(new Set<string>());
  const contentSignatures = useRef(new Map<string, string>());
  const persistTimer = useRef<number | undefined>(undefined);
  const loadGuard = useRef(false);

  const commitTabs = (next: BoardTab[]) => {
    tabsRef.current = next;
    setTabs(next);
  };

  const commitActive = (id: string | null) => {
    activeRef.current = id;
    setActiveId(id);
  };

  const writeWorkspace = async () => {
    const payload = {
      tabs: tabsRef.current.map(
        ({ id, title, filePath, versionDir, nextVersion, value, toolState }) => ({
          id,
          title,
          filePath,
          versionDir,
          nextVersion,
          value: isDesktop && (filePath || versionDir) ? undefined : value,
          toolState,
        })
      ),
      activeId: activeRef.current,
      preference: preferenceRef.current,
      recentBoards: getRecentBoards(),
    };
    if (isDesktop) {
      await writeAppState(payload);
    } else {
      await localforage.setItem(WORKSPACE_KEY, payload);
    }
  };

  const schedulePersist = () => {
    window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      void writeWorkspace().catch((error) => {
        console.error(error);
        setStorageError(uiCopy(preferenceRef.current.language).stateSaveError(String(error)));
      });
    }, PERSIST_DEBOUNCE_MS);
  };

  const flushTabFile = async (tabId: string) => {
    const tab = tabsRef.current.find((item) => item.id === tabId);
    const board = boardRefs.current.get(tabId);
    if (!tab || !board) {
      return;
    }
    if (tab.filePath) {
      await writeFileText(tab.filePath, serializeAsJSON(board));
    }
    const queue = versionQueues.current.get(tabId);
    if (queue) {
      await queue;
    }
    commitTabs(
      tabsRef.current.map((item) => (item.id === tabId ? { ...item, dirty: false } : item))
    );
  };

  const enqueueVersionSave = (tabId: string) => {
    const tab = tabsRef.current.find((item) => item.id === tabId);
    const board = boardRefs.current.get(tabId);
    if (!tab?.versionDir || !board || !userInteracted.current.has(tabId)) {
      return;
    }
    const version = tab.nextVersion + 1;
    const folderPath = tab.versionDir;
    const contents = serializeAsJSON(board);
    commitTabs(
      tabsRef.current.map((item) =>
        item.id === tabId ? { ...item, nextVersion: version, dirty: true } : item
      )
    );
    const previous = versionQueues.current.get(tabId) ?? Promise.resolve();
    const task = previous
      .catch(() => undefined)
      .then(() => saveBoardVersion(folderPath, version, contents))
      .then(() => {
        commitTabs(
          tabsRef.current.map((item) =>
            item.id === tabId && item.nextVersion === version ? { ...item, dirty: false } : item
          )
        );
      })
      .catch((error) => {
        console.error(error);
        setStorageError(
          uiCopy(preferenceRef.current.language).versionSaveError(version, String(error))
        );
        throw error;
      });
    versionQueues.current.set(tabId, task);
    void task.catch(() => undefined);
  };

  const scheduleFileSave = (tabId: string) => {
    window.clearTimeout(fileTimers.current.get(tabId));
    fileTimers.current.set(
      tabId,
      window.setTimeout(() => {
        void flushTabFile(tabId);
      }, SAVE_DEBOUNCE_MS)
    );
  };

  const rememberBoard = (path: string) => {
    setRecentBoards([path, ...getRecentBoards().filter((item) => item !== path)].slice(0, 8));
  };

  const newMindTab = async () => {
    const base = preferenceRef.current.language === 'zh' ? '思维导图' : 'Mind map';
    let index = 1;
    for (const tab of tabsRef.current) {
      const matched = tab.title.match(/^(?:思维导图|Mind map) (\d+)$/);
      if (matched) {
        index = Math.max(index, parseInt(matched[1], 10) + 1);
      }
    }
    let versionDir: string | null = null;
    let title = `${base} ${index}`;
    if (isDesktop) {
      try {
        const created = await createMindMap(emptyBoardJSON());
        versionDir = created.folder_path;
        title = fileNameOf(created.folder_path);
      } catch (error) {
        console.error(error);
        setStorageError(uiCopy(preferenceRef.current.language).createFolderError(String(error)));
        return;
      }
    }
    const tab: BoardTab = {
      id: uid(),
      title,
      filePath: null,
      versionDir,
      nextVersion: 1,
      value: { children: [] },
      toolState: { pointer: MindPointerType.mind },
      dirty: false,
    };
    commitTabs([...tabsRef.current, tab]);
    commitActive(tab.id);
    contentSignatures.current.set(tab.id, boardSignature(tab.value));
    setHomeOpen(false);
    schedulePersist();
  };

  const performClose = (id: string) => {
    const position = tabsRef.current.findIndex((item) => item.id === id);
    const next = tabsRef.current.filter((item) => item.id !== id);
    commitTabs(next);
    window.clearTimeout(fileTimers.current.get(id));
    fileTimers.current.delete(id);
    versionQueues.current.delete(id);
    userInteracted.current.delete(id);
    contentSignatures.current.delete(id);
    boardRefs.current.delete(id);
    if (activeRef.current === id) {
      commitActive(next[Math.min(position, next.length - 1)]?.id ?? null);
    }
    if (next.length === 0) {
      setHomeOpen(false);
    }
    schedulePersist();
  };

  const requestClose = (id: string | null) => {
    closeRequestRef.current = id;
    setCloseRequest(id);
  };

  const closeTab = (id: string) => {
    const tab = tabsRef.current.find((item) => item.id === id);
    if (!tab) {
      return;
    }
    if (!tab.filePath && !tab.versionDir && tab.value.children.length > 0) {
      requestClose(id);
      return;
    }
    performClose(id);
  };

  const activate = (id: string) => {
    if (activeRef.current === id) {
      return;
    }
    commitActive(id);
    schedulePersist();
  };

  const openPath = async (path: string) => {
    const existing = tabsRef.current.find((tab) => tab.filePath === path);
    if (existing) {
      activate(existing.id);
      return;
    }
    const value = parseBoard(await readFileText(path));
    if (!value) {
      return;
    }
    const tab: BoardTab = {
      id: uid(),
      title: fileNameOf(path),
      filePath: path,
      versionDir: null,
      nextVersion: 1,
      value,
      dirty: false,
    };
    commitTabs([...tabsRef.current, tab]);
    commitActive(tab.id);
    contentSignatures.current.set(tab.id, boardSignature(value));
    rememberBoard(path);
    schedulePersist();
  };

  const updatePreference = (partial: Partial<MainBoardPreference>) => {
    const next = { ...preferenceRef.current, ...partial };
    preferenceRef.current = next;
    setPreference(next);
    schedulePersist();
  };

  const activeTab = () => tabsRef.current.find((tab) => tab.id === activeRef.current);

  const clearVersionRequest = () => {
    versionRequestRef.current = null;
    setVersionRequest(null);
  };

  const requestVersionAction = (kind: VersionActionRequest['kind'], version: number) => {
    const tab = activeTab();
    if (!tab?.versionDir) {
      return;
    }
    const request: VersionActionRequest = {
      kind,
      tabId: tab.id,
      versionDir: tab.versionDir,
      version,
    };
    versionRequestRef.current = request;
    setVersionRequest(request);
  };

  const refreshHistory = async () => {
    const requestId = ++historyRequestRef.current;
    const tab = activeTab();
    setHistoryVersions([]);
    setPreviews({});
    diffRequestRef.current += 1;
    setCompareSelection([]);
    setVersionDiff(null);
    setDiffLoading(false);
    if (!tab?.versionDir) {
      setHistoryLoading(false);
      return;
    }
    setHistoryLoading(true);
    try {
      const versions = await listBoardVersions(tab.versionDir);
      if (requestId !== historyRequestRef.current || activeRef.current !== tab.id) {
        return;
      }
      setHistoryVersions(versions);
    } catch (error) {
      if (requestId === historyRequestRef.current) {
        console.error(error);
        setStorageError(String(error));
      }
    } finally {
      if (requestId === historyRequestRef.current) {
        setHistoryLoading(false);
      }
    }
  };

  const toggleCompareVersion = (version: number) => {
    setCompareSelection((current) => {
      if (current.includes(version)) {
        return current.filter((item) => item !== version);
      }
      return [...current, version].slice(-2);
    });
  };

  const refreshHome = async () => {
    if (!isDesktop) {
      setRecentMaps([]);
      setStorageStats(null);
      return;
    }
    setHomeLoading(true);
    try {
      const [maps, stats] = await Promise.all([listRecentMaps(12), getStorageStats()]);
      setRecentMaps(maps);
      setStorageStats(stats);
    } catch (error) {
      console.error(error);
      setStorageError(String(error));
    } finally {
      setHomeLoading(false);
    }
  };

  const clearCleanupPreview = () => {
    cleanupPreviewRef.current = null;
    setCleanupPreview(null);
  };

  const previewCleanup = async () => {
    const normalized = Math.floor(Number(keepLatest));
    if (!Number.isFinite(normalized) || normalized < 1 || normalized > 999) {
      setStorageError(uiCopy(preferenceRef.current.language).keepLatestError);
      return;
    }
    setCleanupPreviewLoading(true);
    try {
      const info = await previewStorageCleanup(normalized);
      setCleanupResult(null);
      if (info.version_count === 0) {
        setCleanupResult(info);
        return;
      }
      const request = { keepLatest: normalized, info };
      cleanupPreviewRef.current = request;
      setCleanupPreview(request);
    } catch (error) {
      console.error(error);
      setStorageError(String(error));
    } finally {
      setCleanupPreviewLoading(false);
    }
  };

  const confirmCleanup = async () => {
    const request = cleanupPreviewRef.current;
    if (!request || cleanupPendingRef.current) {
      return;
    }
    cleanupPendingRef.current = true;
    setCleanupPending(true);
    try {
      const result = await cleanupStorage(request.keepLatest);
      clearCleanupPreview();
      setCleanupResult(result);
      await refreshHome();
      if (activeTab()?.versionDir) {
        await refreshHistory();
      }
    } catch (error) {
      console.error(error);
      setStorageError(String(error));
    } finally {
      cleanupPendingRef.current = false;
      setCleanupPending(false);
    }
  };

  const previewVersion = async (version: number) => {
    const tab = activeTab();
    if (!tab?.versionDir) {
      return;
    }
    const requestId = historyRequestRef.current;
    try {
      const value = parseBoard(await readBoardVersion(`${tab.versionDir}/${version}`));
      if (!value || requestId !== historyRequestRef.current || activeRef.current !== tab.id) {
        return;
      }
      const texts = value.children
        .slice(0, 3)
        .map((element) => {
          const topic = (element as { data?: { topic?: { children?: { text?: string }[] } } }).data
            ?.topic?.children;
          return (topic ?? []).map((part) => part.text ?? '').join('');
        })
        .filter(Boolean);
      setPreviews((current) => ({
        ...current,
        [version]: { nodes: value.children.length, texts },
      }));
    } catch (error) {
      if (requestId === historyRequestRef.current) {
        console.error(error);
        setStorageError(String(error));
      }
    }
  };

  const restoreVersion = async (request: VersionActionRequest) => {
    const { tabId, versionDir, version } = request;
    try {
      const raw = await readBoardVersion(`${versionDir}/${version}`);
      const value = parseBoard(raw);
      if (!value) {
        return;
      }
      const previous = versionQueues.current.get(tabId) ?? Promise.resolve();
      const task = previous
        .catch(() => undefined)
        .then(async () => {
          const tab = tabsRef.current.find((item) => item.id === tabId);
          if (!tab || tab.versionDir !== versionDir) {
            return;
          }
          let nextVersion = tab.nextVersion;
          if (tab.dirty) {
            const board = boardRefs.current.get(tabId);
            if (!board) {
              throw new Error('画板尚未就绪');
            }
            nextVersion += 1;
            await saveBoardVersion(versionDir, nextVersion, serializeAsJSON(board));
            commitTabs(
              tabsRef.current.map((item) =>
                item.id === tabId ? { ...item, nextVersion, dirty: false } : item
              )
            );
            schedulePersist();
          }
          nextVersion += 1;
          await saveBoardVersion(versionDir, nextVersion, raw);
          commitTabs(
            tabsRef.current.map((item) =>
              item.id === tabId ? { ...item, value, nextVersion, dirty: false } : item
            )
          );
          contentSignatures.current.set(tabId, boardSignature(value));
          clearVersionRequest();
          setPreviews({});
          schedulePersist();
          await refreshHistory();
        })
        .catch((error) => {
          console.error(error);
          setStorageError(String(error));
        });
      versionQueues.current.set(tabId, task);
      await task;
    } catch (error) {
      console.error(error);
      setStorageError(String(error));
    }
  };

  const deleteVersion = async (request: VersionActionRequest) => {
    try {
      await deleteBoardVersion(request.versionDir, request.version);
      clearVersionRequest();
      await refreshHistory();
    } catch (error) {
      console.error(error);
      setStorageError(String(error));
    }
  };

  const confirmVersionAction = () => {
    const request = versionRequestRef.current;
    if (!request || versionActionPendingRef.current) {
      return;
    }
    versionActionPendingRef.current = true;
    setVersionActionPending(true);
    const task = request.kind === 'restore' ? restoreVersion(request) : deleteVersion(request);
    void task.finally(() => {
      versionActionPendingRef.current = false;
      setVersionActionPending(false);
    });
  };

  const openRecentMap = async (folderPath: string) => {
    const existing = tabsRef.current.find((tab) => tab.versionDir === folderPath);
    if (existing) {
      activate(existing.id);
      setHomeOpen(false);
      return;
    }
    if (openingMapsRef.current.has(folderPath)) {
      return;
    }
    openingMapsRef.current.add(folderPath);
    const info = recentMaps.find((map) => map.folder_path === folderPath);
    const latest = info?.latest_version ?? 1;
    try {
      const value = parseBoard(await readBoardVersion(`${folderPath}/${latest}`));
      if (!value) {
        return;
      }
      const opened = tabsRef.current.find((tab) => tab.versionDir === folderPath);
      if (opened) {
        activate(opened.id);
        setHomeOpen(false);
        return;
      }
      const tab: BoardTab = {
        id: uid(),
        title: info?.name ?? fileNameOf(folderPath),
        filePath: null,
        versionDir: folderPath,
        nextVersion: latest,
        value,
        dirty: false,
      };
      commitTabs([...tabsRef.current, tab]);
      commitActive(tab.id);
      contentSignatures.current.set(tab.id, boardSignature(value));
      setHomeOpen(false);
      schedulePersist();
    } catch (error) {
      console.error(error);
      setStorageError(String(error));
    } finally {
      openingMapsRef.current.delete(folderPath);
    }
  };

  const openDrawnixFile = async () => {
    try {
      const paths = await pickOpen([{ name: 'Drawnix', extensions: ['drawnix'] }], false);
      if (paths[0]) {
        await openPath(paths[0]);
      }
      setHomeOpen(false);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    const load = async () => {
      if (loadGuard.current) {
        return;
      }
      loadGuard.current = true;
      const stored = isDesktop
        ? await readAppState()
        : await localforage.getItem<Record<string, unknown>>(WORKSPACE_KEY);
      if (stored?.preference) {
        preferenceRef.current = stored.preference as MainBoardPreference;
        setPreference(preferenceRef.current);
      }
      if (Array.isArray(stored?.recentBoards)) {
        setRecentBoards(stored.recentBoards as string[]);
      }
      if (isDesktop) {
        const launch = await launchFilePath();
        if (launch) {
          try {
            const value = parseBoard(await readFileText(launch));
            if (value) {
              const tab: BoardTab = {
                id: uid(),
                title: fileNameOf(launch),
                filePath: launch,
                versionDir: null,
                nextVersion: 1,
                value,
                dirty: false,
              };
              commitTabs([tab]);
              commitActive(tab.id);
              rememberBoard(launch);
              setLoaded(true);
              return;
            }
          } catch (error) {
            console.error(error);
          }
        }
        await newMindTab();
        setLoaded(true);
        return;
      }

      let restored: BoardTab[] = [];
      let active: string | null = null;
      if (Array.isArray(stored?.tabs)) {
        restored = (stored.tabs as BoardTab[]).map((tab) => ({
          id: tab.id,
          title: tab.title,
          filePath: tab.filePath ?? null,
          versionDir: null,
          nextVersion: 1,
          value: tab.value ?? { children: [] },
          toolState: tab.toolState,
          dirty: false,
        }));
        active = (stored.activeId as string) ?? null;
      } else {
        const [legacyValue, legacyTool] = await Promise.all([
          localforage.getItem(MAIN_BOARD_CONTENT_KEY),
          localforage.getItem(MAIN_BOARD_TOOL_STATE_KEY),
        ]);
        restored = [
          {
            id: uid(),
            title: preferenceRef.current.language === 'zh' ? '未命名' : 'Untitled',
            filePath: null,
            versionDir: null,
            nextVersion: 1,
            value: (legacyValue as AppValue) ?? { children: [] },
            toolState: legacyTool as Partial<DrawnixToolState>,
            dirty: false,
          },
        ];
        active = restored[0].id;
      }
      if (restored.length === 0) {
        restored = [
          {
            id: uid(),
            title: preferenceRef.current.language === 'zh' ? '未命名' : 'Untitled',
            filePath: null,
            versionDir: null,
            nextVersion: 1,
            value: { children: [] },
            dirty: false,
          },
        ];
      }
      if (!active || !restored.some((tab) => tab.id === active)) {
        active = restored[0].id;
      }
      commitTabs(restored);
      commitActive(active);
      setLoaded(true);
    };
    void load();
  }, []);

  useEffect(() => {
    if (!isDesktop || !loaded) {
      return;
    }
    const tab = tabs.find((item) => item.id === activeId);
    void getCurrentWindow().setTitle(tab ? `${tab.title} - Drawnix` : 'Drawnix');
  }, [tabs, activeId, loaded]);

  useEffect(() => {
    if (!historyOpen) {
      historyRequestRef.current += 1;
      setHistoryVersions([]);
      setPreviews({});
      setHistoryLoading(false);
      return;
    }
    void refreshHistory();
  }, [activeId, historyOpen]);

  useEffect(() => {
    const requestId = ++diffRequestRef.current;
    if (!historyOpen || compareSelection.length !== 2) {
      setVersionDiff(null);
      setDiffLoading(false);
      return;
    }
    const tab = activeTab();
    if (!tab?.versionDir) {
      setVersionDiff(null);
      setDiffLoading(false);
      return;
    }
    const [olderVersion, newerVersion] = [...compareSelection].sort((a, b) => a - b);
    setDiffLoading(true);
    setVersionDiff(null);
    Promise.all([
      readBoardVersion(`${tab.versionDir}/${olderVersion}`),
      readBoardVersion(`${tab.versionDir}/${newerVersion}`),
    ])
      .then(([olderRaw, newerRaw]) => {
        if (requestId !== diffRequestRef.current || activeRef.current !== tab.id) {
          return;
        }
        const older = parseBoard(olderRaw);
        const newer = parseBoard(newerRaw);
        if (!older || !newer) {
          return;
        }
        setVersionDiff(compareBoardVersions(older.children, newer.children));
      })
      .catch((error) => {
        if (requestId === diffRequestRef.current) {
          console.error(error);
          setStorageError(String(error));
        }
      })
      .finally(() => {
        if (requestId === diffRequestRef.current) {
          setDiffLoading(false);
        }
      });
  }, [activeId, compareSelection, historyOpen]);

  useEffect(() => {
    if (tabs.length === 0) {
      void refreshHome();
    }
  }, [tabs.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (cleanupPreviewRef.current) {
        if (event.key === 'Escape' && !cleanupPendingRef.current) {
          event.preventDefault();
          clearCleanupPreview();
        }
        return;
      }
      if (versionRequestRef.current) {
        if (event.key === 'Escape' && !versionActionPendingRef.current) {
          event.preventDefault();
          clearVersionRequest();
        }
        return;
      }
      const target = event.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return;
      }
      if (closeRequestRef.current) {
        if (event.key === 'Escape') {
          event.preventDefault();
          requestClose(null);
        }
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.altKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 't') {
        event.preventDefault();
        newMindTab();
      } else if (key === 'w') {
        event.preventDefault();
        if (activeRef.current) {
          closeTab(activeRef.current);
        }
      } else if (event.key === 'Tab') {
        event.preventDefault();
        const list = tabsRef.current;
        if (list.length < 2) {
          return;
        }
        const position = list.findIndex((tab) => tab.id === activeRef.current);
        const next = event.shiftKey
          ? (position - 1 + list.length) % list.length
          : (position + 1) % list.length;
        activate(list[next].id);
      }
    };
    const onNewMind = () => newMindTab();
    const onRecent = (event: Event) => void openPath((event as CustomEvent<string>).detail);
    const markInteraction = () => {
      if (activeRef.current) {
        userInteracted.current.add(activeRef.current);
      }
    };
    const beginPointerGesture = () => {
      const id = activeRef.current;
      if (!id) {
        return;
      }
      userInteracted.current.add(id);
      pointerGestureTab.current = id;
      pendingVersionTabs.current.delete(id);
    };
    const endPointerGesture = () => {
      const id = pointerGestureTab.current;
      if (!id) {
        return;
      }
      pointerGestureTab.current = null;
      if (pendingVersionTabs.current.delete(id)) {
        enqueueVersionSave(id);
      }
    };
    window.addEventListener('pointerdown', beginPointerGesture, true);
    window.addEventListener('pointerup', endPointerGesture);
    window.addEventListener('pointercancel', endPointerGesture);
    window.addEventListener('blur', endPointerGesture);
    window.addEventListener('wheel', markInteraction, { capture: true, passive: true });
    window.addEventListener('keydown', markInteraction, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener(EVENT.NEW_MIND_MAP, onNewMind);
    window.addEventListener(OPEN_RECENT_EVENT, onRecent);
    const unlisten = isDesktop
      ? listen<string>('open-file', (event) => void openPath(event.payload))
      : null;
    return () => {
      window.removeEventListener('pointerdown', beginPointerGesture, true);
      window.removeEventListener('pointerup', endPointerGesture);
      window.removeEventListener('pointercancel', endPointerGesture);
      window.removeEventListener('blur', endPointerGesture);
      window.removeEventListener('wheel', markInteraction, true);
      window.removeEventListener('keydown', markInteraction, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(EVENT.NEW_MIND_MAP, onNewMind);
      window.removeEventListener(OPEN_RECENT_EVENT, onRecent);
      void unlisten?.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (!isDesktop) {
      return;
    }
    const appWindow = getCurrentWindow();
    const unlisten = appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      try {
        for (const tab of tabsRef.current) {
          window.clearTimeout(fileTimers.current.get(tab.id));
          if (pendingVersionTabs.current.delete(tab.id)) {
            pointerGestureTab.current = null;
            enqueueVersionSave(tab.id);
          }
          await flushTabFile(tab.id);
        }
        await writeWorkspace();
        await appWindow.destroy();
      } catch (error) {
        console.error(error);
        setStorageError(uiCopy(preferenceRef.current.language).closeSaveError(String(error)));
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  if (!loaded) {
    return null;
  }

  const views: TabView[] = tabs.map((tab) => ({
    id: tab.id,
    title: tab.title,
    bound: !!tab.filePath || !!tab.versionDir,
    dirty: tab.dirty,
    active: tab.id === activeId,
  }));

  const activeTheme = tabs.find((tab) => tab.id === activeId)?.value.theme?.themeColorMode;
  const darkChrome = activeTheme === 'dark' || activeTheme === 'starry';

  return (
    <div
      className={`workspace${darkChrome ? ' workspace--dark' : ''}`}
      dir={preference.language === 'ar' ? 'rtl' : 'ltr'}
    >
      <TabStrip
        tabs={views}
        language={preference.language}
        historyEnabled={!!activeTab()?.versionDir}
        homeActive={tabs.length === 0 || homeOpen}
        onActivate={activate}
        onClose={closeTab}
        onNew={newMindTab}
        onHome={() => {
          if (tabsRef.current.length === 0) {
            return;
          }
          if (homeOpen) {
            setHomeOpen(false);
          } else {
            setHomeOpen(true);
            void refreshHome();
          }
        }}
        onHistory={() => setHistoryOpen((open) => !open)}
      />
      <div className="workspace__panels">
        {storageError && (
          <div className="storage-error" role="alert">
            <span>{storageError}</span>
            <button type="button" onClick={() => setStorageError(null)}>
              {uiCopy(preference.language).dismiss}
            </button>
          </div>
        )}
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`workspace__panel${tab.id === activeId ? ' workspace__panel--active' : ''}`}
          >
            <Drawnix
              value={tab.value.children}
              viewport={tab.value.viewport}
              theme={tab.value.theme}
              initialToolState={tab.toolState}
              initialFileHandle={
                tab.filePath
                  ? { kind: 'file', name: fileNameOf(tab.filePath), path: tab.filePath }
                  : undefined
              }
              initialLanguage={preference.language}
              initialPreference={{
                copyTransparent: preference.copyTransparent,
                exportTransparent: preference.exportTransparent,
              }}
              onLanguageChange={(language) => {
                updatePreference({ language });
              }}
              onPreferenceChange={({ copyTransparent, exportTransparent }) => {
                updatePreference({ copyTransparent, exportTransparent });
              }}
              onChange={(value) => {
                const boardChange = value as BoardChangeData;
                const next = boardChange as AppValue;
                const interacted = userInteracted.current.has(tab.id);
                const shouldSnapshot = boardChange.operations.some(
                  (operation) =>
                    operation.type !== 'set_selection' && operation.type !== 'set_viewport'
                );
                const signature = boardSignature(next);
                const contentChanged =
                  shouldSnapshot && signature !== contentSignatures.current.get(tab.id);
                if (contentChanged) {
                  contentSignatures.current.set(tab.id, signature);
                }
                commitTabs(
                  tabsRef.current.map((item) =>
                    item.id === tab.id
                      ? {
                          ...item,
                          value: next,
                          dirty: interacted && contentChanged ? true : item.dirty,
                        }
                      : item
                  )
                );
                if (contentChanged && tab.versionDir) {
                  if (pointerGestureTab.current === tab.id) {
                    pendingVersionTabs.current.add(tab.id);
                  } else {
                    enqueueVersionSave(tab.id);
                  }
                } else if (contentChanged && tab.filePath) {
                  scheduleFileSave(tab.id);
                }
                schedulePersist();
              }}
              onToolStateChange={(toolState) => {
                commitTabs(
                  tabsRef.current.map((item) =>
                    item.id === tab.id ? { ...item, toolState } : item
                  )
                );
                schedulePersist();
              }}
              onFileHandleChange={(fileHandle) => {
                if (!isDesktop) {
                  return;
                }
                const path = getDesktopPath(fileHandle);
                if (!path) {
                  return;
                }
                commitTabs(
                  tabsRef.current.map((item) =>
                    item.id === tab.id
                      ? { ...item, filePath: path, title: fileNameOf(path), dirty: false }
                      : item
                  )
                );
                rememberBoard(path);
                schedulePersist();
              }}
              tutorial={
                tab.value.children.length === 0 && tab.toolState?.pointer !== MindPointerType.mind
              }
              afterInit={(board) => {
                boardRefs.current.set(tab.id, board);
              }}
            ></Drawnix>
          </div>
        ))}
        {tabs.length === 0 && (
          <HomePanel
            language={preference.language}
            maps={recentMaps}
            loading={homeLoading}
            openFileEnabled={isDesktop}
            storageStats={storageStats}
            keepLatest={keepLatest}
            cleanupPreviewLoading={cleanupPreviewLoading}
            cleanupResult={cleanupResult}
            onKeepLatestChange={setKeepLatest}
            onPreviewCleanup={() => void previewCleanup()}
            embedded
            onNew={newMindTab}
            onOpenFile={openDrawnixFile}
            onOpenMap={openRecentMap}
            onClose={() => setHomeOpen(false)}
          />
        )}
        {homeOpen && tabs.length > 0 && (
          <HomePanel
            language={preference.language}
            maps={recentMaps}
            loading={homeLoading}
            openFileEnabled={isDesktop}
            storageStats={storageStats}
            keepLatest={keepLatest}
            cleanupPreviewLoading={cleanupPreviewLoading}
            cleanupResult={cleanupResult}
            onKeepLatestChange={setKeepLatest}
            onPreviewCleanup={() => void previewCleanup()}
            embedded={false}
            onNew={newMindTab}
            onOpenFile={openDrawnixFile}
            onOpenMap={openRecentMap}
            onClose={() => setHomeOpen(false)}
          />
        )}
        {historyOpen && (
          <HistoryDrawer
            language={preference.language}
            versions={historyVersions}
            loading={historyLoading}
            previews={previews}
            compareSelection={compareSelection}
            diff={versionDiff}
            diffLoading={diffLoading}
            onClose={() => setHistoryOpen(false)}
            onPreview={(version) => void previewVersion(version)}
            onToggleCompare={toggleCompareVersion}
            onClearCompare={() => setCompareSelection([])}
            onRestore={(version) => requestVersionAction('restore', version)}
            onDelete={(version) => requestVersionAction('delete', version)}
          />
        )}
      </div>
      {versionRequest && (
        <ConfirmDialog
          title={
            versionRequest.kind === 'restore'
              ? uiCopy(preference.language).restoreTitle(versionRequest.version)
              : uiCopy(preference.language).deleteTitle(versionRequest.version)
          }
          body={
            versionRequest.kind === 'restore'
              ? uiCopy(preference.language).restoreBody
              : uiCopy(preference.language).deleteBody
          }
          cancel={uiCopy(preference.language).cancel}
          confirm={
            versionRequest.kind === 'restore'
              ? uiCopy(preference.language).restore
              : uiCopy(preference.language).delete
          }
          danger={versionRequest.kind === 'delete'}
          busy={versionActionPending}
          onCancel={() => {
            if (!versionActionPendingRef.current) {
              clearVersionRequest();
            }
          }}
          onConfirm={confirmVersionAction}
        />
      )}
      {cleanupPreview && (
        <ConfirmDialog
          title={uiCopy(preference.language).cleanupTitle(
            cleanupPreview.info.version_count,
            formatSize(cleanupPreview.info.freed_bytes)
          )}
          body={uiCopy(preference.language).cleanupBody(
            cleanupPreview.info.map_count,
            cleanupPreview.info.version_count,
            formatSize(cleanupPreview.info.freed_bytes),
            cleanupPreview.keepLatest
          )}
          cancel={uiCopy(preference.language).cancel}
          confirm={uiCopy(preference.language).cleanupConfirm}
          danger
          busy={cleanupPending}
          onCancel={() => {
            if (!cleanupPendingRef.current) {
              clearCleanupPreview();
            }
          }}
          onConfirm={() => void confirmCleanup()}
        />
      )}
      {closeRequest && (
        <DiscardDialog
          title={tabs.find((tab) => tab.id === closeRequest)?.title ?? ''}
          language={preference.language}
          onCancel={() => requestClose(null)}
          onConfirm={() => {
            performClose(closeRequest);
            requestClose(null);
          }}
        />
      )}
    </div>
  );
}

export default App;
