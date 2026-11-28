export * from './drawnix';
export * from './utils';
export * from './i18n';
export { serializeAsJSON } from './data/json';
export { EVENT } from './constants';
export type { DrawnixBoard } from './hooks/use-drawnix';
export {
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
} from './data/desktop';
export type {
  DesktopFileHandle,
  BoardVersionInfo,
  RecentMapInfo,
  StorageStats,
  StorageCleanupInfo,
  DialogFilter,
} from './data/desktop';
