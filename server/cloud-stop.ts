// «Рубильник»: маленькая облачная функция, которую вызывает триггер бюджета, когда расходы за месяц
// переходят порог (уведомление arenda-stop-10rub на 10 ₽). Она закрывает публичный доступ к основной функции —
// приложение и бот перестают отвечать, и расходы дальше не растут. Данные не удаляются; включить обратно:
//   yc serverless function allow-unauthenticated-invoke arenda-api --profile arenda
// Права: сервисный аккаунт arenda-stop с ролью functions.admin на каталог. Ключей в коде нет — токен даёт облако.

export async function handler(_event: unknown, context?: { token?: { access_token?: string } }) {
  const token = context?.token?.access_token;
  const fn = process.env.TARGET_FUNCTION_ID;
  if (!token || !fn) return { statusCode: 500, body: "нет токена или TARGET_FUNCTION_ID" };
  const r = await fetch(`https://serverless-functions.api.cloud.yandex.net/functions/v1/functions/${fn}:setAccessBindings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ accessBindings: [] }),
  });
  console.log(`Рубильник: доступ к функции закрыт, ответ ${r.status}`);
  return { statusCode: r.ok ? 200 : 500, body: r.ok ? "stopped" : await r.text() };
}
