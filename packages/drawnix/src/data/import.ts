import { strFromU8, unzipSync } from 'fflate';

type JsonTopic = {
  title?: string;
  children?: JsonTopic[] | { attached?: JsonTopic[] };
};

const cleanTitle = (value: string | null | undefined, fallback: string) => {
  const title = (value ?? '').replace(/\s+/g, ' ').trim();
  return title || fallback;
};

const localName = (element: Element) => element.localName;

const directChild = (element: Element, name: string) =>
  Array.from(element.children).find((child) => localName(child) === name);

const xmlTopicToMarkdown = (topic: Element, depth: number, lines: string[]) => {
  const title = cleanTitle(directChild(topic, 'title')?.textContent, '未命名');
  lines.push(`${'#'.repeat(Math.min(depth, 6))} ${title}`);
  const children = directChild(topic, 'children');
  const topics = children ? directChild(children, 'topics') : undefined;
  if (!topics) {
    return;
  }
  for (const child of Array.from(topics.children)) {
    if (localName(child) === 'topic') {
      xmlTopicToMarkdown(child, depth + 1, lines);
    }
  }
};

export const xmindXmlToMarkdown = (xml: string, fallbackTitle = 'XMind') => {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) {
    throw new Error('Invalid XMind XML');
  }
  const sheets = Array.from(document.getElementsByTagNameNS('*', 'sheet'));
  const roots = sheets
    .map((sheet) => directChild(sheet, 'topic'))
    .filter((topic): topic is Element => !!topic);
  if (roots.length === 0) {
    throw new Error('XMind file contains no topics');
  }
  const lines: string[] = [];
  if (roots.length === 1) {
    xmlTopicToMarkdown(roots[0], 1, lines);
  } else {
    lines.push(`# ${cleanTitle(fallbackTitle, 'XMind')}`);
    roots.forEach((root) => xmlTopicToMarkdown(root, 2, lines));
  }
  return lines.join('\n');
};

const jsonChildren = (topic: JsonTopic): JsonTopic[] => {
  if (Array.isArray(topic.children)) {
    return topic.children;
  }
  return topic.children?.attached ?? [];
};

const jsonTopicToMarkdown = (topic: JsonTopic, depth: number, lines: string[]) => {
  lines.push(`${'#'.repeat(Math.min(depth, 6))} ${cleanTitle(topic.title, '未命名')}`);
  jsonChildren(topic).forEach((child) => jsonTopicToMarkdown(child, depth + 1, lines));
};

export const xmindJsonToMarkdown = (source: string, fallbackTitle = 'XMind') => {
  const data = JSON.parse(source) as JsonTopic | JsonTopic[];
  const roots = Array.isArray(data) ? data : [data];
  if (roots.length === 0) {
    throw new Error('XMind file contains no topics');
  }
  const lines: string[] = [];
  if (roots.length === 1) {
    jsonTopicToMarkdown(roots[0], 1, lines);
  } else {
    lines.push(`# ${cleanTitle(fallbackTitle, 'XMind')}`);
    roots.forEach((root) => jsonTopicToMarkdown(root, 2, lines));
  }
  return lines.join('\n');
};

const fallbackName = (fileName: string) => fileName.replace(/\.[^.]+$/, '') || 'XMind';

export const readImportFile = async (file: File) => {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xmind')) {
    if (file.size > 50 * 1024 * 1024) {
      throw new Error('XMind file is too large');
    }
    const files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (entry) =>
        (entry.name === 'content.xml' || entry.name === 'content.json') &&
        entry.originalSize <= 20 * 1024 * 1024,
    });
    const content = files['content.xml'] ?? files['content.json'];
    if (!content) {
      throw new Error('XMind file is missing content.xml or content.json');
    }
    if (content.length > 20 * 1024 * 1024) {
      throw new Error('XMind content is too large');
    }
    const source = strFromU8(content);
    return files['content.xml']
      ? xmindXmlToMarkdown(source, fallbackName(file.name))
      : xmindJsonToMarkdown(source, fallbackName(file.name));
  }
  if (name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.txt')) {
    if (file.size > 20 * 1024 * 1024) {
      throw new Error('Markdown file is too large');
    }
    return file.text();
  }
  throw new Error('Unsupported import file');
};
