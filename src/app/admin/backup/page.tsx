"use client";

import { useState, useEffect, useRef } from 'react';
import { useI18n, type T } from '@/lib/i18n/provider';
import {
  Database, Download, Upload, FileText, Clock, CheckCircle, AlertTriangle,
  Folder, File, Trash2, RefreshCw, PlayCircle, HardDrive, X,
} from 'lucide-react';
import clsx from 'clsx';

type OpType =
  | 'export_full'
  | 'export_data_only'
  | 'export_analytics'
  | 'import_with_dedup'
  | 'import_clean'
  | 'create_basic_dump';

type OpStatus = 'pending' | 'running' | 'success' | 'error' | 'canceled';

// Абсолютный путь на диске сервера API больше не отдаёт — работаем по имени.
interface BackupFile {
  name: string;
  size: number;
  modified: number;
}

interface BackupOperation {
  id: string;
  type: OpType;
  status: OpStatus;
  logs: string[];
  startedAt: number;
  completedAt?: number;
  /** Дамп, который создала операция экспорта. */
  file?: string;
}

const DOWNLOAD_URL = (name: string) => `/api/admin/backup/download?file=${encodeURIComponent(name)}`;

/** Скачать файл на машину пользователя.
 *
 * Экспорт делает дамп на сервере (pg_dump живёт там), но нужен он человеку
 * на своём диске — поэтому по готовности сразу отдаём файл браузеру, а не
 * оставляем «где-то в контейнере». */
function downloadToBrowser(name: string) {
  const a = document.createElement('a');
  a.href = DOWNLOAD_URL(name);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const OP_TITLE_KEY: Record<OpType, string> = {
  export_full: 'admin.backup.exportFull.title',
  export_data_only: 'admin.backup.exportData.title',
  export_analytics: 'admin.backup.exportAnalytics.title',
  import_with_dedup: 'admin.backup.importDedup.title',
  import_clean: 'admin.backup.importClean.title',
  create_basic_dump: 'admin.backup.basicDump.title',
};

const OP_DESC_KEY: Record<OpType, string> = {
  export_full: 'admin.backup.exportFull.desc',
  export_data_only: 'admin.backup.exportData.desc',
  export_analytics: 'admin.backup.exportAnalytics.desc',
  import_with_dedup: 'admin.backup.importDedup.desc',
  import_clean: 'admin.backup.importClean.desc',
  create_basic_dump: 'admin.backup.basicDump.desc',
};

const OP_ICONS: Record<OpType, typeof Database> = {
  export_full: Download,
  export_data_only: Upload,
  export_analytics: FileText,
  import_with_dedup: PlayCircle,
  import_clean: Trash2,
  create_basic_dump: HardDrive,
};

// Компонент вынесен из страницы: объявленный внутри, он пересоздавался бы на
// каждый рендер (и React считал бы его каждый раз новым типом). Перевод
// приходит пропсом — хука внутри уже не будет.
function BackupCard(props: {
  type: OpType;
  onClick: () => void;
  tone: string;
  disabled?: boolean;
  t: T;
}) {
  const Icon = OP_ICONS[props.type];
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      className={clsx(
        'card p-5 text-left hover:scale-[1.02] transition-all duration-200',
        props.tone,
        props.disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <div className='flex items-start gap-4'>
        <Icon size={22} className='mt-0.5' />
        <div className='flex-1'>
          <div className='font-semibold'>{props.t(OP_TITLE_KEY[props.type])}</div>
          <div className='mt-1 text-sm text-muted'>{props.t(OP_DESC_KEY[props.type])}</div>
        </div>
      </div>
    </button>
  );
}

export default function AdminBackupPage() {
  const { t } = useI18n();
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [operations, setOperations] = useState<BackupOperation[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  // У полоски состояния три вида, а не два: раньше «не success» рисовалось
  // крутящимся спиннером — упавшая или потерянная операция выглядела как
  // вечно идущая.
  const [progress, setProgress] = useState<{ text: string; state: 'running' | 'success' | 'error' } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const polls = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  async function fetchFiles() {
    setFilesLoading(true);
    try {
      const res = await fetch('/api/admin/backup?action=list');
      const data = await res.json();
      setFiles(data.files || []);
    } catch (e) {
      console.error('fetch files failed', e);
    } finally {
      setFilesLoading(false);
    }
  }

  // Журнал живёт на сервере (в памяти процесса), поэтому после перезагрузки
  // вкладки его можно вернуть — иначе идущая прямо сейчас операция пропадала
  // из интерфейса вместе с обновлением страницы.
  async function fetchOperations() {
    try {
      const res = await fetch('/api/admin/backup?action=operations');
      if (!res.ok) return;
      const data = await res.json();
      const list: BackupOperation[] = (data.operations ?? [])
        .filter((op: { action?: string }) => op.action && op.action in OP_TITLE_KEY)
        .map((op: { id: string; action: OpType; status: OpStatus; logs?: string[]; startedAt: number; completedAt?: number; file?: string }) => ({
          id: op.id,
          type: op.action,
          status: op.status,
          logs: op.logs ?? [],
          startedAt: op.startedAt,
          completedAt: op.completedAt,
          file: op.file,
        }))
        .reverse();
      setOperations(list);
      // Операция, начатая до перезагрузки страницы, всё ещё идёт на сервере —
      // подхватываем её опрос, иначе строка журнала навсегда осталась бы в
      // состоянии «выполняется».
      for (const op of list) {
        if (op.status === 'running' || op.status === 'pending') {
          setBusy(true);
          pollOperation(op.id, op.type);
        }
      }
    } catch {
      // журнал — не критичная часть страницы
    }
  }

  useEffect(() => {
    fetchFiles();
    fetchOperations();
    return () => {
      Object.values(polls.current).forEach(clearInterval);
    };
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [operations]);


  // Опрос статуса операции. Вынесен из startOperation, потому что нужен и
  // журналу: после перезагрузки страницы восстановленная операция может всё
  // ещё идти, и её тоже надо доводить до конца.
  function pollOperation(operationId: string, type: OpType) {
    clearInterval(polls.current[operationId]);
    const stop = () => {
      clearInterval(polls.current[operationId]);
      delete polls.current[operationId];
      setBusy(false);
    };

    polls.current[operationId] = setInterval(async () => {
      let statusData: {
        status?: OpStatus;
        logs?: string[];
        file?: string;
      } | null = null;
      try {
        const statusRes = await fetch(`/api/admin/backup?operationId=${operationId}`);
        // 404 — операцию потеряли: процесс приложения перезапустился, а
        // журнал живёт в его памяти. Раньше в этом месте прилетал ответ без
        // status, и страница вечно крутила «Выполняется • undefined», хотя
        // сама операция давно закончилась.
        if (statusRes.ok) statusData = await statusRes.json();
      } catch {
        // сеть моргнула — попробуем на следующем тике
        return;
      }

      if (!statusData?.status) {
        stop();
        setOperations((prev) => prev.map((op) =>
          op.id === operationId && (op.status === 'running' || op.status === 'pending')
            ? { ...op, status: 'error', logs: [...op.logs, t('admin.backup.lost')] }
            : op,
        ));
        setProgress({ text: t('admin.backup.lost'), state: 'error' });
        fetchFiles();
        return;
      }

      const { status, logs, file: producedFile } = statusData;
      setOperations((prev) => prev.map((op) =>
        op.id === operationId
          ? { ...op, logs: logs ?? op.logs, status, file: producedFile ?? op.file }
          : op,
      ));

      if (status === 'success' || status === 'error') {
        stop();
        if (status === 'success') {
          fetchFiles();
          // Экспорт закончился — сразу кладём дамп на диск пользователя.
          if (producedFile) downloadToBrowser(producedFile);
        }
        setProgress(status === 'success'
          ? { text: t('admin.backup.success'), state: 'success' }
          : { text: t('admin.backup.error'), state: 'error' });
      } else {
        setProgress({ text: `${t('admin.backup.inProgress')} • ${t(OP_TITLE_KEY[type])}`, state: 'running' });
      }
    }, 1500);
  }

  async function startOperation(type: OpType, file?: string) {
    if (busy) return;
    setBusy(true);
    setProgress({ text: `${t('admin.backup.starting')} ${t(OP_TITLE_KEY[type])}…`, state: 'running' });

    try {
      const response = await fetch('/api/admin/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: type, file }),
      });
      const data = await response.json();
      if (data.operationId) {
        const op: BackupOperation = {
          id: data.operationId,
          type,
          status: 'running',
          logs: [],
          startedAt: Date.now(),
        };
        setOperations([...operations, op]);
        setProgress({ text: `${t('admin.backup.starting')} ${t(OP_TITLE_KEY[type])}…`, state: 'running' });

        pollOperation(data.operationId, type);
      } else {
        setProgress({ text: `${t('admin.backup.error')}: ${data.error || t('admin.backup.unknown')}`, state: 'error' });
        setBusy(false);
      }
    } catch (e) {
      setProgress({ text: `${t('admin.backup.errorStart')}: ${(e as Error).message}`, state: 'error' });
      setBusy(false);
    }
  }

  async function clearAllFiles() {
    if (!confirm(t('admin.backup.clearAllConfirm'))) return;

    try {
      const res = await fetch('/api/admin/backup', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear-all' }),
      });
      const data = await res.json();
      if (res.ok) {
        fetchFiles();
      } else {
        alert(`${t('admin.backup.errorClearAll')}: ${data.error}`);
      }
    } catch (e) {
      alert(`${t('admin.backup.errorClearAll')}: ${(e as Error).message}`);
    }
  }

  async function deleteFile(name: string) {
    if (!confirm(t('admin.backup.deleteConfirm', { name }))) return;

    try {
      const res = await fetch(`/api/admin/backup?file=${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok) {
        if (selectedFile === name) setSelectedFile(null);
        fetchFiles();
      } else {
        alert(`${t('admin.backup.errorDelete')}: ${data.error}`);
      }
    } catch (e) {
      alert(`${t('admin.backup.errorDelete')}: ${(e as Error).message}`);
    }
  }

  async function clearAllLogs() {
    if (!confirm(t('admin.backup.clearLogsConfirm'))) return;
    try {
      const res = await fetch('/api/admin/backup', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear-logs' }),
      });
      const data = await res.json();
      if (res.ok) {
        setOperations([]);
      } else {
        alert(`${t('admin.backup.errorClearLogs')}: ${data.error}`);
      }
    } catch (e) {
      alert(`${t('admin.backup.errorClearLogs')}: ${(e as Error).message}`);
    }
  }

  async function uploadToServer() {
    if (!uploadFile) return;
    const fd = new FormData();
    fd.append('file', uploadFile);
    setBusy(true);
    try {
      const res = await fetch('/api/admin/backup/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (res.ok) {
        setUploadFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        fetchFiles();
      } else {
        alert(`${t('admin.backup.errorUpload')}: ${data.error}`);
      }
    } catch (e) {
      alert(`${t('admin.backup.errorUpload')}: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function statusBadge(status: OpStatus) {
    const cls =
      status === 'running' ? 'bg-accent/20 text-accent'
      : status === 'success' ? 'bg-profit/20 text-profit'
      : status === 'error' ? 'bg-loss/20 text-loss'
      : status === 'canceled' ? 'bg-muted/20 text-muted'
      : 'bg-surface-2 text-muted';
    return (
      <span className={clsx('text-xs px-2 py-1 rounded-full', cls)}>{status}</span>
    );
  }


  return (
    <div className='p-6 md:p-8 max-w-6xl'>
      <div className='flex items-center justify-between gap-4'>
        <div>
          <h1 className='text-2xl font-semibold tracking-tight'>{t('admin.backup.title')}</h1>
          <p className='mt-1 text-sm text-muted'>{t('admin.backup.subtitle')}</p>
        </div>
        <button
          onClick={fetchFiles}
          disabled={filesLoading}
          className='inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-2 hover:bg-surface-3 transition-colors text-sm'
        >
          <RefreshCw size={16} className={clsx(filesLoading && 'animate-spin')} />
          {t('admin.backup.refresh')}
        </button>
      </div>

      {progress && (
        <div
          className={clsx(
            'mt-4 card p-3 text-sm flex items-center gap-2',
            progress.state === 'success' && 'border-profit/30 bg-profit/5',
            progress.state === 'error' && 'border-loss/40 bg-loss/5',
            progress.state === 'running' && 'border-accent/30 bg-accent/5',
          )}
        >
          {progress.state === 'success' && <CheckCircle size={16} className='text-profit' />}
          {progress.state === 'error' && <AlertTriangle size={16} className='text-loss' />}
          {progress.state === 'running' && <RefreshCw size={16} className='animate-spin text-accent' />}
          <span>{progress.text}</span>
          {progress.state !== 'running' && (
            <button
              className='ml-auto hover:bg-bg-muted p-1 rounded text-muted'
              onClick={() => setProgress(null)}
              aria-label='close'
            >
              <X size={15} />
            </button>
          )}
        </div>
      )}

      <h2 className='mt-8 text-lg font-semibold'>{t('admin.backup.exportSection')}</h2>
      <div className='mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
        <BackupCard
          t={t}
          type='export_full'
          onClick={() => startOperation('export_full')}
          tone='border-accent/30 bg-accent/5 hover:border-accent/50'
          disabled={busy}
        />
        <BackupCard
          t={t}
          type='export_data_only'
          onClick={() => startOperation('export_data_only')}
          tone='border-profit/30 bg-profit/5 hover:border-profit/50'
          disabled={busy}
        />
        <BackupCard
          t={t}
          type='export_analytics'
          onClick={() => startOperation('export_analytics')}
          tone='border-info/30 bg-info/5 hover:border-info/50'
          disabled={busy}
        />
      </div>

      <h2 className='mt-8 text-lg font-semibold'>{t('admin.backup.importSection')}</h2>
      <div className='mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
        <BackupCard
          t={t}
          type='import_with_dedup'
          onClick={() => {
            const f = selectedFile || files[0]?.name;
            if (!f) { alert(t('admin.backup.pickFirst')); return; }
            startOperation('import_with_dedup', f);
          }}
          tone='border-warning/30 bg-warning/5 hover:border-warning/50'
          disabled={busy}
        />
        <BackupCard
          t={t}
          type='import_clean'
          onClick={() => {
            const f = selectedFile || files[0]?.name;
            if (!f) { alert(t('admin.backup.pickFirst')); return; }
            if (!confirm(t('admin.backup.replaceConfirm'))) return;
            startOperation('import_clean', f);
          }}
          tone='border-loss/30 bg-loss/5 hover:border-loss/50'
          disabled={busy}
        />
        <BackupCard
          t={t}
          type='create_basic_dump'
          onClick={() => startOperation('create_basic_dump')}
          tone='border-info/30 bg-info/5 hover:border-info/50'
          disabled={busy}
        />
      </div>

      <div className='mt-8 grid gap-6 lg:grid-cols-2'>
        <div>
          <h2 className='text-lg font-semibold flex items-center gap-2'>
            <Folder size={18} /> {t('admin.backup.files')}
          </h2>

          <div className='mt-3 card p-4'>
            <div className='border-2 border-dashed border-border rounded-lg p-4 text-center hover:border-accent/40 transition-colors'>
              <input
                ref={fileInputRef}
                type='file'
                accept='.sql,.jsonl'
                className='hidden'
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              />
              <button
                type='button'
                onClick={() => fileInputRef.current?.click()}
                className='flex flex-col items-center gap-2 w-full'
              >
                <Upload size={28} className='text-muted' />
                <span className='text-sm font-medium'>{t('admin.backup.uploadHint')}</span>
                <span className='text-xs text-muted'>.sql / .jsonl</span>
              </button>
            </div>

            {uploadFile && (
              <div className='mt-3 flex items-center justify-between p-3 bg-surface-2 rounded-lg'>
                <div className='flex items-center gap-2 min-w-0'>
                  <File size={16} />
                  <span className='text-sm truncate'>{uploadFile.name}</span>
                  <span className='text-xs text-muted'>({formatFileSize(uploadFile.size)})</span>
                </div>
                <button
                  onClick={uploadToServer}
                  disabled={busy}
                  className='px-3 py-1 bg-accent text-white rounded text-sm hover:bg-accent/90 disabled:opacity-50'
                >
                  {t('admin.backup.upload')}
                </button>
              </div>
            )}

            <div className='mt-5'>
              <div className='flex justify-between items-center mb-3'>
                <h3 className='text-sm font-medium'>{t('admin.backup.availableFiles')}</h3>
                <button
                  onClick={clearAllFiles}
                  disabled={filesLoading}
                  className='px-3 py-1 bg-loss/10 text-loss hover:bg-loss/20 rounded text-sm transition'
                >
                  {t('admin.backup.clearAll')}
                </button>
              </div>
              {filesLoading ? (
                <div className='flex justify-center py-6'>
                  <RefreshCw size={20} className='animate-spin text-muted' />
                </div>
              ) : files.length === 0 ? (
                <div className='text-center py-6 text-muted'>
                  <File size={28} className='mx-auto mb-2 opacity-50' />
                  <p className='text-sm'>{t('admin.backup.noFiles')}</p>
                </div>
              ) : (
                <div className='space-y-2 max-h-72 overflow-y-auto'>
                  {files.map((f) => (
                    <div
                      key={f.name}
                      onClick={() => setSelectedFile(f.name)}
                      className={clsx(
                        'flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors',
                        selectedFile === f.name
                          ? 'bg-accent/15 border border-accent/30'
                          : 'bg-surface-2 hover:bg-surface-3',
                      )}
                    >
                      <div className='flex items-center gap-3 min-w-0'>
                        <FileText size={16} className='text-muted shrink-0' />
                        <div className='min-w-0'>
                          <div className='text-sm font-medium truncate'>{f.name}</div>
                          <div className='text-xs text-muted'>
                            {formatFileSize(f.size)} · {formatDateTime(f.modified)}
                          </div>
                        </div>
                      </div>
                      <div className='flex items-center gap-1 shrink-0'>
                        {/* Ссылка, а не fetch: браузер сам качает поток и
                            показывает прогресс — дамп бывает на сотни МБ. */}
                        <a
                          href={DOWNLOAD_URL(f.name)}
                          onClick={(e) => e.stopPropagation()}
                          download={f.name}
                          className='p-1 text-muted hover:text-fg hover:bg-bg-muted rounded'
                          title={t('admin.backup.download')}
                        >
                          <Download size={14} />
                        </a>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteFile(f.name); }}
                          className='p-1 text-loss hover:bg-loss/10 rounded'
                          title={t('admin.backup.deleteFile')}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {selectedFile && (
              <div className='mt-3 p-2 bg-accent/10 border border-accent/30 rounded-lg text-sm'>
                {t('admin.backup.chosen')} <span className='font-medium'>{selectedFile}</span>
              </div>
            )}
          </div>
        </div>

        <div>
          <h2 className='text-lg font-semibold flex items-center gap-2'>
            <Clock size={18} /> {t('admin.backup.operationsLog')}
            {operations.length > 0 && (
              <button
                onClick={clearAllLogs}
                disabled={filesLoading}
                className='ml-auto px-3 py-1 bg-loss/10 text-loss hover:bg-loss/20 rounded text-sm transition'
              >
                {t('admin.backup.clearLogs')}
              </button>
            )}
          </h2>
          <div className='mt-3 card p-4'>
            {operations.length === 0 ? (
              <div className='text-center py-6 text-muted'>
                <Clock size={28} className='mx-auto mb-2 opacity-50' />
                <p className='text-sm'>{t('admin.backup.noOperations')}</p>
              </div>
            ) : (
              <div ref={logRef} className='space-y-3 max-h-96 overflow-y-auto'>
                {operations.map((op) => {
                  const Icon = OP_ICONS[op.type];
                  return (
                    <div key={op.id} className='border rounded-lg p-3'>
                      <div className='flex items-center justify-between mb-2 gap-2'>
                        <div className='flex items-center gap-2 min-w-0'>
                          <Icon size={16} className='shrink-0' />
                          <span className='text-sm font-medium truncate'>{t(OP_TITLE_KEY[op.type])}</span>
                          <span className='text-xs text-muted shrink-0'>
                            {formatDateTime(op.startedAt)}
                          </span>
                        </div>
                        <div className='flex items-center gap-2 shrink-0'>
                          {op.status === 'running' && (
                            <RefreshCw size={14} className='animate-spin text-accent' />
                          )}
                          {op.status === 'success' && <CheckCircle size={14} className='text-profit' />}
                          {op.status === 'error' && <AlertTriangle size={14} className='text-loss' />}
                          {statusBadge(op.status)}
                        </div>
                      </div>
                      <div className='space-y-0.5 max-h-40 overflow-y-auto font-mono text-xs text-muted'>
                        {op.logs.length === 0 ? (
                          <div className='opacity-60'>{t('admin.backup.waitingLogs')}</div>
                        ) : (
                          op.logs.slice(-50).map((line, i) => (
                            <div key={i} className='whitespace-pre-wrap break-all'>{line}</div>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}