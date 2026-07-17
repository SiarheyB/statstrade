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
    <div className="space-y-4 bg-gray-50 p-6 rounded-lg border border-gray-200">
      <h2 className="text-lg font-semibold mb-2">Фильтры логов</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Модуль</label>
          <input
            type="text"
            value={module}
            onChange={(e) => setModule(e.target.value)}
            className="w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Например: import"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">ID аккаунта</label>
          <input
            type="text"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Например: acc_123"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Тип события</label>
          <input
            type="text"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            className="w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Например: FILE_RECEIVED"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Уровень лога</label>
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Все уровни</option>
            <option value="info">Info</option>
            <option value="warn">Warning</option>
            <option value="error">Error</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Поиск</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Поиск в сообщениях..."
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:gap-4 pt-4 border-t">
        <div>
          <label className="block text-sm font-medium mb-1">Дата с</label>
          <input
            type="date"
            value={startDate ? startDate.toISOString().split('T')[0] : ''}
            onChange={(e) => {
              if (e.target.value) setStartDate(new Date(e.target.value));
              else setStartDate(null);
            }}
            className="w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Дата по</label>
          <input
            type="date"
            value={endDate ? endDate.toISOString().split('T')[0] : ''}
            onChange={(e) => {
              if (e.target.value) setEndDate(new Date(e.target.value));
              else setEndDate(null);
            }}
            className="w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
          className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
        >
          Сбросить
        </button>

        <button
          type="button"
          onClick={handleChange}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
        >
          Применить фильтры
        </button>
      </div>
    </div>
  );
};