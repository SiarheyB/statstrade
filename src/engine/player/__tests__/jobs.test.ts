import { describe, it, expect } from "vitest";
import { accrueSalary, advanceAvailable, freshCareer, getJob, hireError, isEmployed, jobAvailable, JOBS } from "@/engine/player/jobs";

const DAY = 24 * 60 * 60 * 1000;
const job = JOBS[0];
const state = (patch: Partial<ReturnType<typeof fresh>> = {}) => ({ ...fresh(), ...patch });
const fresh = () => ({ jobId: job.id, startedAt: 0, paidUntil: 0, advanceDebt: 0, earned: 0 });

describe("работа и зарплата", () => {
  it("зарплата капает непрерывно: за полдня платят за полдня", () => {
    // Игровое время идёт вровень с реальным, и полночь — момент, к которому
    // игрок отношения не имеет.
    const { paid } = accrueSalary(state(), job, DAY / 2);
    expect(paid).toBeCloseTo(job.dailySalary / 2, 6);
  });

  it("одно и то же время не оплачивается дважды", () => {
    const first = accrueSalary(state(), job, DAY);
    const second = accrueSalary(first.state, job, DAY);
    expect(second.paid).toBe(0);
  });

  it("аванс гасится из начислений и только потом деньги идут на руки", () => {
    // Иначе авансом можно было бы пользоваться бесконечно, ни разу его не
    // отработав.
    const withDebt = state({ advanceDebt: job.dailySalary });
    const afterDay = accrueSalary(withDebt, job, DAY);
    expect(afterDay.paid).toBe(0);
    expect(afterDay.state.advanceDebt).toBeCloseTo(0, 6);

    const afterTwo = accrueSalary(afterDay.state, job, 2 * DAY);
    expect(afterTwo.paid).toBeCloseTo(job.dailySalary, 6);
  });

  it("отработанное учитывается целиком, даже если ушло в счёт аванса", () => {
    const afterDay = accrueSalary(state({ advanceDebt: job.dailySalary }), job, DAY);
    expect(afterDay.state.earned).toBeCloseTo(job.dailySalary, 6);
  });

  it("аванс ограничен несколькими днями вперёд", () => {
    expect(advanceAvailable(state(), job)).toBeCloseTo(job.dailySalary * job.advanceDays, 6);
    const halfTaken = state({ advanceDebt: job.dailySalary });
    expect(advanceAvailable(halfTaken, job)).toBeCloseTo(job.dailySalary * (job.advanceDays - 1), 6);
    const maxed = state({ advanceDebt: job.dailySalary * job.advanceDays });
    expect(advanceAvailable(maxed, job)).toBe(0);
  });
});

describe("доступность работы", () => {
  it("первая работа доступна всем — с неё и начинают после банкротства", () => {
    expect(jobAvailable(JOBS[0], { prestige: 0, level: 0, contractsPassed: 0 })).toBe(true);
  });

  it("работы посерьёзнее требуют репутации и уровня", () => {
    const senior = JOBS[JOBS.length - 1];
    expect(jobAvailable(senior, { prestige: 0, level: 0, contractsPassed: 0 })).toBe(false);
    expect(jobAvailable(senior, { prestige: 1000, level: 10, contractsPassed: 10 })).toBe(true);
  });

  it("чем выше требования, тем больше платят", () => {
    for (let i = 1; i < JOBS.length; i++) {
      expect(JOBS[i].dailySalary).toBeGreaterThan(JOBS[i - 1].dailySalary);
    }
  });

  it("у всех работ уникальные идентификаторы и они находятся по id", () => {
    const ids = JOBS.map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(getJob(id)?.id).toBe(id);
  });
});

describe("карьера", () => {
  it("новая карьера начинается без работы и без банкротств", () => {
    const career = freshCareer();
    expect(career.job).toBeNull();
    expect(career.bankruptcies).toBe(0);
  });
});

describe("кем можно быть одновременно", () => {
  const stats = { prestige: 100, level: 5, contractsPassed: 1 };
  const courier = getJob("JOB_COURIER")!;
  const callcenter = getJob("JOB_CALLCENTER")!;
  const backoffice = getJob("JOB_BACKOFFICE")!;

  it("владельца фонда не берут никуда, даже курьером", () => {
    expect(hireError(courier, freshCareer(), true, stats)).toBe("owns_fund");
    expect(hireError(backoffice, freshCareer(), true, stats)).toBe("owns_fund");
  });

  it("вторую основную работу взять нельзя, а курьера вдобавок — можно", () => {
    const employed = {
      ...freshCareer(),
      job: { jobId: "JOB_CALLCENTER", startedAt: 0, paidUntil: 0, advanceDebt: 0, earned: 0 },
    };
    expect(hireError(backoffice, employed, false, stats)).toBe("already_employed");
    expect(hireError(courier, employed, false, stats)).toBeNull();
  });

  it("подработка тоже одна", () => {
    const moonlighting = {
      ...freshCareer(),
      sideJob: { jobId: "JOB_COURIER", startedAt: 0, paidUntil: 0, advanceDebt: 0, earned: 0 },
    };
    expect(hireError(courier, moonlighting, false, stats)).toBe("already_side");
    // Основная при этом свободна.
    expect(hireError(callcenter, moonlighting, false, stats)).toBeNull();
  });

  it("требования проверяются последними — сначала непреодолимое", () => {
    const weak = { prestige: 0, level: 0, contractsPassed: 0 };
    expect(hireError(callcenter, freshCareer(), false, weak)).toBe("locked");
    // У владельца фонда причина другая, и престиж копить бесполезно.
    expect(hireError(callcenter, freshCareer(), true, weak)).toBe("owns_fund");
  });

  it("занятость считает обе ставки", () => {
    expect(isEmployed(freshCareer())).toBe(false);
    expect(
      isEmployed({ ...freshCareer(), sideJob: { jobId: "JOB_COURIER", startedAt: 0, paidUntil: 0, advanceDebt: 0, earned: 0 } }),
    ).toBe(true);
  });
});
