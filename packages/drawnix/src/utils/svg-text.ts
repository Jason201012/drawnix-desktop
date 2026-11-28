const SVG_NS = 'http://www.w3.org/2000/svg';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const DEFAULT_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Noto Sans", "Noto Sans CJK SC", "Microsoft Yahei", "Hiragino Sans GB", Arial, sans-serif';

type TextStyle = {
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  color: string;
  textDecoration: string;
};

type TextRun = {
  text: string;
  style: TextStyle;
};

const defaultTextStyle = (): TextStyle => ({
  fontSize: 14,
  fontFamily: DEFAULT_FONT_FAMILY,
  fontWeight: '400',
  fontStyle: 'normal',
  color: '#000000',
  textDecoration: 'none',
});

const readTextStyle = (element: Element, fallback: TextStyle): TextStyle => {
  const style = (element as HTMLElement).style;
  return {
    fontSize: Number.parseFloat(style.fontSize) || fallback.fontSize,
    fontFamily: style.fontFamily || fallback.fontFamily,
    fontWeight: style.fontWeight || fallback.fontWeight,
    fontStyle: style.fontStyle || fallback.fontStyle,
    color: style.color || fallback.color,
    textDecoration: style.textDecoration || fallback.textDecoration,
  };
};

const tokenize = (text: string) => text.match(/[^\S\r\n]+|[A-Za-z0-9_./+-]+|./gu) ?? [];

const appendRun = (line: TextRun[], run: TextRun) => {
  const previous = line[line.length - 1];
  if (previous?.style === run.style) {
    previous.text += run.text;
    return;
  }
  line.push({ ...run });
};

const wrapRuns = (
  runs: TextRun[],
  maxWidth: number,
  measure: (text: string, style: TextStyle) => number
) => {
  const lines: TextRun[][] = [];
  let line: TextRun[] = [];
  let lineWidth = 0;
  const flushLine = () => {
    if (line.length > 0) {
      lines.push(line);
      line = [];
      lineWidth = 0;
    }
  };

  for (const run of runs) {
    const paragraphs = run.text.split(/\r?\n/);
    paragraphs.forEach((paragraph, paragraphIndex) => {
      if (paragraphIndex > 0) {
        flushLine();
      }
      for (const token of tokenize(paragraph)) {
        let tokenWidth = measure(token, run.style);
        if (tokenWidth > maxWidth) {
          for (const character of Array.from(token)) {
            const characterWidth = measure(character, run.style);
            if (lineWidth + characterWidth > maxWidth && lineWidth > 0) {
              flushLine();
            }
            appendRun(line, { ...run, text: character });
            lineWidth += characterWidth;
          }
          continue;
        }
        if (lineWidth + tokenWidth > maxWidth && lineWidth > 0) {
          flushLine();
        }
        appendRun(line, { ...run, text: token });
        lineWidth += tokenWidth;
      }
    });
  }
  flushLine();
  return lines;
};

const getTextRuns = (paragraph: Element, baseStyle: TextStyle) => {
  const leaves = Array.from(paragraph.querySelectorAll('[data-slate-node="text"]'));
  if (leaves.length === 0) {
    const text = paragraph.textContent ?? '';
    return text ? [{ text, style: baseStyle }] : [];
  }
  return leaves
    .map((leaf) => ({ text: leaf.textContent ?? '', style: readTextStyle(leaf, baseStyle) }))
    .filter((run) => run.text.length > 0);
};

const getTextAlign = (paragraph: Element) => {
  const style = (paragraph as HTMLElement).style;
  return {
    align: style.textAlign || 'start',
    direction: style.direction || paragraph.getAttribute('dir') || 'ltr',
  };
};

const replaceForeignObject = (
  foreignObject: Element,
  document: Document,
  measure: typeof measureText
) => {
  if (foreignObject.querySelector('img')) {
    return;
  }
  const width = Number.parseFloat(foreignObject.getAttribute('width') || '0');
  const x = Number.parseFloat(foreignObject.getAttribute('x') || '0');
  const y = Number.parseFloat(foreignObject.getAttribute('y') || '0');
  if (!Number.isFinite(width) || width <= 0) {
    return;
  }
  const container =
    foreignObject.querySelector('.plait-text-container') ?? foreignObject.querySelector('div');
  if (!container) {
    return;
  }
  const paragraphs = Array.from(container.querySelectorAll('[data-slate-node="element"]'));
  const textParagraphs = paragraphs.length > 0 ? paragraphs : [container];
  const firstLeaf = container.querySelector('[data-slate-node="text"]');
  const baseStyle = firstLeaf ? readTextStyle(firstLeaf, defaultTextStyle()) : defaultTextStyle();
  const lineHeight =
    Number.parseFloat((firstLeaf as HTMLElement | null)?.style.lineHeight || '') ||
    baseStyle.fontSize * 1.5;
  const lines: { runs: TextRun[]; align: string; direction: string }[] = [];

  for (const paragraph of textParagraphs) {
    const runs = getTextRuns(paragraph, baseStyle);
    if (runs.length === 0) {
      continue;
    }
    const { align, direction } = getTextAlign(paragraph);
    for (const line of wrapRuns(runs, width, measure)) {
      lines.push({ runs: line, align, direction });
    }
  }
  if (lines.length === 0) {
    return;
  }

  const text = document.createElementNS(SVG_NS, 'text');
  text.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  text.setAttribute('font-family', baseStyle.fontFamily);
  text.setAttribute('font-size', String(baseStyle.fontSize));
  text.setAttribute('font-weight', baseStyle.fontWeight);
  text.setAttribute('font-style', baseStyle.fontStyle);
  text.setAttribute('fill', baseStyle.color);
  const transform = foreignObject.getAttribute('transform');
  text.setAttribute('transform', `translate(${x} ${y})${transform ? ` ${transform}` : ''}`);

  lines.forEach((line, lineIndex) => {
    const rtl = line.direction === 'rtl';
    let x = rtl ? width : 0;
    let anchor = 'start';
    if (line.align === 'center') {
      x = width / 2;
      anchor = 'middle';
    } else if (line.align === 'right' || line.align === 'end') {
      x = width;
      anchor = 'end';
    } else if (line.align === 'left') {
      x = 0;
      anchor = 'start';
    }
    if (rtl) {
      text.setAttribute('direction', 'rtl');
    }
    line.runs.forEach((run, runIndex) => {
      const tspan = document.createElementNS(SVG_NS, 'tspan');
      if (runIndex === 0) {
        tspan.setAttribute('x', String(x));
        tspan.setAttribute('y', String(baseStyle.fontSize + lineIndex * lineHeight));
        tspan.setAttribute('text-anchor', anchor);
      }
      tspan.setAttribute('font-family', run.style.fontFamily);
      tspan.setAttribute('font-size', String(run.style.fontSize));
      tspan.setAttribute('font-weight', run.style.fontWeight);
      tspan.setAttribute('font-style', run.style.fontStyle);
      tspan.setAttribute('fill', run.style.color);
      if (run.style.textDecoration !== 'none') {
        tspan.setAttribute('text-decoration', run.style.textDecoration);
      }
      tspan.textContent = run.text;
      text.appendChild(tspan);
    });
  });

  foreignObject.parentNode?.replaceChild(text, foreignObject);
};

let canvasContext: CanvasRenderingContext2D | null | undefined;

const measureText = (text: string, style: TextStyle) => {
  if (canvasContext === undefined) {
    canvasContext = document.createElement('canvas').getContext('2d');
  }
  if (!canvasContext) {
    return Array.from(text).length * style.fontSize;
  }
  canvasContext.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
  return canvasContext.measureText(text).width;
};

export const toPortableSvg = (svgData: string) => {
  const parsed = new DOMParser().parseFromString(svgData, 'image/svg+xml');
  if (parsed.querySelector('parsererror')) {
    return svgData;
  }
  for (const foreignObject of Array.from(parsed.querySelectorAll('foreignObject'))) {
    replaceForeignObject(foreignObject, parsed, measureText);
  }
  return new XMLSerializer().serializeToString(parsed.documentElement);
};
