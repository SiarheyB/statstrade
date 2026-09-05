// Работа: как подняться после банкротства.
//
// Кнопки «начать заново» в игре нет намеренно. Обнуление стирает не только
// деньги, но и цену ошибки: если из любой ямы можно выйти нажатием кнопки,
// то и падать не страшно, и весь риск-менеджмент превращается в формальность.
//
// Вместо этого — объявить себя банкротом и пойти работать. Зарплата капает
// по реальным дням (игровое время идёт вровень с реальным), её можно взять
// авансом за несколько дней вперёд, а дальше решать самому: положить
// заработанное на брокерский счёт или сначала занять в банке.
//
// Это не наказание, а восстановление веса решений: деньги, заработанные
// неделей работы, игрок ставит осторожнее, чем выданные кнопкой.
import jobsData from "@/data/jobs.json";
import type { CareerState, JobState } from "@/engine/entities/types";

export type { CareerState, JobState };

export interface JobRequirements {
  prestige?: number;
  level?: number;
  contractsPassed?: number;
}

export interface Job {
  id: string;
  /** Зарплата за один РЕАЛЬНЫЙ день. */
  dailySalary: number;
  requires: JobRequirements;
  /** За сколько дней вперёд можно взять аванс. */
  advanceDays: number;
}

export const JOBS = jobsData as Job[];

export function getJob(id: string): Job | undefined {
  return JOBS.find((job) => job.id === id);
}



export function freshCareer(): CareerState {
  return { job: null, bankruptcies: 0, lastBankruptcyAt: null };
}

/** Доступна ли работа по текущим достижениям. */
export function jobAvailable(job: Job, stats: { prestige: number; level: number; contractsPassed: number }): boolean {
  const { prestige = 0, level = 0, contractsPassed = 0 } = job.requires;
  return stats.prestige >= prestige && stats.level >= level && stats.contractsPassed >= contractsPassed;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SalaryResult {
  /** Сколько зачислить в кошелёк. */
  paid: number;
  state: JobState;
}

/**
 * Зарплата за прошедшее время.
 *
 * Считается непрерывно, а не «раз в полночь»: игровое время идёт вровень с
 * реальным, и полночь — момент, к которому игрок отношения не имеет.
 * Проработав полдня, он получит за полдня.
 *
 * Аванс гасится из начислений и только потом деньги идут на руки: иначе
 * авансом можно было бы пользоваться бесконечно, ни разу его не отработав.
 */
export function accrueSalary(state: JobState, job: Job, now: number): SalaryResult {
  const elapsed = Math.max(0, now - state.paidUntil);
  if (elapsed <= 0) return { paid: 0, state };
  const gross = (elapsed / DAY_MS) * job.dailySalary;
  const toDebt = Math.min(state.advanceDebt, gross);
  const paid = gross - toDebt;
  return {
    paid,
    state: {
      ...state,
      paidUntil: now,
      advanceDebt: state.advanceDebt - toDebt,
      earned: state.earned + gross,
    },
  };
}

/** Сколько можно взять авансом прямо сейчас. */
export function advanceAvailable(state: JobState, job: Job): number {
  const cap = job.dailySalary * job.advanceDays;
  return Math.max(0, cap - state.advanceDebt);
}
