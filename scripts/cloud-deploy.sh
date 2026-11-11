#!/usr/bin/env bash
# Выкладка в Яндекс Облако (профиль yc «arenda» — третий аккаунт Арслана; профиль default НЕ трогаем, он чужой).
# Запуск из Git Bash в папке arenda-bot:  bash scripts/cloud-deploy.sh
# Повторный запуск безопасен: что уже создано — не пересоздаётся, обновляется только код.
#
# Что создаётся (всё в бесплатных лимитах, регион ru-central1 — данные в России):
#   сервисные аккаунты arenda-fn (база + загрузка фото) и arenda-stop (рубильник)
#   YDB serverless «arenda» — база; доступ только у arenda-fn
#   бакет arenda-<id> — сайт мини-приложения и фото; публичное только чтение файлов, без списка
#   функция arenda-api (128 МБ, не больше 2 копий одновременно) + таймер раз в 5 минут
#   функция arenda-stop + триггер бюджета: при расходах выше порога закрывает доступ к arenda-api
set -euo pipefail
YC="${YC:-$HOME/yandex-cloud/bin/yc.exe}"
# Платёжный аккаунт account-apogee-6581 и уведомление arenda-stop-10rub (10 ₽ в месяц) — для рубильника
BILLING_ID="${BILLING_ID:-dn2l3o2rhqkldphkarkx}"
BUDGET_ID="${BUDGET_ID:-dn2kbo3iu0bu72bid4du}"
P="--profile arenda"
J() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s||'null');console.log(eval('o'+process.argv[1])??'')})" "$1"; }
env_of() { grep -E "^$1=" .env.local | head -1 | cut -d= -f2-; }

FOLDER=$("$YC" $P config get folder-id)
echo "Каталог: $FOLDER"

# --- сервисные аккаунты
sa() { "$YC" $P iam service-account get --name "$1" --format json 2>/dev/null | J .id || true; }
for n in arenda-fn arenda-stop; do [ -n "$(sa $n)" ] || "$YC" $P iam service-account create --name "$n" >/dev/null; done
SA_FN=$(sa arenda-fn); SA_STOP=$(sa arenda-stop)
bind() { "$YC" $P resource-manager folder add-access-binding "$FOLDER" --role "$1" --subject "serviceAccount:$2" >/dev/null 2>&1 || true; }
bind ydb.editor "$SA_FN"; bind storage.uploader "$SA_FN"; bind functions.functionInvoker "$SA_FN"
bind functions.admin "$SA_STOP"

# --- база YDB serverless
"$YC" $P ydb database get arenda >/dev/null 2>&1 || "$YC" $P ydb database create arenda --serverless >/dev/null
until [ "$("$YC" $P ydb database get arenda --format json | J .status)" = "RUNNING" ]; do sleep 5; done
YDB_CONNECTION=$("$YC" $P ydb database get arenda --format json | J .endpoint)
echo "База: готова"

# --- бакет: сайт + фото
BUCKET="arenda-${FOLDER: -8}"
"$YC" $P storage bucket get "$BUCKET" >/dev/null 2>&1 || "$YC" $P storage bucket create --name "$BUCKET" --public-read >/dev/null
"$YC" $P storage bucket update --name "$BUCKET" --public-read --website-settings '{"index":"index.html"}' >/dev/null
APP_ORIGIN="https://$BUCKET.website.yandexcloud.net"

# --- функция API
"$YC" $P serverless function get arenda-api >/dev/null 2>&1 || "$YC" $P serverless function create --name arenda-api >/dev/null
"$YC" $P serverless function allow-unauthenticated-invoke arenda-api >/dev/null
FN_ID=$("$YC" $P serverless function get arenda-api --format json | J .id)
API_URL="https://functions.yandexcloud.net/$FN_ID?p="

# --- сборка и выкладка
API_URL="$API_URL" node scripts/cloud-build.mjs
"$YC" $P storage s3 cp --recursive cloud-dist/site "s3://$BUCKET/" >/dev/null
WEBHOOK_SECRET=$(env_of WEBHOOK_SECRET); [ -n "$WEBHOOK_SECRET" ] || { WEBHOOK_SECRET=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"); echo "WEBHOOK_SECRET=$WEBHOOK_SECRET" >> .env.local; }
"$YC" $P serverless function version create --function-name arenda-api --runtime nodejs22 --entrypoint index.handler \
  --memory 128m --execution-timeout 15s --source-path cloud-dist/function --service-account-id "$SA_FN" \
  --environment "MAX_BOT_TOKEN=$(env_of MAX_BOT_TOKEN),ADMIN_CODE=$(env_of ADMIN_CODE),MOD_CODE=$(env_of MOD_CODE),WEBHOOK_SECRET=$WEBHOOK_SECRET,BOT_USERNAME=$(env_of BOT_USERNAME),YDB_CONNECTION=$YDB_CONNECTION,YDB_METADATA_CREDENTIALS=1,APP_ORIGIN=$APP_ORIGIN,API_URL=$API_URL,PHOTO_BUCKET=$BUCKET" >/dev/null
# Не больше 2 копий одновременно: даже при атаке запросами расход не взлетит
"$YC" $P serverless function set-scaling-policy arenda-api --tag '$latest' --zone-instances-limit 2 >/dev/null 2>&1 || true
"$YC" $P serverless trigger get arenda-sweep >/dev/null 2>&1 || "$YC" $P serverless trigger create timer --name arenda-sweep \
  --cron-expression '0 */5 ? * * *' --invoke-function-name arenda-api --invoke-function-service-account-id "$SA_FN" >/dev/null

# --- рубильник
mkdir -p cloud-dist/stop
npx esbuild server/cloud-stop.ts --bundle --platform=node --format=cjs --target=node22 --outfile=cloud-dist/stop/index.js --log-level=warning
"$YC" $P serverless function get arenda-stop >/dev/null 2>&1 || "$YC" $P serverless function create --name arenda-stop >/dev/null
"$YC" $P serverless function version create --function-name arenda-stop --runtime nodejs22 --entrypoint index.handler \
  --memory 128m --execution-timeout 10s --source-path cloud-dist/stop --service-account-id "$SA_STOP" --environment "TARGET_FUNCTION_ID=$FN_ID" >/dev/null
if [ -n "${BUDGET_ID:-}" ] && [ -n "${BILLING_ID:-}" ]; then
  "$YC" $P serverless trigger get arenda-stop >/dev/null 2>&1 || "$YC" $P serverless trigger create billing-budget --name arenda-stop \
    --billing-account-id "$BILLING_ID" --budget-id "$BUDGET_ID" --invoke-function-name arenda-stop --invoke-function-service-account-id "$SA_STOP" >/dev/null
fi

echo
echo "Готово."
echo "Мини-приложение: $APP_ORIGIN"
echo "API:             $API_URL/me"
echo "Вебхук для бота (ПОДКЛЮЧАТЬ ТОЛЬКО ПО СЛОВУ АРСЛАНА): $API_URL/webhook"
