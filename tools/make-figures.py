#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""tools/make-figures.py — 把 make-figures.mjs 抓的「全景 + 剖面」原图合成带文字讲解的示例图

用法（在 alpa-board-gen 目录下）：
    python tools/make-figures.py

输出：preview/fig-board.png / fig-cone.png / fig-box.png
依赖：Pillow（DSH 自带 Python 已含），Windows 字体 msyh.ttc / msyhbd.ttc
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "tools", "out")
DST = os.path.join(ROOT, "preview")
FONT = r"C:\Windows\Fonts\msyh.ttc"
FONTB = r"C:\Windows\Fonts\msyhbd.ttc"

W, H_NOTES, H_PLAIN = 2200, 1240, 1040
PANEL_W, PANEL_H = 960, 720
PAD = 90
BG = (255, 255, 255)
INK = (17, 24, 39)
SUB = (55, 65, 81)
ACC = (14, 116, 144)
PANEL_BG = (246, 248, 250)
PANEL_LINE = (226, 232, 240)

MODES = [
    {
        "key": "board",
        "zoom": 0.80,
        "num": "①",
        "where": "单板 · ALPA 镜头板",
        "sub": "板体 3 mm · 外形 88.5 × 88.5 · 相机侧自适应凸台 0–5 mm · 镜头侧 Ø35 圆孔或内螺纹",
        "bullets": [
            "凸台根部固定 Ø75.08，尖端 = 孔/螺纹大径 + 6 mm（M65 → Ø71，Ø35 孔 → Ø41），锥角自动（默认 ≈45.6°）",
            "内螺纹 ISO 基本牙型，配合间隙把牙顶牙根一起外移（默认 +0.15），螺纹贯通板体 + 凸台",
            "两种板型：标准板（82.5 段平台阶）/ 锥面板（82.5 → 88.5 斜锥过渡），外观同为 88.5 方 R8",
        ],
    },
    {
        "key": "cone",
        "zoom": 0.86,
        "num": "②",
        "where": "锥形延长 · 顶端 M42×1",
        "sub": "板体 3 mm + 外锥/内锥锥筒 + 顶端螺纹 · 默认延长 20 mm（总高 23 mm）",
        "bullets": [
            "外锥 Ø80 → Ø52（顶端环宽恒 5 mm），外锥根部可调 60–86.5 mm",
            "内锥根部由外锥斜率反推，与外锥等壁厚 8.89 mm；M42 时 Ø66.4 → Ø41.2",
            "顶端内螺纹可换 13 种规格，深度可调（默认 5 mm ≈ 5 圈），孔口带倒角",
        ],
    },
    {
        "key": "box",
        "zoom": 0.98,
        "num": "③",
        "where": "方箱延长 · ALPA 猪嘴 130 mm",
        "sub": "底板 3 mm + 四面方桶 + 顶板 3 mm · 总长 130（默认 20）· 顶面 M65×1 贯通",
        "bullets": [
            "外 88.5 阶梯切角、内腔 76 方；调壁厚只影响桶身，底板外形与开口固定不变",
            "内壁四面光陷阱凹台：深 1.25 / 宽 46.7 / 45° 倒角收口，贯通方桶全长",
            "与参考件 ALPA猪嘴 130mm延长.3mf 对齐：体积 201.47 vs 201.95 cm³（−0.24 %）",
        ],
    },
]


def font(size, bold=False):
    for path in ((FONTB, FONT) if bold else (FONT,)):
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                pass
    return ImageFont.load_default()


def load_trimmed(path, zoom):
    """读取全景/剖面原图，裁成 4:3 居中区域（与面板同比例），再按 zoom 收紧"""
    im = Image.open(path).convert("RGB")
    w, h = im.size
    if w * 3 > h * 4:
        ch, cw = h, int(h * 4 / 3)
    else:
        cw, ch = w, int(w * 3 / 4)
    cw, ch = int(cw * zoom), int(ch * zoom)
    left, top = (w - cw) // 2, (h - ch) // 2
    return im.crop((left, top, left + cw, top + ch))


def fit(im, box_w, box_h):
    """等比缩放到 box 内，居中贴在高斯底板上"""
    im = im.copy()
    im.thumbnail((box_w, box_h), Image.LANCZOS)
    return im


def compose(spec, notes=True, out_dir=None):
    H = H_NOTES if notes else H_PLAIN
    canvas = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(canvas)

    f_num = font(40, True)
    f_title = font(48, True)
    f_sub = font(25)
    f_cap = font(25, True)
    f_bul = font(23)

    # 顶部标题
    num_w = d.textlength(spec["num"], font=f_num)
    d.text((PAD, 44), spec["num"], font=f_num, fill=ACC)
    d.text((PAD + num_w + 20, 40), spec["where"], font=f_title, fill=INK)
    d.line([(PAD, 128), (PAD + 118, 128)], fill=ACC, width=4)
    d.text((PAD, 146), spec["sub"], font=f_sub, fill=SUB)

    # 两张图
    y0 = 210
    for idx, (suffix, caption) in enumerate((("-iso", "全景 · 等轴视图"), ("-section", "剖面 · 沿光轴剖切"))):
        src = os.path.join(SRC, "fig-%s%s.png" % (spec["key"], suffix))
        if not os.path.exists(src):
            raise SystemExit("缺少原图：" + src + "\n先运行 node tools/make-figures.mjs")
        im = fit(load_trimmed(src, spec["zoom"]), PANEL_W, PANEL_H)
        x0 = PAD + idx * (PANEL_W + (W - 2 * PAD - 2 * PANEL_W))
        # 底板 + 描边
        d.rounded_rectangle([x0, y0, x0 + PANEL_W, y0 + PANEL_H], radius=14, fill=PANEL_BG, outline=PANEL_LINE, width=2)
        canvas.paste(im, (x0 + (PANEL_W - im.width) // 2, y0 + (PANEL_H - im.height) // 2))
        cap_w = d.textlength(caption, font=f_cap)
        d.text((x0 + (PANEL_W - cap_w) / 2, y0 + PANEL_H + 18), caption, font=f_cap, fill=INK)

    # 底部要点（--no-notes 时省略）
    if notes:
        y = y0 + PANEL_H + 78
        for b in spec["bullets"]:
            d.ellipse([PAD, y + 10, PAD + 9, y + 19], fill=ACC)
            d.text((PAD + 26, y), b, font=f_bul, fill=SUB)
            y += 46

    # 右下角角标
    tag = "ALPA 镜头板生成器"
    f_tag = font(20)
    tw = d.textlength(tag, font=f_tag)
    d.text((W - PAD - tw, H - 46), tag, font=f_tag, fill=(156, 163, 175))

    out = os.path.join(out_dir or DST, "fig-%s.png" % spec["key"])
    canvas.save(out, "PNG", optimize=True)
    print("saved %-42s %d x %d  %.0f KiB" % (out, W, H, os.path.getsize(out) / 1024))


def main():
    notes = "--no-notes" not in sys.argv
    out_dir = DST
    if "--out" in sys.argv:
        out_dir = sys.argv[sys.argv.index("--out") + 1]
    if not os.path.isabs(out_dir):
        out_dir = os.path.join(ROOT, out_dir)
    os.makedirs(out_dir, exist_ok=True)
    for spec in MODES:
        compose(spec, notes=notes, out_dir=out_dir)
    print("FIGURES OK: 3 张 %s → %s" % ("带讲解" if notes else "无讲解（纯图）", out_dir))


if __name__ == "__main__":
    main()
