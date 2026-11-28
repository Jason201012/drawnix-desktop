export type VersionDiffNode = {
  id: string;
  text: string;
};

export type VersionDiff = {
  added: VersionDiffNode[];
  removed: VersionDiffNode[];
  changed: VersionDiffNode[];
};

type BoardElement = {
  id?: string;
  type?: string;
  text?: string;
  texts?: unknown[];
  data?: {
    topic?: { children?: { text?: string }[] };
    text?: string;
  };
  children?: BoardElement[];
  [key: string]: unknown;
};

const flattenElements = (elements: BoardElement[]) => {
  const flattened: BoardElement[] = [];
  const visit = (element: BoardElement) => {
    flattened.push(element);
    element.children?.forEach(visit);
  };
  elements.forEach(visit);
  return flattened;
};

const nodeText = (element: BoardElement) => {
  const topic = element.data?.topic?.children;
  if (topic) {
    const text = topic
      .map((part) => part.text ?? '')
      .join('')
      .trim();
    if (text) {
      return text;
    }
  }
  if (typeof element.data?.text === 'string' && element.data.text.trim()) {
    return element.data.text.trim();
  }
  if (typeof element.text === 'string' && element.text.trim()) {
    return element.text.trim();
  }
  if (Array.isArray(element.texts)) {
    const text = element.texts
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'text' in item) {
          const value = (item as { text?: unknown }).text;
          return typeof value === 'string' ? value : '';
        }
        return '';
      })
      .join('')
      .trim();
    if (text) {
      return text;
    }
  }
  return element.type || element.id || '';
};

const contentSignature = (element: BoardElement) => {
  const {
    children: _children,
    points: _points,
    x: _x,
    y: _y,
    width: _width,
    height: _height,
    angle: _angle,
    ...content
  } = element;
  return JSON.stringify(content);
};

export const compareBoardVersions = (
  olderElements: BoardElement[],
  newerElements: BoardElement[]
): VersionDiff => {
  const older = flattenElements(olderElements).filter(
    (element): element is BoardElement & { id: string } => typeof element.id === 'string'
  );
  const newer = flattenElements(newerElements).filter(
    (element): element is BoardElement & { id: string } => typeof element.id === 'string'
  );
  const olderById = new Map(older.map((element) => [element.id, element]));
  const newerById = new Map(newer.map((element) => [element.id, element]));
  const diff: VersionDiff = { added: [], removed: [], changed: [] };

  for (const element of newer) {
    const previous = olderById.get(element.id);
    const node = { id: element.id, text: nodeText(element) };
    if (!previous) {
      diff.added.push(node);
    } else if (contentSignature(previous) !== contentSignature(element)) {
      diff.changed.push(node);
    }
  }
  for (const element of older) {
    if (!newerById.has(element.id)) {
      diff.removed.push({ id: element.id, text: nodeText(element) });
    }
  }
  return diff;
};
