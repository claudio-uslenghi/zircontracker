/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // @resvg/resvg-wasm se carga con fs.readFileSync(path) en tiempo de
    // ejecución (ver lib/holidays-bot-image.tsx) — el file tracer de Next
    // no detecta esa dependencia de forma estática, así que el .wasm queda
    // afuera del bundle de la función serverless en Vercel (ENOENT en
    // producción, aunque local funciona porque ahí node_modules está
    // completo en disco).
    outputFileTracingIncludes: {
      '/api/holidays-bot/image': ['./node_modules/@resvg/resvg-wasm/index_bg.wasm'],
      '/api/holidays-bot/send': ['./node_modules/@resvg/resvg-wasm/index_bg.wasm'],
      '/api/cron/holidays-bot': ['./node_modules/@resvg/resvg-wasm/index_bg.wasm'],
    },
  },
};

export default nextConfig;
