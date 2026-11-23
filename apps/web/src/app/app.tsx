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
  fileExists,
  readAppState,
  writeAppState,
  defaultBoardPath,
  launchFilePath,
  getRecentBoards,
  setRecentBoards,
  OPEN_RECENT_EVENT,
  EVENT,
} from '@drawnix/drawnix';
import { PlaitBoard, PlaitElement, PlaitTheme, Viewport } from '@plait/core';
import { MindPointerType } from '@plait/mind';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import localforage from 'localforage';
import { TabStrip, EmptyWorkspace, DiscardDialog, type TabView } from './tab-strip';

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
  value: AppValue;
  toolState?: Partial<DrawnixToolState>;
  dirty: boolean;
};

const MAIN_BOARD_CONTENT_KEY = 'main_board_content';
const MAIN_BOARD_TOOL_STATE_KEY = 'main_board_tool_state';
const MAIN_BOARD_PREFERENCE_KEY = 'main_board_preference';
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

  const tabsRef = useRef<BoardTab[]>([]);
  const activeRef = useRef<string | null>(null);
  const closeRequestRef = useRef<string | null>(null);
  const preferenceRef = useRef(preference);
  const boardRefs = useRef(new Map<string, PlaitBoard>());
  const fileTimers = useRef(new Map<string, number>());
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

  const writeWorkspace = () => {
    const payload = {
      tabs: tabsRef.current.map(({ id, title, filePath, value, toolState }) => ({
        id,
        title,
        filePath,
        value,
        toolState,
      })),
      activeId: activeRef.current,
      preference: preferenceRef.current,
      recentBoards: getRecentBoards(),
    };
    if (isDesktop) {
      void writeAppState(payload);
    } else {
      void localforage.setItem(WORKSPACE_KEY, payload);
    }
  };

  const schedulePersist = () => {
    window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(writeWorkspace, PERSIST_DEBOUNCE_MS);
  };

  const flushTabFile = async (tabId: string) => {
    const tab = tabsRef.current.find((item) => item.id === tabId);
    const board = boardRefs.current.get(tabId);
    if (!tab?.filePath || !board) {
      return;
    }
    await writeFileText(tab.filePath, serializeAsJSON(board));
    commitTabs(tabsRef.current.map((item) => (item.id === tabId ? { ...item, dirty: false } : item)));
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

  const newMindTab = () => {
    const base = preferenceRef.current.language === 'zh' ? '思维导图' : 'Mind map';
    let index = 1;
    for (const tab of tabsRef.current) {
      const matched = tab.title.match(/^(?:思维导图|Mind map) (\d+)$/);
      if (matched) {
        index = Math.max(index, parseInt(matched[1], 10) + 1);
      }
    }
    const tab: BoardTab = {
      id: uid(),
      title: `${base} ${index}`,
      filePath: null,
      value: { children: [] },
      toolState: { pointer: MindPointerType.mind },
      dirty: false,
    };
    commitTabs([...tabsRef.current, tab]);
    commitActive(tab.id);
    schedulePersist();
  };

  const performClose = (id: string) => {
    const position = tabsRef.current.findIndex((item) => item.id === id);
    const next = tabsRef.current.filter((item) => item.id !== id);
    commitTabs(next);
    window.clearTimeout(fileTimers.current.get(id));
    fileTimers.current.delete(id);
    boardRefs.current.delete(id);
    if (activeRef.current === id) {
      commitActive(next[Math.min(position, next.length - 1)]?.id ?? null);
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
    if (!tab.filePath && tab.value.children.length > 0) {
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
    const tab: BoardTab = { id: uid(), title: fileNameOf(path), filePath: path, value, dirty: false };
    commitTabs([...tabsRef.current, tab]);
    commitActive(tab.id);
    rememberBoard(path);
    schedulePersist();
  };

  const updatePreference = (partial: Partial<MainBoardPreference>) => {
    const next = { ...preferenceRef.current, ...partial };
    preferenceRef.current = next;
    setPreference(next);
    schedulePersist();
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
      let restored: BoardTab[] = [];
      let active: string | null = null;
      if (Array.isArray(stored?.tabs)) {
        restored = (stored.tabs as BoardTab[]).map((tab) => ({
          id: tab.id,
          title: tab.title,
          filePath: tab.filePath ?? null,
          value: tab.value ?? { children: [] },
          toolState: tab.toolState,
          dirty: false,
        }));
        active = (stored.activeId as string) ?? null;
      } else if (isDesktop && stored?.boardPath) {
        const path = stored.boardPath as string;
        const value = (await fileExists(path)) ? parseBoard(await readFileText(path)) : null;
        restored = [
          {
            id: uid(),
            title: fileNameOf(path),
            filePath: path,
            value: value ?? { children: [] },
            toolState: stored.toolState as Partial<DrawnixToolState>,
            dirty: false,
          },
        ];
        active = restored[0].id;
      } else if (!isDesktop) {
        const [legacyValue, legacyTool] = await Promise.all([
          localforage.getItem(MAIN_BOARD_CONTENT_KEY),
          localforage.getItem(MAIN_BOARD_TOOL_STATE_KEY),
        ]);
        restored = [
          {
            id: uid(),
            title: preferenceRef.current.language === 'zh' ? '未命名' : 'Untitled',
            filePath: null,
            value: (legacyValue as AppValue) ?? { children: [] },
            toolState: legacyTool as Partial<DrawnixToolState>,
            dirty: false,
          },
        ];
        active = restored[0].id;
      }
      if (isDesktop) {
        for (const tab of restored) {
          if (tab.filePath && (await fileExists(tab.filePath))) {
            tab.value = parseBoard(await readFileText(tab.filePath)) ?? tab.value;
          }
        }
        const launch = await launchFilePath();
        if (launch && !restored.some((tab) => tab.filePath === launch)) {
          const value = parseBoard(await readFileText(launch));
          if (value) {
            const tab: BoardTab = {
              id: uid(),
              title: fileNameOf(launch),
              filePath: launch,
              value,
              dirty: false,
            };
            restored.push(tab);
            active = tab.id;
            rememberBoard(launch);
          }
        }
      }
      if (restored.length === 0) {
        if (isDesktop) {
          const path = await defaultBoardPath();
          const value = (await fileExists(path)) ? parseBoard(await readFileText(path)) : null;
          restored = [
            { id: uid(), title: fileNameOf(path), filePath: path, value: value ?? { children: [] }, dirty: false },
          ];
        } else {
          restored = [
            {
              id: uid(),
              title: preferenceRef.current.language === 'zh' ? '未命名' : 'Untitled',
              filePath: null,
              value: { children: [] },
              dirty: false,
            },
          ];
        }
        active = restored[0].id;
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
    void getCurrentWindow().setTitle(`${tab ? tab.title : 'Drawnix'} - Drawnix`);
  }, [tabs, activeId, loaded]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
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
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener(EVENT.NEW_MIND_MAP, onNewMind);
    window.addEventListener(OPEN_RECENT_EVENT, onRecent);
    const unlisten = isDesktop
      ? listen<string>('open-file', (event) => void openPath(event.payload))
      : null;
    return () => {
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
      for (const tab of tabsRef.current) {
        window.clearTimeout(fileTimers.current.get(tab.id));
        if (tab.filePath) {
          await flushTabFile(tab.id);
        }
      }
      writeWorkspace();
      await appWindow.destroy();
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
    bound: !!tab.filePath,
    dirty: tab.dirty,
    active: tab.id === activeId,
  }));

  const activeTheme = tabs.find((tab) => tab.id === activeId)?.value.theme?.themeColorMode;
  const darkChrome = activeTheme === 'dark' || activeTheme === 'starry';

  return (
    <div className={`workspace${darkChrome ? ' workspace--dark' : ''}`}>
      <TabStrip
        tabs={views}
        language={preference.language}
        onActivate={activate}
        onClose={closeTab}
        onNew={newMindTab}
      />
      <div className="workspace__panels">
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
                const next = value as AppValue;
                commitTabs(
                  tabsRef.current.map((item) =>
                    item.id === tab.id ? { ...item, value: next, dirty: true } : item
                  )
                );
                scheduleFileSave(tab.id);
                schedulePersist();
              }}
              onToolStateChange={(toolState) => {
                commitTabs(
                  tabsRef.current.map((item) => (item.id === tab.id ? { ...item, toolState } : item))
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
        {tabs.length === 0 && <EmptyWorkspace language={preference.language} onNew={newMindTab} />}
      </div>
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