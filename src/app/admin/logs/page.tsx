'use client';

import { LogFilters } from './components/LogFilters';
import { LogTable } from './components/LogTable';
import { Pagination } from './components/Pagination';
import { DeleteModal } from './components/DeleteModal';
import AdminErrors from '@/components/AdminErrors';
import { useState, useEffect, useCallback } from 'react';
import clsx from 'clsx';
import { Trash2 } from 'lucide-react';

type Tab = 'logs' | 'errors';

// Собираем query-string из page/limit/filters, отбрасывая пустые значения.
function buildQuery(page: number, limit: number, filters: Record<string, any>): string {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    if (value instanceof Date) {
      params.set(key, value.toISOString());
    } else {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'logs', label: 'Логи импорта' },
  { key: 'errors', label: 'Логи ошибок' },
];

export default function LogsPage() {
  const [tab, setTab] = useState<Tab>('logs');
  const [logs, setLogs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [filters, setFilters] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [deleteAll, setDeleteAll] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState<boolean>(false);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/logs?${buildQuery(page, limit, filters)}`);
      if (!res.ok) {
        throw new Error(`Ошибка загрузки логов (${res.status})`);
      }
      const result = await res.json();
      setLogs(result.data ?? []);
      setTotal(result.total ?? 0);
    } catch (err: any) {
      setError(err.message || 'Не удалось загрузить логи');
      console.error('Error fetching logs:', err);
    } finally {
      setLoading(false);
    }
  }, [page, limit, filters]);

  useEffect(() => {
    if (tab === 'logs') fetchLogs();
  }, [fetchLogs, tab]);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit);
    setPage(1); // сброс на первую страницу при смене лимита
  };

  const handleFiltersChange = (newFilters: Record<string, any>) => {
    setFilters(newFilters);
    setPage(1); // сброс на первую страницу при смене фильтров
  };

  const handleDelete = (ids: string[]) => {
    setDeleteIds(ids);
    setDeleteAll(false);
    setDeleteError(null);
    setDeleteSuccess(false);
    setDeleteModalOpen(true);
  };

  const handleDeleteAll = () => {
    setDeleteIds([]);
    setDeleteAll(true);
    setDeleteError(null);
    setDeleteSuccess(false);
    setDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    setDeleteError(null);
    setDeleteSuccess(false);
    try {
      const res = await fetch('/api/admin/logs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: deleteAll ? JSON.stringify({ all: true }) : JSON.stringify({ ids: deleteIds }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Ошибка удаления (${res.status})`);
      }
      setDeleteSuccess(true);
      await fetchLogs();
      setDeleteModalOpen(false);
      setDeleteIds([]);
      setDeleteAll(false);
    } catch (err: any) {
      setDeleteError(err.message || 'Не удалось удалить логи');
      console.error('Error deleting logs:', err);
    }
  };

  const handleCancelDelete = () => {
    setDeleteIds([]);
    setDeleteAll(false);
    setDeleteModalOpen(false);
    setDeleteError(null);
    setDeleteSuccess(false);
  };

  return (
    <div className="p-6">
      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              'px-4 py-2.5 text-sm font-medium transition-colors relative',
              tab === t.key
                ? 'text-accent'
                : 'text-muted hover:text-fg',
            )}
          >
            {t.label}
            {tab === t.key && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-full" />
            )}
          </button>
        ))}
      </div>

      {tab === 'logs' ? (
        <>
          {loading && logs.length === 0 && total === 0 ? (
            <p className="text-muted">Загрузка...</p>
          ) : (
            <>
              {error && (
                <div className="bg-red-50 border-l-4 border-red-500 text-red-700 p-4 mb-6">
                  <p>{error}</p>
                </div>
              )}

              <div className="flex items-center justify-between gap-4 mb-4">
                <LogFilters filters={filters} onChange={handleFiltersChange} />
                {total > 0 && (
                  <button
                    onClick={handleDeleteAll}
                    className="shrink-0 px-3 py-2 text-sm font-medium text-loss border border-loss/40 rounded-md hover:bg-loss/10 transition-colors inline-flex items-center gap-1.5"
                  >
                    <Trash2 size={14} />
                    Очистить всё
                  </button>
                )}
              </div>

              <LogTable logs={logs} loading={loading} onDelete={handleDelete} />

              <div className="mt-4 flex justify-between items-center">
                <p className="text-sm text-muted">
                  Показано {logs.length} из {total} записей
                </p>
                <Pagination
                  page={page}
                  limit={limit}
                  total={total}
                  onPageChange={handlePageChange}
                  onLimitChange={handleLimitChange}
                />
              </div>

              <DeleteModal
                open={deleteModalOpen}
                onClose={handleCancelDelete}
                onConfirm={handleConfirmDelete}
                deletingIds={deleteIds}
                deleteAll={deleteAll}
                totalCount={total}
                error={deleteError}
                success={deleteSuccess}
              />
            </>
          )}
        </>
      ) : (
        <AdminErrors />
      )}
    </div>
  );
}