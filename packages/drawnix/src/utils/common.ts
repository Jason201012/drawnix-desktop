import { IS_APPLE, IS_MAC, PlaitBoard, toSvgData, ToImageOptions } from '@plait/core';
import type { ResolutionType } from './utility-types';
import { isDesktop, pickSave, writeDesktopBlob } from '../data/desktop';
import { toPortableSvg } from './svg-text';

export const isPromiseLike = (value: any): value is Promise<ResolutionType<typeof value>> => {
  return (
    !!value &&
    typeof value === 'object' &&
    'then' in value &&
    'catch' in value &&
    'finally' in value
  );
};

// taken from Radix UI
// https://github.com/radix-ui/primitives/blob/main/packages/core/primitive/src/primitive.tsx
export const composeEventHandlers = <E>(
  originalEventHandler?: (event: E) => void,
  ourEventHandler?: (event: E) => void,
  { checkForDefaultPrevented = true } = {}
) => {
  return function handleEvent(event: E) {
    originalEventHandler?.(event);

    if (!checkForDefaultPrevented || !(event as unknown as Event)?.defaultPrevented) {
      return ourEventHandler?.(event);
    }
  };
};

export const base64ToBlob = (base64: string) => {
  const arr = base64.split(',');
  const fileType = arr[0].match(/:(.*?);/)![1];
  const bstr = atob(arr[1]);
  let l = bstr.length;
  const u8Arr = new Uint8Array(l);

  while (l--) {
    u8Arr[l] = bstr.charCodeAt(l);
  }
  return new Blob([u8Arr], {
    type: fileType,
  });
};

const loadSvgImage = (source: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to load exported SVG.'));
    image.src = source;
  });

const MAX_IMAGE_PIXELS = 32_000_000;
const MAX_IMAGE_SIDE = 16_384;

export const getImageExportRatio = (width: number, height: number, requestedRatio: number) =>
  Math.min(
    requestedRatio,
    Math.sqrt(MAX_IMAGE_PIXELS / (width * height)),
    MAX_IMAGE_SIDE / width,
    MAX_IMAGE_SIDE / height
  );

export const boardToImage = async (board: PlaitBoard, options: ToImageOptions = {}) => {
  const {
    fillStyle = 'transparent',
    ratio = 4,
    ...svgOptions
  } = {
    fillStyle: 'transparent',
    inlineStyleClassNames: '.extend,.emojis,.text',
    padding: 20,
    ratio: 4,
    ...options,
  };
  try {
    const svgData = await toSvgData(board, { ...svgOptions, fillStyle: '' });
    const portableSvgData = toPortableSvg(svgData);
    const parsed = new DOMParser().parseFromString(portableSvgData, 'image/svg+xml');
    const root = parsed.documentElement;
    const width = Number.parseFloat(root.getAttribute('width') || '0');
    const height = Number.parseFloat(root.getAttribute('height') || '0');
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return undefined;
    }
    const canvas = document.createElement('canvas');
    const exportRatio = getImageExportRatio(width, height, ratio);
    canvas.width = Math.max(1, Math.min(MAX_IMAGE_SIDE, Math.round(width * exportRatio)));
    canvas.height = Math.max(1, Math.min(MAX_IMAGE_SIDE, Math.round(height * exportRatio)));
    const context = canvas.getContext('2d');
    if (!context) {
      return undefined;
    }
    if (fillStyle !== 'transparent') {
      context.fillStyle = fillStyle;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    const image = await loadSvgImage(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(portableSvgData)}`
    );
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png');
    });
  } catch (error) {
    console.error('Error converting SVG to image:', error);
    return undefined;
  }
};

export function download(blob: Blob | MediaSource, filename: string) {
  if (isDesktop && blob instanceof Blob) {
    const extension = filename.split('.').pop() ?? '';
    pickSave(filename, [{ name: filename, extensions: [extension] }])
      .then(async (path) => {
        if (path) {
          await writeDesktopBlob(path, blob);
        }
      })
      .catch((error) => console.error(error));
    return;
  }
  const a = document.createElement('a');
  const url = window.URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  window.URL.revokeObjectURL(url);
  a.remove();
}

export const splitRows = <T>(shapes: T[], cols: number) => {
  const result = [];
  for (let i = 0; i < shapes.length; i += cols) {
    result.push(shapes.slice(i, i + cols));
  }
  return result;
};

export const getShortcutKey = (shortcut: string): string => {
  shortcut = shortcut
    .replace(/\bAlt\b/i, 'Alt')
    .replace(/\bShift\b/i, 'Shift')
    .replace(/\b(Enter|Return)\b/i, 'Enter');
  if (IS_APPLE || IS_MAC) {
    return shortcut.replace(/\bCtrlOrCmd\b/gi, 'Cmd').replace(/\bAlt\b/i, 'Option');
  }
  return shortcut.replace(/\bCtrlOrCmd\b/gi, 'Ctrl');
};
