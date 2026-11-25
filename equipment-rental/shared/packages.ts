export const PACKAGES = [
  { id: "package-clean", title: "Чистый дом", itemIds: ["puzzi", "sc4", "window-robot"], names: ["Моющий пылесос", "Парогенератор", "Мойщик окон"] },
  { id: "package-demolition", title: "Мастер Демонтажа", itemIds: ["breaker", "perforator", "grinder", "crowbar", "sledgehammer"], names: ["Отбойный молоток", "Перфоратор", "Болгарка", "Лом", "Кувалда"] },
] as const;
export const packageById = (id: unknown) => PACKAGES.find((p) => p.id === id);
