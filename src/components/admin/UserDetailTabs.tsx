"use client";

// Вкладки в карточке пользователя.
//
// Раньше всё лежало одной лентой: профиль, подключённые биржи, игровой
// профиль и история действий админов подряд. Разделы отвечают на разные
// вопросы, и, придя разобраться с игрой, админ не должен прокручивать мимо
// таблицы бирж.
//
// Содержимое приходит уже отрисованным с сервера — здесь только
// переключатель: данные для вкладок всё равно грузятся одним запросом
// страницы, и делать их клиентскими незачем.
import { useState, type ReactNode } from "react";

export default function UserDetailTabs({
  tabs,
}: {
  tabs: { id: string; label: string; content: ReactNode }[];
}) {
  const [active, setActive] = useState(tabs[0]?.id);
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 card p-1 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActive(tab.id)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              tab.id === current?.id ? "bg-accent text-white" : "text-muted hover:text-fg"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="mt-4">{current?.content}</div>
    </div>
  );
}
