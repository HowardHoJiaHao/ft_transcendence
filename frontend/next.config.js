/** @type {import('next').NextConfig} */
const nextConfig = 
{
  reactStrictMode: true, //this mode helps catch unsafe lifecyle & side effects early
  env: 
  {
    // Docker traffic is same-origin through the WAF. NEXT_PUBLIC_* values are
    // compiled into the browser bundle, so the secure default must not point
    // at the backend's internal port.
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || '',
  },
}

module.exports = nextConfig //export config file
