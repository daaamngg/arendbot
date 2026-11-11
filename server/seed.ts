import type { Listing } from "../shared/types.ts";
import type { Store } from "./store.ts";

// Тестовые объявления для разработки и демо-версии. Явно помечены как тестовые; адреса выдуманные.
// Фото — интерьеры с Unsplash (свободная лицензия), только чтобы экраны были с наполнением.

const unsplash = (id: string) => ({ url: `https://images.unsplash.com/photo-${id}?w=800&q=70&auto=format` });

const P = {
  living: "1502672260266-1c1ef2d93688",
  bedroom: "1505693416388-ac5ce068fe85",
  kitchen: "1484154218962-a197022b5858",
  living2: "1493809842364-78817add7ffb",
  living3: "1554995207-c18c203602cb",
  flat: "1522708323590-d24dbb6b0267",
  flat2: "1560448204-e02f11c3d0e2",
  kitchen2: "1556909114-f6e7ad7d3136",
  interior: "1586023492125-27b2c045efd7",
};

export async function seedDemo(store: Store, opts: { devUserId: number }) {
  const t = Date.now();
  const base = {
    status: "active" as const,
    botChecked: true,
    ownerId: 500,
    rules: { pets: false, smoking: false, kids: true, parties: false },
    checkIn: "14:00",
    checkOut: "12:00",
    closed: [],
    cancelDays: 0,
    checked: true,
    floor: 3,
    deposit: 0,
    minNights: 1,
    createdAt: t,
    updatedAt: t,
  };
  await store.saveUser({ id: 500, name: "Тест-хозяин", phone: "+79270000500", consentAt: t, createdAt: t, hostStatus: "approved" });
  const demo: Omit<Listing, keyof typeof base>[] = [
    {
      id: "demo0001", type: "flat", locality: "Самара", district: "Ленинский", address: "ул. Тестовая, 1", flat: "кв. 1",
      rooms: 1, area: 36, guests: 3, beds: 2, priceWeekday: 2500, priceWeekend: 3000,
      amenities: ["Wi-Fi", "Кондиционер", "Стиральная машина", "Бельё и полотенца"],
      description: "ТЕСТОВОЕ объявление. Пять минут до набережной, рядом магазины и остановка.",
      photos: [P.living, P.bedroom, P.kitchen, P.living2, P.living3].map(unsplash),
    },
    {
      id: "demo0002", type: "studio", locality: "Тольятти", district: "Автозаводский", address: "ул. Тестовая, 2",
      rooms: 1, area: 24, guests: 2, beds: 1, priceWeekday: 1800, priceWeekend: 2200,
      amenities: ["Wi-Fi", "Холодильник"],
      description: "ТЕСТОВАЯ студия. Тихий двор, парковка рядом.",
      photos: [P.flat, P.flat2, P.kitchen2, P.interior].map(unsplash),
    },
    {
      id: "demo0003", type: "flat", locality: "Самара", district: "Октябрьский", address: "ул. Тестовая, 3",
      rooms: 2, area: 54, guests: 4, beds: 3, priceWeekday: 3500, priceWeekend: 4200,
      amenities: ["Wi-Fi", "Парковка", "Стиральная машина", "Посуда", "Детская кроватка"],
      description: "ТЕСТОВАЯ двушка для семьи. Рядом парк и детская площадка.",
      photos: [P.living2, P.kitchen2, P.bedroom, P.flat].map(unsplash),
    },
    {
      id: "demo0004", type: "flat", locality: "Жигулёвск", district: "", address: "ул. Тестовая, 4",
      rooms: 1, area: 33, guests: 2, beds: 1, priceWeekday: 2000, priceWeekend: 2600,
      amenities: ["Wi-Fi", "Балкон", "Заселение без встречи"],
      description: "ТЕСТОВОЕ объявление. Вид на Жигулёвские горы, рядом остановка.",
      photos: [P.living3, P.interior, P.kitchen].map(unsplash),
    },
  ];
  for (const d of demo) await store.saveListing({ ...base, ...d });
  // Админов в демо нет: «Админ» появляется только после кода команды (как в настоящем боте)
  void opts;
}
