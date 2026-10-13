"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/provider";

// Загрузка новой сборки советника. Прежняя заменяется автоматически.
export default function AdvisorUpload({ currentLabel, uploaded }: { currentLabel: string; uploaded: boolean }) {
  const router = useRouter();
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);

  async function send(init: RequestInit, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/advisor/file", init);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || t("admin.advisor.upload.failed"));
      setMsg({ text: okText, error: false });
      setLabel("");
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : t("admin.advisor.upload.failed"), error: true });
    } finally {
      setBusy(false);
    }
  }

  function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file || !label.trim()) return;
    const fd = new FormData();
    fd.set("file", file);
    fd.set("label", label.trim());
    void send({ method: "POST", body: fd }, t("admin.advisor.upload.done"));
  }

  function reset() {
    if (!confirm(t("admin.advisor.upload.resetConfirm"))) return;
    void send({ method: "DELETE" }, t("admin.advisor.upload.resetDone"));
  }

  return (
    <div className="mt-6 card p-4">
      <div className="text-sm font-medium">{t("admin.advisor.upload.title")}</div>
      <p className="mt-1 text-sm text-muted">
        {t("admin.advisor.upload.current", { v: currentLabel })}{" "}
        {uploaded ? t("admin.advisor.upload.fromAdmin") : t("admin.advisor.upload.fromImage")}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept=".ex5" className="text-sm" disabled={busy} />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t("admin.advisor.upload.version")}
          maxLength={20}
          className="w-28 input-base px-2 py-1 text-sm"
          disabled={busy}
        />
        <button onClick={upload} disabled={busy || !label.trim()} className="input-base px-3 py-1 text-sm hover:border-border-strong disabled:opacity-50">
          {t("admin.advisor.upload.button")}
        </button>
        {uploaded && (
          <button onClick={reset} disabled={busy} className="px-3 py-1.5 rounded-lg text-sm text-muted hover:text-fg hover:bg-surface-2">
            {t("admin.advisor.upload.reset")}
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">{t("admin.advisor.upload.hint")}</p>
      {msg && <p className={`mt-2 text-sm ${msg.error ? "text-loss" : "text-profit"}`}>{msg.text}</p>}
    </div>
  );
}
