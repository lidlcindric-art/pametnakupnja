/** @type {import('next').NextConfig} */
// Statički export (web/out) koji poslužuje Rust Worker preko Workers Static Assets.
// Lokalno: `npm run build` pa `npx wrangler dev` u ../api (API i frontend na istom originu).
const nextConfig = {
  output: "export",
  images: { unoptimized: true },
};
export default nextConfig;
