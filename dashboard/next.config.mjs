/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone", // 도커는 standalone 서버(node server.js)로 기동 → instrumentation(시드/지표수집기) 실행됨
  experimental: {
    instrumentationHook: true, // src/instrumentation.ts 활성화 (Next 14)
    serverComponentsExternalPackages: ["@prisma/client"],
    // 대용량 업로드(영상/이미지) 프록시를 위한 바디 크기 상향
    serverActions: { bodySizeLimit: "500mb" },
  },
  webpack: (config) => {
    // bcryptjs 의 선택적 require('crypto') 경고 제거 (순수 JS 폴백 사용).
    config.resolve.fallback = { ...config.resolve.fallback, crypto: false };
    return config;
  },
};

export default nextConfig;
