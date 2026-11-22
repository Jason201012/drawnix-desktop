import type { FileSystemHandle as BrowserFileSystemHandle } from 'browser-fs-access';
import {
  fileOpen as _fileOpen,
  fileSave as _fileSave,
  supported as nativeFileSystemSupported,
} from 'browser-fs-access';
import { MIME_TYPES } from '../constants';
import {
  abortError,
  fileNameOf,
  getDesktopPath,
  isDesktop,
  pickOpen,
  pickSave,
  readDesktopFile,
  writeDesktopBlob,
  type DesktopFileHandle,
} from './desktop';

type FILE_EXTENSION = Exclude<keyof typeof MIME_TYPES, 'binary'>;

export type FileSystemHandle =
  | BrowserFileSystemHandle
  | FileSystemFileHandle
  | DesktopFileHandle;

type FileWithHandle = File & { handle?: FileSystemHandle };

const extensionList = (extensions?: FILE_EXTENSION[]) =>
  (extensions ?? []).reduce((acc, ext) => {
    if (ext === 'jpg') {
      return acc.concat('.jpg', '.jpeg');
    }
    return acc.concat(`.${ext}`);
  }, [] as string[]);

const mimeFromFileName = (name: string) => {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'jpeg') {
    return MIME_TYPES.jpg;
  }
  return (MIME_TYPES as Record<string, string>)[ext] ?? '';
};

export const fileOpen = <M extends boolean | undefined = false>(opts: {
  extensions?: FILE_EXTENSION[];
  description: string;
  multiple?: M;
}): Promise<M extends false | undefined ? File : File[]> => {
  // an unsafe TS hack, alas not much we can do AFAIK
  type RetType = M extends false | undefined ? File : File[];

  const extensions = extensionList(opts.extensions);
  const mimeTypes = (opts.extensions ?? []).map((type) => MIME_TYPES[type]);

  if (isDesktop) {
    return (async () => {
      const filters = extensions.length
        ? [
            {
              name: opts.description,
              extensions: extensions.map((ext) => ext.replace(/^\./, '')),
            },
          ]
        : [];
      const paths = await pickOpen(filters, opts.multiple ?? false);
      if (paths.length === 0) {
        throw abortError();
      }
      const files = await Promise.all(
        paths.map(async (path) => {
          const file = await readDesktopFile(path, mimeFromFileName(path));
          (file as FileWithHandle).handle = { kind: 'file', name: file.name, path };
          return file;
        })
      );
      return (opts.multiple ? files : files[0]) as RetType;
    })();
  }

  return _fileOpen({
    description: opts.description,
    extensions,
    mimeTypes,
    multiple: opts.multiple ?? false,
  }) as Promise<RetType>;
};

export const fileSave = (
  blob: Blob | Promise<Blob>,
  opts: {
    /** supply without the extension */
    name: string;
    /** file extension */
    extension: FILE_EXTENSION;
    description: string;
    /** existing FileSystemHandle */
    fileHandle?: FileSystemHandle | null;
  }
) => {
  if (isDesktop) {
    return (async () => {
      const fileName = `${opts.name}.${opts.extension}`;
      let path = getDesktopPath(opts.fileHandle);
      if (!path) {
        path = await pickSave(fileName, [
          { name: opts.description, extensions: [opts.extension] },
        ]);
        if (!path) {
          throw abortError();
        }
      }
      await writeDesktopBlob(path, await blob);
      return { kind: 'file', name: fileNameOf(path), path } as DesktopFileHandle;
    })();
  }

  return _fileSave(
    blob,
    {
      fileName: `${opts.name}.${opts.extension}`,
      description: opts.description,
      extensions: [`.${opts.extension}`],
    },
    opts.fileHandle as any
  );
};

export { nativeFileSystemSupported };