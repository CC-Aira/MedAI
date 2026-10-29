/**
 * pdf-parse 只有 CJS 实现文件，没有随包发 .d.ts。
 * 我们直接引 lib/pdf-parse.js（入口文件在打包环境下会去读它自带的测试样本），
 * 这里补一个最小声明，只描述我们实际用到的那个函数。
 */
declare module "pdf-parse/lib/pdf-parse.js" {
  const pdfParse: (buffer: Buffer) => Promise<{ text: string; numpages?: number }>;
  export default pdfParse;
}
