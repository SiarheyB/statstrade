import { useState } from 'react';
import { LogLevel } from '@/lib/log.service';

export const LogFilters: React.FC<{
  filters: {
    module?: string;
    accountId?: string;
    eventType?: string;
    level?: LogLevel;
    search?: string;
    startDate?: Date;
    endDate?: Date;
  };
  onChange: (newFilters: any) => void;
}> = ({ filters, onChange }) => {
  const [module, setModule] = useState(filters.module || '');
  const [accountId, setAccountId] = useState(filters.accountId || '');
  const [eventType, setEventType] = useState(filters.eventType || '');
  const [level, setLevel] = useState(filters.level || '');
  const [search, setSearch] = useState(filters.search || '');
  const [startDate, setStartDate] = useState(filters.startDate ? new Date(filters.startDate) : null);
  const [endDate, setEndDate] = useState(filters.endDate ? new Date(filters.endDate) : null);

  const handleChange = () => {
    onChange({
      module: module || undefined,
      accountId: accountId || undefined,
      eventType: eventType || undefined,
      level: level || undefined,
      search: search || undefined,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
  };

  return (
    <div className="card space-y-4 p-6">
      <h2 className="text-lg font-semibold mb-2">Фильтры логов</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1 text-muted">Модуль</label>
          <input
            type="text"
            value={module}
            onChange={(e) => setModule(e.target.value)}
            className="input-base w-full"
            placeholder="Например: import"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-muted">ID аккаунта</label>
          <input
            type="text"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="input-base w-full"
            placeholder="Например: acc_123"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-muted">Тип события</label>
          <input
            type="text"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            className="input-base w-full"
            placeholder="Например: FILE_RECEIVED"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:gap-4">
        <div>
          <label className="block text-sm font-medium mb-1 text-muted">Уровень лога</label>
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="input-base w-full"
          >
            <option value="">Все уровни</option>
            <option value="info">Info</option>
            <option value="warn">Warning</option>
            <option value="error">Error</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-muted">Поиск</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-base w-full"
            placeholder="Поиск в сообщениях..."
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:gap-4 pt-4 border-t border-border">
        <div>
          <label className="block text-sm font-medium mb-1 text-muted">Дата с</label>
          <input
            type="date"
            value={startDate ? startDate.toISOString().split('T')[0] : ''}
            onChange={(e) => {
              if (e.target.value) setStartDate(new Date(e.target.value));
              else setStartDate(null);
            }}
            className="input-base w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-muted">Дата по</label>
          <input
            type="date"
            value={endDate ? endDate.toISOString().split('T')[0] : ''}
            onChange={(e) => {
              if (e.target.value) setEndDate(new Date(e.target.value));
              else setEndDate(null);
            }}
            className="input-base w-full"
          />
        </div>
      </div>

      <div className="flex justify-end mt-4 space-x-2">
        <button
          type="button"
          onClick={() => {
            setModule('');
            setAccountId('');
            setEventType('');
            setLevel('');
            setSearch('');
            setStartDate(null);
            setEndDate(null);
            onChange({
              module: undefined,
              accountId: undefined,
              eventType: undefined,
              level: undefined,
              search: undefined,
              startDate: undefined,
              endDate: undefined,
            });
          }}
          className="px-4 py-2 rounded bg-surface-2 text-fg hover:bg-border transition-colors"
        >
          Сбросить
        </button>

        <button
          type="button"
          onClick={handleChange}
          className="px-4 py-2 rounded bg-accent text-white hover:opacity-90 transition-colors"
        >
          Применить фильтры
        </button>
      </div>
    </div>
  );
};