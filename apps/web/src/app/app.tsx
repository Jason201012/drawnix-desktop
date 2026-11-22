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
  type DesktopFileHandle,
} from '@drawnix/drawnix';
import { PlaitBoard, PlaitElement, PlaitTheme, Viewport } from '@plait/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import localforage from 'localforage';

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

type PersistedState = {
  boardPath?: string;
  toolState?: Partial<DrawnixToolState>;
  preference?: MainBoardPreference;
  recentBoards?: string[];
};

const MAIN_BOARD_CONTENT_KEY = 'main_board_content';
const MAIN_BOARD_TOOL_STATE_KEY = 'main_board_tool_state';
const MAIN_BOARD_PREFERENCE_KEY = 'main_board_preference';

const SAVE_DEBOUNCE_MS = 600;

localforage.config({
  name: 'Drawnix',
  storeName: 'drawnix_store',
  driver: [localforage.INDEXEDDB, localforage.LOCALSTORAGE],
});

export function App() {
  const [value, setValue] = useState<AppValue>({ children: [] });
  const [initialToolState, setInitialToolState] = useState<Partial<DrawnixToolState>>();
  const [initialFileHandle, setInitialFileHandle] = useState<DesktopFileHandle | null>(null);
  const [preference, setPreference] = useState<MainBoardPreference>({
    language: 'zh',
    copyTransparent: false,
    exportTransparent: false,
  });
  const [loaded, setLoaded] = useState(false);
  const [tutorial, setTutorial] = useState(false);
  const [boardKey, setBoardKey] = useState(0);

  const boardRef = useRef<PlaitBoard | null>(null);
  const boardPathRef = useRef<string | null>(null);
  const toolStateRef = useRef<Partial<DrawnixToolState> | undefined>(undefined);
  const preferenceRef = useRef(preference);
  const saveTimerRef = useRef<number | undefined>(undefined);

  const persistState = () => {
    void writeAppState({
      boardPath: boardPathRef.current ?? undefined,
      toolState: toolStateRef.current,
      preference: preferenceRef.current,
      recentBoards: getRecentBoards(),
    });
  };

  const rememberBoard = (path: string) => {
    setRecentBoards([path, ...getRecentBoards().filter((item) => item !== path)].slice(0, 8));
  };

  const saveBoard = async () => {
    const board = boardRef.current;
    const path = boardPathRef.current;
    if (!board || !path) {
      return;
    }
    await writeFileText(path, serializeAsJSON(board));
  };

  const scheduleSave = () => {
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void saveBoard();
    }, SAVE_DEBOUNCE_MS);
  };

  const openBoardFile = async (path: string) => {
    try {
      const data = JSON.parse(await readFileText(path));
      if (!Array.isArray(data.elements)) {
        return;
      }
      boardPathRef.current = path;
      rememberBoard(path);
      setInitialFileHandle({ kind: 'file', name: fileNameOf(path), path });
      setValue({ children: data.elements, viewport: data.viewport, theme: data.theme });
      setTutorial(data.elements.length === 0);
      setBoardKey((key) => key + 1);
      void getCurrentWindow().setTitle(`${fileNameOf(path)} - Drawnix`);
      persistState();
    } catch (error) {
      console.error(error);
    }
  };

  const updatePreference = (partialPreference: Partial<MainBoardPreference>) => {
    const nextPreference = { ...preferenceRef.current, ...partialPreference };
    preferenceRef.current = nextPreference;
    setPreference(nextPreference);
    if (isDesktop) {
      persistState();
    } else {
      void localforage.setItem(MAIN_BOARD_PREFERENCE_KEY, nextPreference);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      if (isDesktop) {
        const state = (await readAppState()) as PersistedState;
        setRecentBoards(state.recentBoards ?? []);
        if (state.preference) {
          preferenceRef.current = state.preference;
          setPreference(state.preference);
        }
        if (state.toolState) {
          toolStateRef.current = state.toolState;
          setInitialToolState(state.toolState);
        }
        let path = (await launchFilePath()) ?? state.boardPath ?? null;
        if (!path || !(await fileExists(path))) {
          path = await defaultBoardPath();
        }
        boardPathRef.current = path;
        setInitialFileHandle({ kind: 'file', name: fileNameOf(path), path });
        void getCurrentWindow().setTitle(`${fileNameOf(path)} - Drawnix`);
        let appValue: AppValue = { children: [] };
        if (await fileExists(path)) {
          try {
            const data = JSON.parse(await readFileText(path));
            if (Array.isArray(data.elements)) {
              appValue = {
                children: data.elements,
                viewport: data.viewport,
                theme: data.theme,
              };
            }
          } catch {
            appValue = { children: [] };
          }
        }
        setValue(appValue);
        setTutorial(appValue.children.length === 0);
      } else {
        const [storedData, storedToolState, storedPreference] = await Promise.all([
          localforage.getItem(MAIN_BOARD_CONTENT_KEY),
          localforage.getItem(MAIN_BOARD_TOOL_STATE_KEY),
          localforage.getItem(MAIN_BOARD_PREFERENCE_KEY),
        ]);
        if (storedData) {
          const appValue = storedData as AppValue;
          setValue(appValue);
          if (appValue.children && appValue.children.length === 0) {
            setTutorial(true);
          }
        } else {
          setTutorial(true);
        }
        if (storedToolState) {
          setInitialToolState(storedToolState as Partial<DrawnixToolState>);
        }
        if (storedPreference) {
          setPreference(storedPreference as MainBoardPreference);
        }
      }
      setLoaded(true);
    };
    loadData();
  }, []);

  useEffect(() => {
    if (!isDesktop) {
      return;
    }
    const openRecent = (event: Event) => {
      void openBoardFile((event as CustomEvent<string>).detail);
    };
    window.addEventListener(OPEN_RECENT_EVENT, openRecent);
    return () => {
      window.removeEventListener(OPEN_RECENT_EVENT, openRecent);
    };
  }, []);

  useEffect(() => {
    if (!isDesktop) {
      return;
    }
    const unlisten = listen<string>('open-file', (event) => {
      void openBoardFile(event.payload);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (!isDesktop) {
      return;
    }
    const appWindow = getCurrentWindow();
    const unlisten = appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      window.clearTimeout(saveTimerRef.current);
      await saveBoard();
      await appWindow.destroy();
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  if (!loaded) {
    return null;
  }
  return (
    <Drawnix
      key={boardKey}
      value={value.children}
      viewport={value.viewport}
      theme={value.theme}
      initialToolState={initialToolState}
      initialFileHandle={initialFileHandle ?? undefined}
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
        const newValue = value as AppValue;
        setValue(newValue);
        if (newValue.children && newValue.children.length > 0) {
          setTutorial(false);
        }
        if (isDesktop) {
          scheduleSave();
        } else {
          void localforage.setItem(MAIN_BOARD_CONTENT_KEY, newValue);
        }
      }}
      onToolStateChange={(toolState) => {
        toolStateRef.current = toolState;
        if (isDesktop) {
          persistState();
        } else {
          void localforage.setItem(MAIN_BOARD_TOOL_STATE_KEY, toolState);
        }
      }}
      onFileHandleChange={(fileHandle) => {
        if (!isDesktop) {
          return;
        }
        const path = getDesktopPath(fileHandle);
        if (path && path !== boardPathRef.current) {
          boardPathRef.current = path;
          rememberBoard(path);
          void getCurrentWindow().setTitle(`${fileNameOf(path)} - Drawnix`);
          persistState();
        }
      }}
      tutorial={tutorial}
      afterInit={(board) => {
        boardRef.current = board;
      }}
    ></Drawnix>
  );
}

export default App;