import { useEffect, useRef } from 'react';
import './tab-strip.scss';

export type TabView = {
  id: string;
  title: string;
  bound: boolean;
  dirty: boolean;
  active: boolean;
};

type TabStripProps = {
  tabs: TabView[];
  language: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
};

const MindGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="1.5" y="6" width="5" height="4" rx="1.2" fill="currentColor" />
    <rect x="10" y="1.8" width="4.5" height="3.4" rx="1.1" fill="currentColor" opacity="0.75" />
    <rect x="10" y="10.8" width="4.5" height="3.4" rx="1.1" fill="currentColor" opacity="0.75" />
    <path d="M6.5 8h2.2m0 0V3.5h1.3m-1.3 4.5v4.5h1.3" stroke="currentColor" strokeWidth="1.1" />
  </svg>
);

const FileGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M4 1.8h5.2L12.5 5v9.2H4V1.8Z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
    <path d="M9.2 1.8V5h3.3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
);

const PlusGlyph = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const CloseGlyph = () => (
  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const copy = (language: string) =>
  language === 'zh'
    ? {
        newTab: '新建思维导图',
        close: '关闭标签',
        unsaved: '未保存',
        tabs: '画板标签',
        emptyTitle: '开始一张新的思维导图',
        emptySub: '空白画布已就绪。新建后点击画布放置中心主题，再用 Tab / Enter 生长分支。',
        emptyAction: '新建思维导图',
        emptyHint: '或按',
      }
    : {
        newTab: 'New mind map',
        close: 'Close tab',
        unsaved: 'Unsaved',
        tabs: 'Board tabs',
        emptyTitle: 'Start a new mind map',
        emptySub: 'A blank canvas is ready. Click it to place the central topic, then grow branches with Tab / Enter.',
        emptyAction: 'New mind map',
        emptyHint: 'or press',
      };

export const TabStrip = ({ tabs, language, onActivate, onClose, onNew }: TabStripProps) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const t = copy(language);
  const activeId = tabs.find((tab) => tab.active)?.id;

  useEffect(() => {
    const active = scrollerRef.current?.querySelector('[aria-selected="true"]');
    active?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [activeId]);

  return (
    <div className="tab-strip">
      <div className="tab-strip__brand" aria-hidden="true">
        <span className="tab-strip__brand-mark" />
      </div>
      <div className="tab-strip__tabs" ref={scrollerRef} role="tablist" aria-label={t.tabs}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tab"
            aria-selected={tab.active}
            tabIndex={0}
            title={tab.title}
            className={`tab-strip__tab${tab.active ? ' tab-strip__tab--active' : ''}`}
            onClick={() => onActivate(tab.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onActivate(tab.id);
              }
            }}
            onMouseDown={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                onClose(tab.id);
              }
            }}
          >
            <span className="tab-strip__tab-icon">{tab.bound ? <FileGlyph /> : <MindGlyph />}</span>
            <span className="tab-strip__tab-title">{tab.title}</span>
            {tab.dirty && <span className="tab-strip__dot" title={t.unsaved} aria-label={t.unsaved} />}
            <button
              type="button"
              className="tab-strip__close"
              aria-label={`${t.close} ${tab.title}`}
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.id);
              }}
            >
              <CloseGlyph />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="tab-strip__new" onClick={onNew}>
        <PlusGlyph />
        <span>{t.newTab}</span>
        <kbd>Ctrl+T</kbd>
      </button>
    </div>
  );
};

export const DiscardDialog = ({
  title,
  language,
  onCancel,
  onConfirm,
}: {
  title: string;
  language: string;
  onCancel: () => void;
  onConfirm: () => void;
}) => {
  const zh = language === 'zh';
  return (
    <div className="discard-dialog__scrim" role="presentation" onMouseDown={onCancel}>
      <div
        className="discard-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={zh ? '关闭未保存的标签' : 'Close unsaved tab'}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="discard-dialog__mark" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 2.2 14.4 13H1.6L8 2.2Z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
            <path d="M8 6.4v3.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <circle cx="8" cy="11.4" r="0.8" fill="currentColor" />
          </svg>
        </div>
        <h2 className="discard-dialog__title">
          {zh ? `「${title}」尚未保存到文件` : `"${title}" is not saved to a file`}
        </h2>
        <p className="discard-dialog__body">
          {zh
            ? '关闭后这张画布的内容将丢失。你可以先取消，再用「另存为」把它保存为 .drawnix 文件。'
            : 'Closing discards this canvas. Cancel first and use "Save As" to keep it as a .drawnix file.'}
        </p>
        <div className="discard-dialog__actions">
          <button type="button" className="discard-dialog__cancel" autoFocus onClick={onCancel}>
            {zh ? '取消' : 'Cancel'}
          </button>
          <button type="button" className="discard-dialog__confirm" onClick={onConfirm}>
            {zh ? '丢弃并关闭' : 'Discard & close'}
          </button>
        </div>
      </div>
    </div>
  );
};

export const EmptyWorkspace = ({ language, onNew }: { language: string; onNew: () => void }) => {
  const t = copy(language);
  return (
    <div className="workspace__empty">
      <div className="workspace__empty-mark">
        <svg width="34" height="34" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="1.5" y="6" width="5" height="4" rx="1.2" fill="currentColor" />
          <rect x="10" y="1.8" width="4.5" height="3.4" rx="1.1" fill="currentColor" opacity="0.75" />
          <rect x="10" y="10.8" width="4.5" height="3.4" rx="1.1" fill="currentColor" opacity="0.75" />
          <path d="M6.5 8h2.2m0 0V3.5h1.3m-1.3 4.5v4.5h1.3" stroke="currentColor" strokeWidth="1.1" />
        </svg>
      </div>
      <h1 className="workspace__empty-title">{t.emptyTitle}</h1>
      <p className="workspace__empty-sub">{t.emptySub}</p>
      <button type="button" className="workspace__empty-action" onClick={onNew}>
        <PlusGlyph />
        {t.emptyAction}
      </button>
      <span className="workspace__empty-hint">
        {t.emptyHint} <kbd>Ctrl</kbd> + <kbd>T</kbd>
      </span>
    </div>
  );
};