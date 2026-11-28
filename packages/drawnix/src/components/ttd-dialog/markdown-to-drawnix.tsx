import { useState, useEffect, useDeferredValue, useRef } from 'react';
import './mermaid-to-drawnix.scss';
import './ttd-dialog.scss';
import { TTDDialogPanels } from './ttd-dialog-panels';
import { TTDDialogPanel } from './ttd-dialog-panel';
import { TTDDialogInput } from './ttd-dialog-input';
import { TTDDialogOutput } from './ttd-dialog-output';
import { TTDDialogSubmitShortcut } from './ttd-dialog-submit-shortcut';
import { useDrawnix } from '../../hooks/use-drawnix';
import { useI18n } from '../../i18n';
import { useBoard } from '@plait-board/react-board';
import {
  getViewportOrigination,
  PlaitBoard,
  PlaitElement,
  WritableClipboardOperationType,
} from '@plait/core';
import { MindElement } from '@plait/mind';
import { readImportFile } from '../../data/import';

export interface MarkdownToDrawnixLibProps {
  loaded: boolean;
  api: Promise<{
    parseMarkdownToDrawnix: (definition: string, mainTopic?: string) => MindElement;
  }>;
}

const MarkdownToDrawnix = () => {
  const { appState, setAppState } = useDrawnix();
  const { t, language } = useI18n();
  const [markdownToDrawnixLib, setMarkdownToDrawnixLib] = useState<MarkdownToDrawnixLibProps>({
    loaded: false,
    api: Promise.resolve({
      parseMarkdownToDrawnix: (_definition: string, _mainTopic?: string) =>
        null as any as MindElement,
    }),
  });

  useEffect(() => {
    const loadLib = async () => {
      try {
        const module = await import('@plait-board/markdown-to-drawnix');
        setMarkdownToDrawnixLib({
          loaded: true,
          api: Promise.resolve(module),
        });
      } catch (err) {
        console.error('Failed to load mermaid library:', err);
        setError(new Error(t('dialog.error.loadMermaid')));
      }
    };
    loadLib();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [text, setText] = useState(() => t('markdown.example'));
  const [value, setValue] = useState<PlaitElement[]>(() => []);
  const deferredText = useDeferredValue(text.trim());
  const [error, setError] = useState<Error | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const board = useBoard();
  const templates = [
    {
      key: 'project',
      label: t('markdown.templateProject').split('\n')[0].replace(/^#\s*/, ''),
      markdown: t('markdown.templateProject'),
    },
    {
      key: 'weekly',
      label: t('markdown.templateWeekly').split('\n')[0].replace(/^#\s*/, ''),
      markdown: t('markdown.templateWeekly'),
    },
    {
      key: 'swot',
      label: t('markdown.templateSwot').split('\n')[0].replace(/^#\s*/, ''),
      markdown: t('markdown.templateSwot'),
    },
  ];

  const importFile = async (file: File) => {
    setImporting(true);
    setError(null);
    try {
      setText(await readImportFile(file));
    } catch (error) {
      console.error(error);
      setError(new Error(t('dialog.markdown.importFailed')));
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Update markdown example when language changes
  useEffect(() => {
    setText(t('markdown.example'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  useEffect(() => {
    const convertMarkdown = async () => {
      try {
        const api = await markdownToDrawnixLib.api;
        let ret;
        try {
          ret = await api.parseMarkdownToDrawnix(deferredText);
        } catch {
          ret = await api.parseMarkdownToDrawnix(deferredText.replace(/"/g, "'"));
        }
        const mind = ret;
        mind.points = [[0, 0]];
        if (mind) {
          setValue([mind]);
          setError(null);
        }
      } catch (err: any) {
        setError(err);
      }
    };
    convertMarkdown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredText, markdownToDrawnixLib]);

  const insertToBoard = () => {
    if (!value.length) {
      return;
    }
    const boardContainerRect = PlaitBoard.getBoardContainer(board).getBoundingClientRect();
    const focusPoint = [boardContainerRect.width / 4, boardContainerRect.height / 2 - 20];
    const zoom = board.viewport.zoom;
    const origination = getViewportOrigination(board);
    const focusX = origination![0] + focusPoint[0] / zoom;
    const focusY = origination![1] + focusPoint[1] / zoom;
    const elements = value;
    board.insertFragment(
      {
        elements: JSON.parse(JSON.stringify(elements)),
      },
      [focusX, focusY],
      WritableClipboardOperationType.paste
    );
    setAppState({ ...appState, openDialogType: null });
  };

  return (
    <>
      <div className="ttd-dialog-desc">{t('dialog.markdown.description')}</div>
      <div className="ttd-dialog-importbar">
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.markdown,.txt,.xmind"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void importFile(file);
            }
          }}
        />
        <button type="button" disabled={importing} onClick={() => fileInputRef.current?.click()}>
          {importing ? t('dialog.markdown.importing') : t('dialog.markdown.importFile')}
        </button>
        <div className="ttd-dialog-templates">
          <span>{t('dialog.markdown.templates')}</span>
          {templates.map((template) => (
            <button
              key={template.key}
              type="button"
              onClick={() => {
                setText(template.markdown);
                setError(null);
              }}
            >
              {template.label}
            </button>
          ))}
        </div>
      </div>
      <TTDDialogPanels>
        <TTDDialogPanel label={t('dialog.markdown.syntax')}>
          <TTDDialogInput
            input={text}
            placeholder={t('dialog.markdown.placeholder')}
            onChange={(event) => setText(event.target.value)}
            onKeyboardSubmit={() => {
              insertToBoard();
            }}
          />
        </TTDDialogPanel>
        <TTDDialogPanel
          label={t('dialog.markdown.preview')}
          panelAction={{
            action: () => {
              insertToBoard();
            },
            label: t('dialog.markdown.insert'),
          }}
          renderSubmitShortcut={() => <TTDDialogSubmitShortcut />}
        >
          <TTDDialogOutput value={value} loaded={markdownToDrawnixLib.loaded} error={error} />
        </TTDDialogPanel>
      </TTDDialogPanels>
    </>
  );
};
export default MarkdownToDrawnix;
