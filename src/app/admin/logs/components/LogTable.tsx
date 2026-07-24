import { useState } from 'react';

interface LogRow {
  id: string;
  module: string;
  accountId: string | null;
  eventType: string;
  message: string;
  details: any;
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
              <tr key={log.id} className="hover:bg-surface-2/50">
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(log.id)}
                    onChange={() => toggleSelect(log.id)}
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
                        ? 'bg-warning/15 text-warning'
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};