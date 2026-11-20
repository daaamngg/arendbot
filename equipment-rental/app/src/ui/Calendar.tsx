import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays } from "../../../shared/dates.ts";

const WEEK = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

/** Сетка месяца с листанием. Как выглядит и что делает каждый день — решает тот, кто её использует */
export function MonthGrid(props: { today: string; maxMonths?: number; day: (d: string) => ReactNode }) {
  const [month, setMonth] = useState(props.today.slice(0, 7));
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const lead = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const len = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: len }, (_, i) => addDays(first, i))];
  const shift = (n: number) => setMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7));
  const last = new Date(Date.UTC(Number(props.today.slice(0, 4)), Number(props.today.slice(5, 7)) - 1 + (props.maxMonths ?? 4), 1)).toISOString().slice(0, 7);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button className="grid size-10 place-items-center rounded-full text-ink disabled:text-line" disabled={month <= props.today.slice(0, 7)} onClick={() => shift(-1)} aria-label="Прошлый месяц">
          <ChevronLeft size={20} />
        </button>
        <b className="text-ink">
          {MONTHS[m - 1]} {y}
        </b>
        <button className="grid size-10 place-items-center rounded-full text-ink disabled:text-line" disabled={month >= last} onClick={() => shift(1)} aria-label="Следующий месяц">
          <ChevronRight size={20} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[13px]">
        {WEEK.map((w) => (
          <div key={w} className="py-1 text-dim">
            {w}
          </div>
        ))}
        {cells.map((d, i) => (d ? <div key={d}>{props.day(d)}</div> : <span key={`e${i}`} />))}
      </div>
    </div>
  );
}

/** Выбор дней аренды: первое нажатие — начало, второе — конец. Занятые дни зачёркнуты, через них выбрать нельзя */
export function RangeCalendar(props: { today: string; busy: Set<string>; from?: string; to?: string; onChange: (from?: string, to?: string) => void }) {
  const { from, to, busy } = props;
  const pick = (d: string) => {
    if (!from || (from && to && from !== to) || d < from) return props.onChange(d, d);
    // Конец: между началом и концом не должно быть занятых дней
    for (let x = from; x <= d; x = addDays(x, 1)) if (busy.has(x)) return props.onChange(d, d);
    props.onChange(from, d);
  };
  return (
    <MonthGrid
      today={props.today}
      day={(d) => {
        const off = d < props.today || busy.has(d);
        const inRange = from && to && d >= from && d <= to;
        const edge = d === from || d === to;
        return (
          <button
            disabled={off}
            onClick={() => pick(d)}
            aria-pressed={!!inRange}
            aria-label={`${Number(d.slice(8))}${busy.has(d) ? ", занято" : ""}`}
            className={`aspect-square w-full rounded-lg text-[15px] tabular-nums ${
              busy.has(d) && d >= props.today ? "day-off" : off ? "text-line" : edge ? "bg-coffee font-semibold text-on-coffee" : inRange ? "bg-coffee-soft text-coffee" : "text-ink active:bg-surface-2"
            }`}
          >
            {Number(d.slice(8))}
          </button>
        );
      }}
    />
  );
}
