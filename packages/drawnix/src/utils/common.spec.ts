import { afterEach, describe, expect, it, vi } from 'vitest';
import { toSvgData } from '@plait/core';
import type { PlaitBoard } from '@plait/core';
import { boardToImage } from './common';

vi.mock('@plait/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@plait/core')>()),
  toSvgData: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('boardToImage', () => {
  it('rasterizes portable SVG text instead of the original foreignObject markup', async () => {
    let loadedSource = '';
    class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(value: string) {
        loadedSource = value;
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', MockImage);

    const context = {
      fillStyle: '',
      font: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      measureText: (text: string) => ({ width: text.length * 14 }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAA');
    vi.mocked(toSvgData).mockResolvedValue(
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><foreignObject x="10" y="20" width="180" height="40"><div xmlns="http://www.w3.org/1999/xhtml" class="slate-editable-container plait-text-container"><div data-slate-node="element"><span data-slate-node="text" style="font-size: 14px; font-family: Arial, sans-serif; line-height: 20px;">SVG 文字导出回归</span></div></div></foreignObject></svg>`
    );

    const result = await boardToImage({} as PlaitBoard, { ratio: 2, fillStyle: '#ffffff' });
    const svgSource = decodeURIComponent(loadedSource.split(',')[1] ?? '');

    expect(result).toBe('data:image/png;base64,AAA');
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 400, 200);
    expect(context.drawImage).toHaveBeenCalledOnce();
    expect(svgSource).toContain('<text');
    expect(svgSource).not.toContain('<foreignObject');
  });
});
