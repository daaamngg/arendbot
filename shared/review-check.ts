import type { Review, User } from "./types.ts";
import { RUDE } from "./auto-check.ts";

// Смотритель отзывов. Оставить оценку может только тот, кто правда жил (подтверждённая бронь, выезд прошёл,
// одна оценка на бронь), — это уже отсекает почти всю накрутку. Здесь ловим то, что остаётся:
//   — хозяин оценивает сам себя со второго аккаунта (тот же номер);
//   — «кольцо»: один и тот же гость хвалит много объявлений одного хозяина;
//   — пачка пятёрок за пару дней (накрутка) или пачка единиц от свежих аккаунтов (конкурент мстит);
//   — мат и оскорбления в тексте.
// Такой отзыв не засчитывается и не виден, пока модератор не решит. Честные плохие оценки засчитываются сразу:
// если хозяин не согласен, он нажимает «Оспорить», и модератор смотрит переписку и бронь.

const DAY = 86_400_000;

export interface ReviewCheckInput {
  stars: number;
  text: string;
  guest: User | undefined;
  owner: User | undefined;
  /** другие аккаунты с номером гостя */
  guestTwins: User[];
  /** сколько других объявлений этого же хозяина гость уже оценил */
  sameOwnerReviewed: number;
  /** отзывы этого объявления, уже засчитанные или ждущие проверки */
  listingReviews: Review[];
  now: number;
}

/** Причины придержать отзыв до модератора. Пусто — засчитываем сразу */
export function reviewCheck(i: ReviewCheckInput): string[] {
  const r: string[] = [];
  const ownerPhone = i.owner?.phone;
  if (ownerPhone && (i.guest?.phone === ownerPhone || i.guestTwins.some((u) => u.id === i.owner?.id))) r.push("оценка с аккаунта с номером хозяина");
  if (i.sameOwnerReviewed >= 2) r.push(`гость уже оценил другие объявления этого хозяина: ${i.sameOwnerReviewed}`);
  const recent = (days: number, pred: (x: Review) => boolean) => i.listingReviews.filter((x) => i.now - x.createdAt < days * DAY && !x.removed && pred(x)).length;
  if (i.stars >= 4 && recent(2, (x) => x.stars >= 4) >= 3) r.push("много высоких оценок за двое суток");
  const freshGuest = !!i.guest && i.now - i.guest.createdAt < 7 * DAY;
  if (i.stars <= 2 && freshGuest && recent(7, (x) => x.stars <= 2) >= 1) r.push("несколько низких оценок за неделю, гость только что появился");
  if (RUDE.test(i.text)) r.push("мат или оскорбления в тексте");
  return r;
}
