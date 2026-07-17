import { LogFilters } from './components/LogFilters';
import { LogTable } from './components/LogTable';
import { Pagination } from './components/Pagination';
import { DeleteModal } from './components/DeleteModal';
import { useState, useEffect, useCallback } from 'react';
import { LogService } from '@/lib/log.service';

export const dynamic = 'force-dynamic';

export default function LogsPage() {
  const [logs, setLogs] = useState<Array<any>>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [filters, setFilters] = useState<any>({});
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
      const result = await LogService.fetchPage(page, limit, filters);
      setLogs(result.data);
      setTotal(result.total);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch logs');
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
    setPage(1); // reset to first page when changing limit
  };

  const handleFiltersChange = (newFilters: any) => {
    setFilters(newFilters);
    setPage(1); // reset to first page when filters change
  };

  const handleDelete = async (ids: string[]) => {
    setDeleteIds(ids);
    setDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    setDeleteError(null);
    setDeleteSuccess(false);
    try {
      await LogService.deleteMany(deleteIds);
      setDeleteSuccess(true);
      // Refetch logs after deletion
      await fetchLogs();
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete logs');
      console.error('Error deleting logs:', err);
    } finally {
      setDeleteIds([]);
      setDeleteModalOpen(false);
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

      <LogFilters
        filters={filters}
        onChange={handleFiltersChange}
      />

      <LogTable
        logs={logs}
        loading={loading}
        onDelete={handleDelete}
      />

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