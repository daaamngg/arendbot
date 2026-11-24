// Акция на главной. ВЫДУМАНА для демо (просьба Арслана 19.11) — условия поменять на настоящие от Сергея.
// Таймер личный и честный: идёт от момента, когда человек открыл подарок (время хранится на сервере),
// при новом входе не сбрасывается; через `days` суток скидка сгорает и подарок пропадает.
export const PROMO = {
  percent: 15,
  /** сколько суток действует открытый подарок */
  days: 1,
  /** скидка — на аренду от стольких суток */
  minDays: 2,
  title: "на первую аренду",
  terms: "от 2 суток, любая техника",
};
export const promoEnd = (openedAt: number) => openedAt + PROMO.days * 86400_000;
/** Действует ли подарок сейчас */
export const promoActive = (openedAt: number | null | undefined, now: number) => !!openedAt && now < promoEnd(openedAt);
export const SPIN_COOLDOWN = 86_400_000;
export const activeDiscount = (promoAt: number | null | undefined, promoUsed: boolean, spinPercent: number | null | undefined, spinExpiresAt: number | null | undefined, now: number, rentalDays = PROMO.minDays) => {
  const starter = rentalDays >= PROMO.minDays && !promoUsed && promoActive(promoAt, now) ? PROMO.percent : 0;
  const spin = spinExpiresAt && now < spinExpiresAt ? (spinPercent ?? 0) : 0;
  return starter + spin;
};
