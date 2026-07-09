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
  // 보안 헤더 — 클릭재킹/MIME 스니핑/정보 노출 완화 + HTTPS 강제(HSTS).
  // 참고: script-src 는 Next 하이드레이션 인라인 스크립트 때문에 'unsafe-inline' 필요.
  //       완전 강화(nonce 기반 CSP)는 후속 과제.
  async headers() {
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
      "object-src 'none'",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // HSTS: HTTPS 접속 시에만 브라우저가 적용(HTTP 내부망 배포엔 영향 없음).
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
