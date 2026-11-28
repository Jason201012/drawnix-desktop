import type {
  BoardVersionInfo,
  RecentMapInfo,
  StorageStats,
  StorageCleanupInfo,
} from '@drawnix/drawnix';
import { uiCopy } from './i18n';
import type { VersionDiff } from './version-diff';

const formatTime = (ms: number, language: string) => {
  if (!ms) {
    return '';
  }
  const locale =
    language === 'zh'
      ? 'zh-CN'
      : language === 'ar'
        ? 'ar'
        : language === 'ru'
          ? 'ru'
          : language === 'vi'
            ? 'vi'
            : 'en';
  return new Date(ms).toLocaleString(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
};

export type VersionPreview = { nodes: number; texts: string[] };

const DiffList = ({ diff, t }: { diff: VersionDiff; t: ReturnType<typeof uiCopy> }) => {
  const groups = [
    { key: 'added', title: t.added(diff.added.length), nodes: diff.added },
    { key: 'removed', title: t.removed(diff.removed.length), nodes: diff.removed },
    { key: 'changed', title: t.changed(diff.changed.length), nodes: diff.changed },
  ];
  if (groups.every((group) => group.nodes.length === 0)) {
    return <p className="history-drawer__empty">{t.noChanges}</p>;
  }
  return (
    <div className="history-drawer__diff">
      {groups.map((group) => (
        <div
          key={group.key}
          className={`history-drawer__diff-group history-drawer__diff-group--${group.key}`}
        >
          <h3>{group.title}</h3>
          {group.nodes.length === 0 ? (
            <p className="history-drawer__empty">—</p>
          ) : (
            <ul>
              {group.nodes.slice(0, 20).map((node) => (
                <li key={node.id}>{node.text || node.id}</li>
              ))}
              {group.nodes.length > 20 && <li>{t.more(group.nodes.length - 20)}</li>}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
};

export const HistoryDrawer = ({
  language,
  versions,
  loading,
  previews,
  compareSelection,
  diff,
  diffLoading,
  onClose,
  onPreview,
  onRestore,
  onDelete,
  onToggleCompare,
  onClearCompare,
}: {
  language: string;
  versions: BoardVersionInfo[];
  loading: boolean;
  previews: Record<number, VersionPreview>;
  compareSelection: number[];
  diff: VersionDiff | null;
  diffLoading: boolean;
  onClose: () => void;
  onPreview: (version: number) => void;
  onRestore: (version: number) => void;
  onDelete: (version: number) => void;
  onToggleCompare: (version: number) => void;
  onClearCompare: () => void;
}) => {
  const t = uiCopy(language);
  return (
    <aside className="history-drawer" aria-label={t.history}>
      <div className="history-drawer__head">
        <h2 className="history-drawer__title">{t.history}</h2>
        <button
          type="button"
          className="history-drawer__close"
          onClick={onClose}
          aria-label={t.dismiss}
        >
          ×
        </button>
      </div>
      {compareSelection.length > 0 && (
        <div className="history-drawer__compare">
          <div className="history-drawer__compare-head">
            <strong>{t.compareVersions}</strong>
            <span>{[...compareSelection].sort((a, b) => a - b).join(' ↔ ')}</span>
            <button type="button" onClick={onClearCompare}>
              {t.clearCompare}
            </button>
          </div>
          {diffLoading && <p className="history-drawer__empty">…</p>}
          {!diffLoading && compareSelection.length === 2 && diff && <DiffList diff={diff} t={t} />}
          {!diffLoading && compareSelection.length === 1 && (
            <p className="history-drawer__empty">{t.compareHint}</p>
          )}
        </div>
      )}
      <div className="history-drawer__list">
        {loading && <p className="history-drawer__empty">…</p>}
        {!loading && versions.length === 0 && (
          <p className="history-drawer__empty">{t.historyEmpty}</p>
        )}
        {!loading &&
          versions.map((item, index) => (
            <div key={item.version} className="history-drawer__item">
              <div className="history-drawer__row">
                <span className="history-drawer__version">
                  {item.version}
                  {index === 0 && <em className="history-drawer__latest">{t.latest}</em>}
                </span>
                <span className="history-drawer__meta">
                  {formatTime(item.modified_ms, language)} · {formatSize(item.size)}
                </span>
              </div>
              <div className="history-drawer__actions">
                <button type="button" onClick={() => onPreview(item.version)}>
                  {t.preview}
                </button>
                <button type="button" onClick={() => onRestore(item.version)}>
                  {t.restore}
                </button>
                <button
                  type="button"
                  className={compareSelection.includes(item.version) ? 'is-selected' : undefined}
                  aria-pressed={compareSelection.includes(item.version)}
                  onClick={() => onToggleCompare(item.version)}
                >
                  {t.compare}
                </button>
                <button
                  type="button"
                  className="history-drawer__delete"
                  disabled={index === 0}
                  onClick={() => onDelete(item.version)}
                >
                  {t.delete}
                </button>
              </div>
              {previews[item.version] && (
                <p className="history-drawer__preview">
                  {t.nodes(previews[item.version].nodes)}
                  {previews[item.version].texts.length > 0 &&
                    ` · ${previews[item.version].texts.join(' / ')}`}
                </p>
              )}
            </div>
          ))}
      </div>
    </aside>
  );
};

export const ConfirmDialog = ({
  title,
  body,
  cancel,
  confirm,
  danger,
  busy = false,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  cancel: string;
  confirm: string;
  danger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) => (
  <div className="discard-dialog__scrim" role="presentation" onMouseDown={onCancel}>
    <div
      className="discard-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <h2 className="discard-dialog__title">{title}</h2>
      <p className="discard-dialog__body">{body}</p>
      <div className="discard-dialog__actions">
        <button
          type="button"
          className="discard-dialog__cancel"
          autoFocus
          disabled={busy}
          onClick={onCancel}
        >
          {cancel}
        </button>
        <button
          type="button"
          className={danger ? 'discard-dialog__confirm' : 'discard-dialog__restore'}
          disabled={busy}
          onClick={onConfirm}
        >
          {confirm}
        </button>
      </div>
    </div>
  </div>
);

export const HomePanel = ({
  language,
  maps,
  loading,
  embedded,
  openFileEnabled,
  storageStats,
  keepLatest,
  cleanupPreviewLoading,
  cleanupResult,
  onNew,
  onOpenFile,
  onOpenMap,
  onKeepLatestChange,
  onPreviewCleanup,
  onClose,
}: {
  language: string;
  maps: RecentMapInfo[];
  loading: boolean;
  embedded: boolean;
  openFileEnabled: boolean;
  storageStats: StorageStats | null;
  keepLatest: number;
  cleanupPreviewLoading: boolean;
  cleanupResult: StorageCleanupInfo | null;
  onNew: () => void;
  onOpenFile: () => void;
  onOpenMap: (folderPath: string) => void;
  onKeepLatestChange: (value: number) => void;
  onPreviewCleanup: () => void;
  onClose: () => void;
}) => {
  const t = uiCopy(language);
  return (
    <div className={`home-panel${embedded ? ' home-panel--embedded' : ''}`}>
      {!embedded && (
        <button
          type="button"
          className="home-panel__close"
          onClick={onClose}
          aria-label={t.dismiss}
        >
          ×
        </button>
      )}
      <div className="home-panel__hero">
        <h1 className="home-panel__title">{t.emptyTitle}</h1>
        <p className="home-panel__sub">{t.emptySub}</p>
        <div className="home-panel__actions">
          <button type="button" className="workspace__empty-action" onClick={onNew}>
            {t.emptyAction}
          </button>
          {openFileEnabled && (
            <button type="button" className="home-panel__open" onClick={onOpenFile}>
              {t.openFile}
            </button>
          )}
        </div>
      </div>
      <div className="home-panel__recent">
        <h2 className="home-panel__recent-title">{t.recentMaps}</h2>
        {loading && <p className="home-panel__empty">…</p>}
        {!loading && maps.length === 0 && <p className="home-panel__empty">{t.noRecents}</p>}
        {!loading &&
          maps.map((map) => (
            <button
              key={map.folder_path}
              type="button"
              className="home-panel__map"
              onClick={() => onOpenMap(map.folder_path)}
            >
              <span className="home-panel__map-name">{map.name}</span>
              <span className="home-panel__map-meta">
                {t.versions(map.version_count)} · {formatTime(map.modified_ms, language)}
              </span>
            </button>
          ))}
      </div>
      {openFileEnabled && (
        <div className="home-panel__storage">
          <h2 className="home-panel__recent-title">{t.storage}</h2>
          <p className="home-panel__empty">
            {storageStats
              ? t.storageUsage(
                  storageStats.map_count,
                  storageStats.version_count,
                  formatSize(storageStats.total_bytes)
                )
              : '…'}
          </p>
          <div className="home-panel__storage-actions">
            <label className="home-panel__keep">
              {t.keepLatest}
              <input
                type="number"
                min={1}
                max={999}
                value={keepLatest}
                onChange={(event) => onKeepLatestChange(Number(event.target.value))}
              />
            </label>
            <button
              type="button"
              className="home-panel__cleanup"
              disabled={cleanupPreviewLoading}
              onClick={onPreviewCleanup}
            >
              {cleanupPreviewLoading ? '…' : t.cleanupOldVersions}
            </button>
          </div>
          {cleanupResult && (
            <p className="home-panel__empty">
              {t.cleanupResult(cleanupResult.version_count, formatSize(cleanupResult.freed_bytes))}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
