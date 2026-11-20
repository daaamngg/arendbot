# Аренда оборудования — MAX Mini App

Этот проект — бот и мини-приложение для аренды оборудования. В GitHub он публикуется отдельно от бота аренды квартир: все его файлы находятся в `equipment-rental/`.

## Production-размещение

- Frontend: Vercel.
- API, webhook MAX, задания по расписанию и база данных: Yandex Cloud Functions + YDB.
- `VITE_API_URL` — публичный адрес функции Yandex Cloud, заканчивающийся на `?p=`. Он встраивается в frontend при сборке; без него production-сборка намеренно завершается ошибкой.
- `APP_ORIGIN` на backend должен быть точным production-адресом Vercel.
- В настройках webhook приложения MAX задайте callback URL `https://functions.yandexcloud.net/<function-id>?p=/webhook` и тот же `WEBHOOK_SECRET`, который настроен для backend.

Для подключения проекта Vercel к общему GitHub-репозиторию задайте Root Directory `equipment-rental`. Команда сборки — `npm run build:vercel`, каталог результата — `dist`. Добавьте `VITE_API_URL` в Production Environment Variables Vercel и запустите production deployment.

Backend должен быть развернут до production deployment frontend. Для него требуются `MAX_BOT_TOKEN`, `ADMIN_CODE`, `WEBHOOK_SECRET`, `BOT_USERNAME`, `YDB_CONNECTION`, `APP_ORIGIN` и `YDB_METADATA_CREDENTIALS=1`. Секреты храните только в переменных окружения облачной функции, не в GitHub, Vercel frontend variables или этом репозитории.

## Разработка

```sh
npm ci
npm run dev
npm run build
npm run selftest
```
