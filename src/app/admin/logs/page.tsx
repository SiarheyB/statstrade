'use client';

import { LogFilters } from './components/LogFilters';
import { LogTable } from './components/LogTable';
import { Pagination } from './components/Pagination';
import { DeleteModal } from './components/DeleteModal';
import { useState, useEffect, useCallback } from 'react';

export const dynamic = 'force-dynamic';

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

export default function LogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [filters, setFilters] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
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
    fetchLogs();
  }, [fetchLogs]);

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
        body: JSON.stringify({ ids: deleteIds }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Ошибка удаления (${res.status})`);
      }
      setDeleteSuccess(true);
      await fetchLogs();
      setDeleteModalOpen(false);
      setDeleteIds([]);
    } catch (err: any) {
      setDeleteError(err.message || 'Не удалось удалить логи');
      console.error('Error deleting logs:', err);
    }
  };

  const handleCancelDelete = () => {
    setDeleteIds([]);
    setDeleteModalOpen(false);
    setDeleteError(null);
    setDeleteSuccess(false);
  };

  if (loading && logs.length === 0 && total === 0) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Логи импорта</h1>
        <p className="text-gray-500">Загрузка...</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Логи импорта</h1>

      {error && (
        <div className="bg-red-50 border-l-4 border-red-500 text-red-700 p-4 mb-6">
          <p>{error}</p>
        </div>
      )}

      <LogFilters filters={filters} onChange={handleFiltersChange} />

      <LogTable logs={logs} loading={loading} onDelete={handleDelete} />

      <div className="mt-4 flex justify-between items-center">
        <p className="text-sm text-gray-600">
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
        error={deleteError}
        success={deleteSuccess}
      />
    </div>
  );
}