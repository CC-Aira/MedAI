import nextVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...nextVitals,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "public/**",
      "prisma/dev.db",
      "next-env.d.ts",
    ],
  },
  {
    rules: {
      // 头像来自后台上传的本地文件，用原生 img 更直接
      "@next/next/no-img-element": "off",
    },
  },
];

export default config;
