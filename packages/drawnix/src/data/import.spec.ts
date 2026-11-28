// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { strToU8, zipSync } from 'fflate';
import { readImportFile, xmindJsonToMarkdown, xmindXmlToMarkdown } from './import';

beforeAll(() => {
  vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('XMind import', () => {
  it('converts nested XMind XML topics to Markdown headings', () => {
    const xml = `<xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0"><sheet><topic><title>Root</title><children><topics type="attached"><topic><title>Child</title><children><topics><topic><title>Leaf</title></topic></topics></children></topic></topics></children></topic></sheet></xmap-content>`;

    expect(xmindXmlToMarkdown(xml)).toBe('# Root\n## Child\n### Leaf');
  });

  it('converts XMind JSON topics and attached children', () => {
    const source = JSON.stringify({
      title: 'Root',
      children: { attached: [{ title: 'Child', children: { attached: [{ title: 'Leaf' }] } }] },
    });

    expect(xmindJsonToMarkdown(source)).toBe('# Root\n## Child\n### Leaf');
  });

  it('converts modern XMind sheets with rootTopic', () => {
    const source = JSON.stringify([
      {
        class: 'sheet',
        rootTopic: {
          title: 'Sheet Root',
          children: { attached: [{ title: 'Child' }] },
        },
      },
    ]);

    expect(xmindJsonToMarkdown(source)).toBe('# Sheet Root\n## Child');
  });

  it('reads content.xml from a XMind ZIP file', async () => {
    const xml =
      '<xmap-content><sheet><topic><title>From ZIP</title></topic></sheet></xmap-content>';
    const zipped = zipSync({ 'content.xml': strToU8(xml) });
    const bytes = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
    const file = new File([bytes], 'sample.xmind');

    await expect(readImportFile(file)).resolves.toBe('# From ZIP');
  });

  it('prefers content.json over a legacy warning content.xml', async () => {
    const xml = '<xmap-content><sheet><topic><title>Warning</title></topic></sheet></xmap-content>';
    const json = JSON.stringify([
      {
        class: 'sheet',
        rootTopic: {
          title: 'Actual Map',
          children: { attached: [{ title: 'Branch' }] },
        },
      },
    ]);
    const zipped = zipSync({
      'content.xml': strToU8(xml),
      'content.json': strToU8(json),
    });
    const bytes = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
    const file = new File([bytes], 'dual-content.xmind');

    await expect(readImportFile(file)).resolves.toBe('# Actual Map\n## Branch');
  });
});
