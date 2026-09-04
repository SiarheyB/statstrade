"use client";

// Всплывающие уведомления игры: сработал стоп, пройдено испытание, пришли
// деньги из общего мира, вышла крупная новость.
//
// Зачем: до этого игра молчала. Стоп срабатывал — игрок узнавал об этом,
// случайно заметив изменившийся баланс; испытание проваливалось так же тихо.
// Живая обратная связь — то, что отличает игру от таблицы с числами.
import { useEffect } from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useGameStore } from "@/store/gameStore";

const TONE_STYLE = {
  good: { cls: "border-profit/40 bg-profit/10 text-profit", Icon: CheckCircle2 },
  bad: { cls: "border-loss/40 bg-loss/10 text-loss", Icon: XCircle },
  info: { cls: "border-accent/40 bg-accent/10 text-accent", Icon: Info },
} as const;

// Сколько живёт уведомление. Достаточно, чтобы прочитать фразу, и мало,
// чтобы не мешать смотреть график.
const LIFETIME_MS = 6_000;

function Toast({ id, tone, text }: { id: string; tone: keyof typeof TONE_STYLE; text: string }) {
  const dismiss = useGameStore((s) => s.dismissNotice);
  const { cls, Icon } = TONE_STYLE[tone];

  useEffect(() => {
    const timer = setTimeout(() => dismiss(id), LIFETIME_MS);
    return () => clearTimeout(timer);
  }, [id, dismiss]);

  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg backdrop-blur ${cls}`}>
      <Icon size={15} className="mt-0.5 shrink-0" />
      <span className="text-fg">{text}</span>
      <button type="button" onClick={() => dismiss(id)} className="ml-1 text-muted hover:text-fg">
        <X size={13} />
      </button>
    </div>
  );
}

export default function GameToasts() {
  const notices = useGameStore((s) => s.notices);
  if (notices.length === 0) return null;
  return (
    // Правый нижний угол: там ничего не перекрывает ни график, ни тикет.
    <div className="fixed bottom-4 right-4 z-50 flex w-[320px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {notices.map((notice) => (
        <Toast key={notice.id} id={notice.id} tone={notice.tone} text={notice.text} />
      ))}
    </div>
  );
}
