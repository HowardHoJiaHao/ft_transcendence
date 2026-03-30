/** @type {import('next').NextConfig} */
const nextConfig = 
{
  reactStrictMode: true, //this mode helps catch unsafe lifecyle & side effects early
  env: 
  {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080', //read env value from explicit config. if dont exist, use default localhost:8080
  },
}

module.exports = nextConfig //export config file
