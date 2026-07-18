import { DeleteModal } from './DeleteModal';

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
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
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
    setDeleteIds(Array.from(selectedIds));
    setDeleteModalOpen(true);
  };

  const handleConfirmDelete = () => {
    if (onDelete) {
      onDelete(deleteIds);
    }
    setSelectedIds(new Set());
    setDeleteModalOpen(false);
  };

  if (loading && logs.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        Загрузка логов...
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        Логи не найдены
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between bg-blue-50 p-3 rounded border border-blue-200">
          <span className="text-blue-700">
            Выбрано: {selectedIds.size}
          </span>
          <button
            onClick={handleDelete}
            className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
          >
            Удалить выбранные
          </button>
        </div>
      )}

      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left">
                <input
                  type="checkbox"
                  checked={selectedIds.size === logs.length && logs.length > 0}
                  onChange={toggleSelectAll}
                  className="rounded"
                />
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Время
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Уровень
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Модуль
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Аккаунт
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Событие
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Сообщение
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {logs.map((log) => (
              <tr key={log.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(log.id)}
                    onChange={() => toggleSelect(log.id)}
                    className="rounded"
                  />
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                  {new Date(log.timestamp).toLocaleString('ru-RU')}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span
                    className={`px-2 py-1 text-xs rounded-full ${
                      log.level === 'error'
                        ? 'bg-red-100 text-red-800'
                        : log.level === 'warn'
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-green-100 text-green-800'
                    }`}
                  >
                    {log.level}
                  </span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                  {log.module}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                  {log.accountId || '—'}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                  {log.eventType}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700 max-w-xs truncate">
                  {log.message}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DeleteModal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleConfirmDelete}
        deletingIds={deleteIds}
      />
    </div>
  );
};

// Import useState at the end to avoid react-hooks/rules-of-hooks lint issues
import { useState } from 'react';
