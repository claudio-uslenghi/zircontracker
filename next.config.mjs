// Además del .wasm, la imagen lee fuentes y template de assets/holidays-bot en runtime.
const TRACED_FILES = ['./node_modules/@resvg/resvg-wasm/index_bg.wasm', './assets/holidays-bot/**/*']

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // @resvg/resvg-wasm se carga con fs.readFileSync(path) en tiempo de
    // ejecución (ver lib/holidays-bot-image.ts) — el file tracer de Next
    // no detecta esa dependencia de forma estática, así que el .wasm queda
    // afuera del bundle de la función serverless en Vercel (ENOENT en
    // producción, aunque local funciona porque ahí node_modules está
    // completo en disco).
    outputFileTracingIncludes: {
      '/api/holidays-bot/image': TRACED_FILES,
      '/api/holidays-bot/send': TRACED_FILES,
      '/api/cron/holidays-bot': TRACED_FILES,
    },
  },
};

export default nextConfig;
