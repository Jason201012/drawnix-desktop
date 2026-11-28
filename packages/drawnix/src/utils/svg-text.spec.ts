import { afterEach, describe, expect, it, vi } from 'vitest';
import { toPortableSvg } from './svg-text';

const parseSvg = (source: string) => new DOMParser().parseFromString(source, 'image/svg+xml');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('toPortableSvg', () => {
  it('replaces text foreignObject content with wrapped native SVG text', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const text = '这是一段足够长的文字，用来验证导出后不会依赖 foreignObject 自动换行。';
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><g><foreignObject x="10" y="20" width="180" height="40"><div xmlns="http://www.w3.org/1999/xhtml" class="slate-editable-container plait-text-container"><div data-slate-node="element"><span data-slate-node="text" style="font-size: 14px; font-family: Arial, sans-serif; line-height: 20px; color: rgb(51, 51, 51);">${text}</span></div></div></foreignObject></g></svg>`;

    const result = parseSvg(toPortableSvg(source));
    const textElement = result.querySelector('text');

    expect(result.querySelector('foreignObject')).toBeNull();
    expect(textElement).not.toBeNull();
    expect(textElement?.textContent).toBe(text);
    expect(textElement?.getAttribute('transform')).toBe('translate(10 20)');
    expect(textElement?.getAttribute('fill')).toBe('rgb(51, 51, 51)');
    expect(textElement?.querySelectorAll('tspan').length).toBeGreaterThan(1);
  });

  it('keeps image foreignObject content unchanged', () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><foreignObject x="0" y="0" width="100" height="100"><div xmlns="http://www.w3.org/1999/xhtml"><img src="data:image/png;base64,AA==" /></div></foreignObject></svg>`;

    const result = parseSvg(toPortableSvg(source));

    expect(result.querySelector('foreignObject')).not.toBeNull();
    expect(result.querySelector('text')).toBeNull();
    expect(result.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AA==');
  });
});
