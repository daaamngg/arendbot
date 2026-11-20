const value = process.env.VITE_API_URL;

if (!value) {
  throw new Error("VITE_API_URL is required for a Vercel build.");
}

let api;
try {
  api = new URL(value);
} catch {
  throw new Error("VITE_API_URL must be a valid HTTPS Yandex Cloud function URL ending in ?p=.");
}

if (
  api.protocol !== "https:" ||
  api.hostname !== "functions.yandexcloud.net" ||
  api.search !== "?p=" ||
  api.hash
) {
  throw new Error("VITE_API_URL must be a valid HTTPS Yandex Cloud function URL ending in ?p=.");
}
