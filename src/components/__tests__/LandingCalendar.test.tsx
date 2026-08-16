import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LandingCalendar from "@/components/landing/LandingCalendar";
import type { LandingEvent } from "@/lib/landing";

const t = (k: string, vars?: Record<string, string | number>) =>
  vars ? `${k}:${JSON.stringify(vars)}` : k;

// Воскресенье 16.08.2026, полдень UTC. Дальше идут понедельник и вторник.
const SUNDAY = Date.parse("2026-08-16T12:00:00Z");

function event(iso: string, id = iso): LandingEvent {
  return {
    id,
    time: iso,
    currency: "USD",
    country: "United States",
    title: `Событие ${id}`,
    impact: "high",
    forecast: "0.3%",
    previous: null,
    actual: null,
  };
}

function renderAt(now: number, events: LandingEvent[]) {
  return render(
    <LandingCalendar events={events} locale="ru" timezone="UTC" now={now} t={t} />,
  );
}

describe("LandingCalendar", () => {
  // В выходные публикаций нет вовсе. Без явной строки суббота с воскресеньем
  // просто исчезали бы из блока, и это читалось бы как «данные не подгрузились».
  it("в воскресенье показывает оба выходных дня с пометкой", () => {
    renderAt(SUNDAY, []);

    expect(screen.getByText(/суббота, 15 августа/i)).toBeInTheDocument();
    expect(screen.getByText(/landing\.calendar\.today, воскресенье/i)).toBeInTheDocument();
    expect(screen.getAllByText("landing.calendar.weekend")).toHaveLength(2);
  });

  // Страница календаря живёт текущей неделей пн–вс: в воскресенье будущий
  // понедельник в неё не попадает, и главная не должна обещать его события.
  it("в выходные не заглядывает в понедельник", () => {
    renderAt(SUNDAY, [event("2026-08-17T15:30:00Z")]);

    expect(screen.queryByText(/понедельник/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Событие/)).not.toBeInTheDocument();
  });

  it("в субботу показывает субботу и воскресенье", () => {
    renderAt(Date.parse("2026-08-15T12:00:00Z"), []);

    expect(screen.getByText(/landing\.calendar\.today, суббота/i)).toBeInTheDocument();
    expect(screen.getByText(/landing\.calendar\.tomorrow, воскресенье/i)).toBeInTheDocument();
  });

  it("в будний день рисует события таблицей, а не пометкой выходного", () => {
    // Понедельник 17.08 — события есть, выходных в окне нет.
    renderAt(Date.parse("2026-08-17T09:00:00Z"), [event("2026-08-17T15:30:00Z")]);

    expect(screen.queryByText("landing.calendar.weekend")).not.toBeInTheDocument();
    expect(screen.getByText(/Событие/)).toBeInTheDocument();
  });

  it("в будний день пустой день без событий пропускает", () => {
    // Вторник 18.08 остаётся без событий — заголовка для него быть не должно.
    renderAt(Date.parse("2026-08-17T09:00:00Z"), [event("2026-08-17T15:30:00Z")]);

    expect(screen.queryByText(/вторник/i)).not.toBeInTheDocument();
  });
});
