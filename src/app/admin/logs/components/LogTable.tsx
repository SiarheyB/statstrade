import React, { useState } from 'react';

export interface LogRow {
  id: string;
  module: string;
  accountId: string | null;
  eventType: string;
  message: string;
  details: unknown;
  level: 'info' | 'warn' | 'error';
  timestamp: Date | string;
  createdAt?: Date | string;
}

export const LogTable: React.FC<{
  logs: LogRow[];
  loading?: boolean;
  onDelete?: (ids: string[]) => void;
}> = ({ logs, loading, onDelete }) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Какая строка раскрыта. Сообщение в таблице обрезано по ширине колонки, а
  // самое важное у ошибок синка — как раз хвост: URL, код и ответ биржи.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === logs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(logs.map((l) => l.id)));
    }
  };

  const handleDelete = () => {
    if (selectedIds.size === 0) return;
    if (onDelete) {
      onDelete(Array.from(selectedIds));
    }
    setSelectedIds(new Set());
  };

  if (loading && logs.length === 0) {
    return (
      <div className="text-center py-8 text-muted">
        Загрузка логов...
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="text-center py-8 text-muted">
        Логи не найдены
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between bg-accent/10 p-3 rounded border border-accent/20">
          <span className="text-accent">
            Выбрано: {selectedIds.size}
          </span>
          <button
            onClick={handleDelete}
            className="px-3 py-1 bg-loss text-white rounded hover:opacity-90 transition-colors"
          >
            Удалить выбранные
          </button>
        </div>
      )}

      <div className="overflow-x-auto border border-border rounded-lg">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-surface-2">
            <tr>
              <th className="px-4 py-3 text-left">
                <input
                  type="checkbox"
                  checked={selectedIds.size === logs.length && logs.length > 0}
                  onChange={toggleSelectAll}
                  className="rounded"
                />
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-faint uppercase tracking-wider">
                Время
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-faint uppercase tracking-wider">
                Уровень
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-faint uppercase tracking-wider">
                Модуль
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-faint uppercase tracking-wider">
                Аккаунт
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-faint uppercase tracking-wider">
                Событие
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-faint uppercase tracking-wider">
                Сообщение
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {logs.map((log) => (
              <React.Fragment key={log.id}>
              <tr
                className="hover:bg-surface-2/50 cursor-pointer"
                onClick={() => setExpandedId((cur) => (cur === log.id ? null : log.id))}
                aria-expanded={expandedId === log.id}
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(log.id)}
                    onChange={() => toggleSelect(log.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded"
                  />
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-fg">
                  {new Date(log.timestamp).toLocaleString('ru-RU')}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span
                    className={`px-2 py-1 text-xs rounded-full ${
                      log.level === 'error'
                        ? 'bg-loss/15 text-loss'
                        : log.level === 'warn'
                        ? 'bg-warn/15 text-warn'
                        : 'bg-profit/15 text-profit'
                    }`}
                  >
                    {log.level}
                  </span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-fg">
                  {log.module}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-muted">
                  {log.accountId || '—'}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-fg">
                  {log.eventType}
                </td>
                <td className="px-4 py-3 text-sm text-muted max-w-xs truncate">
                  {log.message}
                </td>
              </tr>
              {expandedId === log.id && (
                <tr className="bg-surface-2/40">
                  <td colSpan={7} className="px-4 pb-4 pt-0">
                    <div className="rounded-lg border border-border bg-bg p-3">
                      <div className="text-[11px] uppercase tracking-wide text-faint">Полный текст</div>
                      <p className="mt-1 whitespace-pre-wrap break-all font-mono text-xs text-fg">{log.message}</p>
                      {log.details != null && (
                        <>
                          <div className="mt-3 text-[11px] uppercase tracking-wide text-faint">Детали</div>
                          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-muted">
                            {typeof log.details === 'string' ? log.details : JSON.stringify(log.details, null, 2)}
                          </pre>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};