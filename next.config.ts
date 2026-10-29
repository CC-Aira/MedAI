import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 头像文件写在 public/uploads 下，运行时上传不需要打包体积
  images: {
    unoptimized: true,
  },

  /**
   * 这几个包不能被打包器内联，必须在运行时用 Node 原生 require 从 node_modules 加载：
   *
   * - tesseract.js：它的 worker 脚本靠 __dirname 找 src/worker-script/node/index.js，
   *   一旦被内联，__dirname 会变成打包器的虚拟根（实测报 E:\ROOT\node_modules\...），
   *   识别直接崩掉。
   * - pdf-parse / mammoth：同样是靠自身文件树去找实现文件。
   */
  serverExternalPackages: ["tesseract.js", "pdf-parse", "mammoth"],

  /**
   * 静态资源必须每次回源验证。
   *
   * Next 默认给 /_next/static/* 发 `max-age=31536000, immutable`，前提是文件名里带
   * 内容 hash，内容一变文件名就变。但 Turbopack 生产构建的 chunk 名是稳定标识符
   * （如 2symaaldk2e8u.css），重新 build 后名字不变、内容变了 —— 浏览器拿着
   * immutable 承诺永远不会再请求它，于是改完代码用户看到的还是旧页面，
   * 连普通 F5 都救不回来。
   *
   * 这里改成 no-cache：浏览器每次带 ETag 回来问一句，没变就 304，只多一个
   * 几百字节的往返，换来的是「重新 build 后刷新就一定看到新版本」。
   */
  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: "no-cache, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
