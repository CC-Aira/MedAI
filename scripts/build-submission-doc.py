"""
把 作品说明文档.html 打成 PDF：两遍渲染 + 目录页码 + 页脚。

第一遍先排一次，量出每节落在第几页；把页码填回目录再排第二遍（目录只是数字，
不会改变正文分页）；最后用 PyMuPDF 在页脚写「第 N 页 / 共 M 页」——
Chrome 的 --print-to-pdf 不支持 CSS 的 @page 边距盒，所以页码只能后期盖上去。

  python scripts/build-submission-doc.py
"""
import os
import re
import subprocess
import pathlib

import pymupdf

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASE = ROOT / "docs" / "submission"
HTML = BASE / "作品说明文档.html"
PDF = BASE / "作品说明文档.pdf"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

SECTIONS = [
    ("01", "项目背景与意义"),
    ("02", "应用场景与目标用户"),
    ("03", "要解决的实际问题"),
    ("04", "产品设计"),
    ("05", "技术方案"),
    ("06", "实现过程"),
    ("07", "创新点与优势"),
    ("08", "测试与质量保证"),
    ("09", "推广应用前景"),
    ("10", "引用与开源说明"),
    ("附", "运行方式与演示账号"),
]


def render(out: pathlib.Path) -> None:
    env = {k: v for k, v in os.environ.items()
           if k.lower() not in ("http_proxy", "https_proxy", "all_proxy")}
    subprocess.run(
        [
            CHROME, "--headless=new", "--no-sandbox", "--disable-gpu",
            "--user-data-dir=" + str(BASE / ".chrome-doc"),
            "--no-pdf-header-footer", "--virtual-time-budget=8000",
            f"--print-to-pdf={out}", HTML.as_uri(),
        ],
        check=True, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def find_pages(pdf: pathlib.Path) -> dict[str, int]:
    doc = pymupdf.open(pdf)
    pages: dict[str, int] = {}
    for key, title in SECTIONS:
        # 目录页本身也有这些字，从第 3 页开始找
        for i in range(2, doc.page_count):
            if title in doc[i].get_text():
                pages[key] = i + 1
                break
        else:
            pages[key] = 0
    doc.close()
    return pages


def write_numbers(pages: dict[str, int]) -> None:
    html = HTML.read_text(encoding="utf-8")
    for key, page in pages.items():
        html = re.sub(
            rf'<span class="pg" data-p="{re.escape(key)}">[^<]*</span>',
            f'<span class="pg" data-p="{key}">{page or "–"}</span>',
            html,
        )
    HTML.write_text(html, encoding="utf-8")


def stamp_footer(pdf: pathlib.Path) -> None:
    doc = pymupdf.open(pdf)
    total = doc.page_count
    for i, page in enumerate(doc):
        if i == 0:            # 封面不写
            continue
        text = f"第 {i + 1} 页 / 共 {total} 页"
        w, h = page.rect.width, page.rect.height
        page.insert_text(
            (w / 2 - 42, h - 26), text,
            fontname="china-s", fontsize=8.5, color=(0.45, 0.44, 0.39),
        )
    doc.saveIncr()
    doc.close()


def main() -> None:
    tmp = BASE / "_pass1.pdf"
    render(tmp)
    pages = find_pages(tmp)
    print("分页：", pages)
    write_numbers(pages)
    render(PDF)
    tmp.unlink(missing_ok=True)
    stamp_footer(PDF)
    doc = pymupdf.open(PDF)
    print(f"完成：{doc.page_count} 页，{PDF.stat().st_size / 1024 / 1024:.1f} MB")
    doc.close()


if __name__ == "__main__":
    main()
