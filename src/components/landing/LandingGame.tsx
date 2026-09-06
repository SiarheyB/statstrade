import Link from "next/link";
import { Landmark, Skull, Radio, Users, Clock } from "lucide-react";

/**
 * Промо игрового раздела на лендинге.
 *
 * До этого блока сайт вообще не упоминал, что в сервисе есть общий игровой
 * мир — гость узнавал о нём только зайдя в личный кабинет. Четыре карточки
 * держат ровно то, что отличает эту симуляцию от обычного демо-счёта:
 * один рынок на всех, настоящее банкротство без кнопки «начать заново»,
 * банк с реальным балансом и живой мир вокруг. Цифра инструментов приходит
 * параметром, а не зашита в текст: список активов меняется чаще перевода.
 *
 * publicAccess=false — мир обкатывается на своём создателе и ботах, доступ
 * обычным игрокам ещё закрыт (см. gamePublicAccess в dashboard/game/page.tsx).
 * Блок в этом случае остаётся: скрывать его целиком означало бы, что мира
 * ещё нет вовсе, а зовущая кнопка «войти» вела бы гостя прямиком на
 * «недоступно для обычных пользователей» после регистрации — вместо кнопки
 * честно показываем «скоро».
 */
export default function LandingGame({
  instrumentsCount,
  publicAccess,
  t,
}: {
  instrumentsCount: number;
  publicAccess: boolean;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const items = [
    { icon: Users, title: t("landing.game.f1.title"), text: t("landing.game.f1.text", { count: instrumentsCount }) },
    { icon: Skull, title: t("landing.game.f2.title"), text: t("landing.game.f2.text") },
    { icon: Landmark, title: t("landing.game.f3.title"), text: t("landing.game.f3.text") },
    { icon: Radio, title: t("landing.game.f4.title"), text: t("landing.game.f4.text") },
  ];

  return (
    <section id="game" className="max-w-6xl mx-auto px-6 py-14 scroll-mt-20">
      <div className="max-w-2xl">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
            {t("landing.game.kicker")}
          </span>
          {!publicAccess && (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
              <Clock size={10} />
              {t("landing.game.soon")}
            </span>
          )}
        </div>
        <h2 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight">{t("landing.game.title")}</h2>
        <p className="mt-3 text-muted">{t("landing.game.lead")}</p>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {items.map(({ icon: Icon, title, text }) => (
          <div key={title} className="card p-5 flex gap-3.5">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <Icon size={17} />
            </span>
            <div>
              <h3 className="text-[15px] font-semibold">{title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-faint">{text}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-7 flex flex-wrap items-center gap-3">
        {publicAccess ? (
          <>
            <Link
              href="/register"
              className="px-5 py-2.5 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 transition"
            >
              {t("landing.game.cta")}
            </Link>
            <span className="text-xs text-faint">{t("landing.game.ctaHint")}</span>
          </>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-lg border border-border px-5 py-2.5 text-sm text-muted">
            <Clock size={14} />
            {t("landing.game.soonHint")}
          </span>
        )}
      </div>
    </section>
  );
}
