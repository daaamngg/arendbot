# Аренда оборудования — MAX Mini App

Этот проект — бот и мини-приложение для аренды оборудования. В GitHub он публикуется отдельно от бота аренды квартир: все его файлы находятся в `equipment-rental/`.

## Production-размещение

- Frontend: статический сайт в Yandex Object Storage, бакет `tehnika-4h3c9dk2`.
- API, webhook MAX, задания по расписанию и база данных: Yandex Cloud Functions + YDB.
- `VITE_API_URL` — публичный адрес функции Yandex Cloud, заканчивающийся на `?p=`. Он встраивается в frontend при сборке; без него production-сборка намеренно завершается ошибкой.
- `APP_ORIGIN` на backend должен быть точным адресом опубликованного сайта.
- В настройках webhook приложения MAX задайте callback URL `https://functions.yandexcloud.net/<function-id>?p=/webhook` и тот же `WEBHOOK_SECRET`, который настроен для backend.

Текущий адрес сайта: `https://tehnika-4h3c9dk2.website.yandexcloud.net`. Для выпуска соберите функцию и сайт командой `API_URL="https://functions.yandexcloud.net/<function-id>?p=" node scripts/cloud-build.mjs`. Загрузите ZIP из `cloud-dist/function/` как новую версию `tehnika-api`; затем новые файлы из `cloud-dist/site/assets/` и `cloud-dist/site/photos/` в одноимённые каталоги бакета. `cloud-dist/site/index.html` заменяйте последним, когда ресурсы уже доступны.

Backend должен быть развернут до production deployment frontend. Для него требуются `MAX_BOT_TOKEN`, `ADMIN_CODE`, `WEBHOOK_SECRET`, `BOT_USERNAME`, `YDB_CONNECTION`, `APP_ORIGIN` и `YDB_METADATA_CREDENTIALS=1`. Секреты храните только в переменных окружения облачной функции, не в GitHub, Vercel frontend variables или этом репозитории.

## Разработка

```sh
npm ci
npm run dev
npm run build
npm run selftest
```
