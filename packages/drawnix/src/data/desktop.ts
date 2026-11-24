import { invoke } from '@tauri-apps/api/core';

export const isDesktop =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export type DialogFilter = { name: string; extensions: string[] };

export type DesktopFileHandle = {
  kind: 'file';
  name: string;
  path: string;
};

export const getDesktopPath = (handle: unknown): string | null => {
  if (handle && typeof handle === 'object' && 'path' in handle) {
    const path = (handle as { path?: unknown }).path;
    if (typeof path === 'string' && path.length > 0) {
      return path;
    }
  }
  return null;
};

export const fileNameOf = (path: string) => path.split(/[\\/]/).pop() || path;

export const pickOpen = (filters: DialogFilter[], multiple: boolean) =>
  invoke<string[]>('pick_open', { filters, multiple });

export const pickSave = (defaultName: string, filters: DialogFilter[]) =>
  invoke<string | null>('pick_save', { defaultName, filters });

export const readFileBase64 = (path: string) =>
  invoke<string>('read_file_base64', { path });

export const writeFileBase64 = (path: string, data: string) =>
  invoke<void>('write_file_base64', { path, data });

export const readFileText = (path: string) =>
  invoke<string>('read_file_text', { path });

export const writeFileText = (path: string, contents: string) =>
  invoke<void>('write_file_text', { path, contents });

export const fileExists = (path: string) => invoke<boolean>('file_exists', { path });

export const readAppState = () => invoke<Record<string, unknown>>('read_app_state');

export const writeAppState = (state: Record<string, unknown>) =>
  invoke<void>('write_app_state', { state });

export const defaultBoardPath = () => invoke<string>('default_board_path');

export const launchFilePath = () => invoke<string | null>('launch_file_path');

export type CreatedMindMap = { folder_path: string; file_path: string };

export const createMindMap = (contents: string) =>
  invoke<CreatedMindMap>('create_mind_map', { contents });

export const saveBoardVersion = (folderPath: string, version: number, contents: string) =>
  invoke<void>('save_board_version', { folderPath, version, contents });

export const readBoardVersion = (path: string) => invoke<string>('read_board_version', { path });

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

const base64ToBytes = (data: string) => {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

export const readDesktopFile = async (path: string, type: string) => {
  const bytes = base64ToBytes(await readFileBase64(path));
  return new File([bytes], fileNameOf(path), { type });
};

export const writeDesktopBlob = async (path: string, blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await writeFileBase64(path, bytesToBase64(bytes));
};

export const abortError = () => new DOMException('The user aborted the operation.', 'AbortError');

export const OPEN_RECENT_EVENT = 'drawnix-open-recent';

let recentBoards: string[] = [];
const recentListeners = new Set<() => void>();

export const getRecentBoards = () => recentBoards;

export const setRecentBoards = (paths: string[]) => {
  recentBoards = paths;
  recentListeners.forEach((listener) => listener());
};

export const subscribeRecentBoards = (listener: () => void) => {
  recentListeners.add(listener);
  return () => {
    recentListeners.delete(listener);
  };
};