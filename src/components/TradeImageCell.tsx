"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Upload, Trash2, ImageIcon, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ACCEPTED = "image/png,image/jpeg,image/webp,image/gif";

const PROVIDER_LABELS: Record<string, string> = {
  google_drive: "Google Drive",
  yandex_disk: "Яндекс.Диск",
};

// Ячейка колонки «Изображение» в таблице сделок. Три состояния:
//  1. Ни один облачный провайдер не подключён → ссылка в настройки.
//  2. Подключён, ссылки нет → кнопка «Загрузить» (выбор файла → аплоад).
//  3. Ссылка есть → короткая метка (открывает модалку) + корзина (удаляет
//     только ссылку у нас, файл в облаке пользователя не трогаем).
export default function TradeImageCell({
  tradeKey,
  symbol,
  entryTime,
  result,
  pattern,
  imageUrl,
  imageProvider,
  connected,
  onUploaded,
  onDeleted,
  onPreview,
}: {
  tradeKey: string;
  // Только для человекочитаемого имени файла на диске (символ_дата_результат)
  // и структуры папок (год-месяц/паттерн) — сама привязка идёт по tradeKey,
  // см. /api/trade-images.
  symbol: string;
  entryTime: string;
  result: string;
  pattern: string | null;
  imageUrl: string | null;
  imageProvider?: string | null;
  connected: boolean;
  onUploaded: (url: string, provider: string) => void;
  onDeleted: () => void;
  onPreview: (url: string) => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    if (file.size > MAX_IMAGE_BYTES) {
      setError(t("trades.image.tooLarge"));
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("tradeKey", tradeKey);
      form.append("symbol", symbol);
      form.append("entryTime", entryTime);
      form.append("result", result);
      if (pattern) form.append("pattern", pattern);
      form.append("file", file);
      const res = await fetch("/api/trade-images", { method: "POST", body: form });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? t("trades.image.uploadError"));
        return;
      }
      onUploaded(d.imageUrl, d.imageProvider);
    } catch {
      setError(t("trades.image.uploadError"));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/trade-images?tradeKey=${encodeURIComponent(tradeKey)}`, {
        method: "DELETE",
      });
      if (res.ok) onDeleted();
    } finally {
      setBusy(false);
    }
  }

  if (!connected) {
    return (
      <Link
        href="/dashboard/settings#integrations"
        className="text-xs text-faint hover:text-accent whitespace-nowrap"
        onClick={(e) => e.stopPropagation()}
      >
        {t("trades.image.connectHint")}
      </Link>
    );
  }

  if (imageUrl) {
    // Для Яндекс.Диска imageUrl — наш собственный относительный прокси-путь
    // (см. /api/trade-images/view), у него нет хоста для парсинга — там
    // показываем название провайдера вместо домена.
    let label = imageProvider ? PROVIDER_LABELS[imageProvider] : undefined;
    if (!label) {
      try {
        label = new URL(imageUrl).hostname.replace(/^www\./, "");
      } catch {
        label = imageUrl;
      }
    }
    return (
      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => onPreview(imageUrl)}
          className="inline-flex items-center gap-1 text-xs text-accent hover:underline max-w-[110px] truncate"
          title={imageUrl}
        >
          <ImageIcon size={13} className="shrink-0" />
          <span className="truncate">{label}</span>
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={busy}
          aria-label={t("trades.image.remove")}
          className="text-faint hover:text-loss disabled:opacity-50 shrink-0"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
        </button>
      </div>
    );
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) handleFile(f);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="inline-flex items-center gap-1 text-xs text-faint hover:text-accent disabled:opacity-50 whitespace-nowrap"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
        {t("trades.image.upload")}
      </button>
      {error && <div className="text-[10px] text-loss mt-0.5 max-w-[120px]">{error}</div>}
    </div>
  );
}
