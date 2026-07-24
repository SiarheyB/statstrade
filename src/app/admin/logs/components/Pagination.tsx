import React from 'react';

interface PaginationProps {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
}

export const Pagination: React.FC<PaginationProps> = ({
  page,
  limit,
  total,
  onPageChange,
  onLimitChange,
}) => {
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // Generate page numbers array (max 7 pages)
  const getPageNumbers = () => {
    const pages = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 4) pages.push('...');
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
        pages.push(i);
      }
      if (page < totalPages - 2) pages.push('...');
      if (totalPages > 1) pages.push(totalPages);
    }
    return pages;
  };

  return (
    <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mt-6 border-t border-border pt-4">
      {/* Pages */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted">Страница:</span>
        {getPageNumbers().map((pageNum, index) =>
          typeof pageNum === 'number' ? (
            <button
              key={pageNum}
              onClick={() => onPageChange(pageNum)}
              className={`w-8 h-8 rounded text-sm font-medium transition-colors ${
                page === pageNum
                  ? 'bg-accent text-white'
                  : 'bg-surface-2 text-muted hover:bg-surface-2/70'
              }`}
            >
              {pageNum}
            </button>
          ) : (
            <span key={`ellipsis-${index}`} className="px-2 text-faint">
              ...
            </span>
          )
        )}
      </div>

      {/* Limit */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted">На страницу:</span>
        <select
          value={limit}
          onChange={(e) => onLimitChange(Number(e.target.value))}
          className="input-base"
        >
          {[10, 20, 50, 100].map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      {/* Total */}
      <div className="text-sm text-muted">
        Всего записей: {total}
      </div>
    </div>
  );
};