"""
把一个目录打成 zip，文件名一律按 UTF-8 写入（zip 规范的「语言编码标记」位）。

为什么不用 Windows 自带的 tar.exe：它按本机 ANSI 代码页（GBK）写条目名，
在 macOS / Linux 上解压出来是乱码，评委要是用 Mac 就等于看到一堆问号。
Python 的 zipfile 会自动对非 ASCII 名字设 UTF-8 标记，各平台都能正确解开。

  python scripts/zipdir.py <源目录> <输出.zip>
"""
import os
import sys
import zipfile

src, out = sys.argv[1], sys.argv[2]

with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for root, _dirs, files in os.walk(src):
        for name in files:
            path = os.path.join(root, name)
            arc = os.path.relpath(path, src).replace(os.sep, "/")
            z.write(path, arc)

print(f"zip ok: {out}")
