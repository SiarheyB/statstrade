"use client";

import { useEffect, useRef, useState } from "react";
import { X, AlertTriangle, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const WHEEL_ZOOM_SPEED = 0.0018;

// Модальное окно поверх страницы с превью изображения сделки. Открывается
// кликом по ссылке в таблице сделок, закрывается по клику на фон, крестику
// или Escape — новая вкладка НЕ открывается. Поддерживает зум (колесо мыши,
// кнопки, двойной клик) и панорамирование перетаскиванием при увеличении —
// скриншоты сделок часто мелкие детали (уровни, разметка), без зума
// разглядеть их невозможно.
export default function ImagePreviewModal({
  url,
  onClose,
}: {
  url: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Не даём смещению унести картинку далеко за пределы видимой области —
  // иначе после сильного зума+пана легко "потерять" изображение за краем.
  function clampPos(next: { x: number; y: number }, s: number): { x: number; y: number } {
    const vp = viewportRef.current;
    if (!vp) return next;
    const maxX = (vp.clientWidth * (s - 1)) / 2 + vp.clientWidth * 0.15;
    const maxY = (vp.clientHeight * (s - 1)) / 2 + vp.clientHeight * 0.15;
    return {
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
  }

  function zoomAt(clientX: number, clientY: number, factor: number) {
    const vp = viewportRef.current;
    if (!vp) return;
    const rect = vp.getBoundingClientRect();
    const cx = clientX - rect.left - rect.width / 2;
    const cy = clientY - rect.top - rect.height / 2;
    setScale((prevScale) => {
      const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prevScale * factor));
      const appliedFactor = nextScale / prevScale;
      setPos((prevPos) => {
        // Держим точку под курсором на месте при зуме, а не просто скейлим
        // от центра — иначе зум "убегает" в сторону от того, что смотрит юзер.
        const next = {
          x: cx - (cx - prevPos.x) * appliedFactor,
          y: cy - (cy - prevPos.y) * appliedFactor,
        };
        return nextScale <= MIN_SCALE ? { x: 0, y: 0 } : clampPos(next, nextScale);
      });
      return nextScale;
    });
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    e.stopPropagation();
    const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SPEED);
    zoomAt(e.clientX, e.clientY, factor);
  }

  // Клик по неувеличенному изображению — зум к точке клика (курсор
  // "zoom-in" это и обещает). Двойной клик по увеличенному — сброс к 100%.
  function onImageClick(e: React.MouseEvent) {
    if (scale <= 1) zoomAt(e.clientX, e.clientY, 2.5);
  }
  function onDoubleClick(e: React.MouseEvent) {
    if (scale > 1) {
      setScale(1);
      setPos({ x: 0, y: 0 });
    } else {
      zoomAt(e.clientX, e.clientY, 2.5);
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (scale <= 1) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    setDragging(true);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const d = dragRef.current;
    setPos(clampPos({ x: d.origX + (e.clientX - d.startX), y: d.origY + (e.clientY - d.startY) }, scale));
  }
  function onPointerUp() {
    dragRef.current = null;
    setDragging(false);
  }

  const zoomed = scale > 1.01;

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div className="relative w-[92vw] h-[88vh] max-w-5xl" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          aria-label={t("common.close")}
          className="absolute -top-3 -right-3 z-10 bg-bg border border-border rounded-full p-1.5 text-fg hover:text-accent shadow-lg"
        >
          <X size={16} />
        </button>
        {failed ? (
          <div className="card p-8 text-center text-sm text-muted flex flex-col items-center gap-2 h-full items-center justify-center">
            <AlertTriangle size={20} className="text-loss" />
            {t("trades.image.unavailable")}
          </div>
        ) : (
          <>
            <div
              ref={viewportRef}
              onWheel={onWheel}
              onClick={onImageClick}
              onDoubleClick={onDoubleClick}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              className="w-full h-full rounded-lg overflow-hidden bg-black/20 shadow-2xl select-none"
              style={{ cursor: zoomed ? (dragging ? "grabbing" : "grab") : "zoom-in" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt=""
                draggable={false}
                onError={() => setFailed(true)}
                className="w-full h-full object-contain pointer-events-none"
                style={{
                  transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
                  transformOrigin: "center",
                  transition: dragging ? "none" : "transform 0.12s ease-out",
                }}
              />
            </div>
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-bg/90 border border-border rounded-lg px-1.5 py-1 shadow-lg">
              <button
                onClick={() => zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1 / 1.4)}
                disabled={scale <= MIN_SCALE}
                aria-label={t("trades.image.zoomOut")}
                className="p-1.5 rounded text-faint hover:text-fg hover:bg-surface-2 disabled:opacity-40"
              >
                <ZoomOut size={15} />
              </button>
              <span className="text-xs text-faint tabular-nums w-10 text-center">{Math.round(scale * 100)}%</span>
              <button
                onClick={() => zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.4)}
                disabled={scale >= MAX_SCALE}
                aria-label={t("trades.image.zoomIn")}
                className="p-1.5 rounded text-faint hover:text-fg hover:bg-surface-2 disabled:opacity-40"
              >
                <ZoomIn size={15} />
              </button>
              {zoomed && (
                <button
                  onClick={() => { setScale(1); setPos({ x: 0, y: 0 }); }}
                  aria-label={t("trades.image.zoomReset")}
                  className="p-1.5 rounded text-faint hover:text-fg hover:bg-surface-2"
                >
                  <RotateCcw size={15} />
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
