#!/usr/bin/env python3
"""tools/ref/extract_ref.py — 从 4 个参考件重新提取基准数据，生成 reference.json

用法（任一带 numpy 的 Python 3）：
    python tools/ref/extract_ref.py

只用标准库 + 可选 numpy；读取：
  E:\\banbulab\\alpa延长桶12mm.step
  E:\\banbulab\\alpa延长桶20mm.step
  E:\\banbulab\\ALPA_STANDARD_BOARD_M65 hf.3mf
  E:\\banbulab\\ALPA_STANDARD_BOARD_0.step

输出：tools/ref/reference.json（README 第 3 节与 tools/test-geometry.mjs 的基准）
"""
import json
import math
import os
import re
import sys
import zipfile

SRC = {
    "tube12": r"E:\banbulab\alpa延长桶12mm.step",
    "tube20": r"E:\banbulab\alpa延长桶20mm.step",
    "board_m65_3mf": r"E:\banbulab\ALPA_STANDARD_BOARD_M65 hf.3mf",
    "board_0_step": r"E:\banbulab\ALPA_STANDARD_BOARD_0.step",
    "extension": r"E:\banbulab\M42lens to ALPA.step",
    "box130": r"E:\banbulab\ALPA猪嘴 130mm延长.step",
}
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reference.json")


# ---------------------------------------------------------------- STEP 粗解析
def split_args(s):
    out, cur, depth, instr = [], [], 0, False
    for ch in s:
        if instr:
            if ch == "'":
                instr = False
            cur.append(ch)
            continue
        if ch == "'":
            instr = True
            cur.append(ch)
            continue
        if ch == "(":
            depth += 1
            cur.append(ch)
            continue
        if ch == ")":
            depth -= 1
            cur.append(ch)
            continue
        if ch == "," and depth == 0:
            out.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
    if "".join(cur).strip():
        out.append("".join(cur).strip())
    return out


def ref(s):
    m = re.match(r"^#(\d+)$", s.strip())
    return int(m.group(1)) if m else None


def parse_step(path):
    txt = open(path, "r", encoding="utf-8", errors="replace").read()
    txt = re.sub(r"/\*.*?\*/", "", txt, flags=re.S)
    body = txt.split("DATA;", 1)[1].split("ENDSEC;")[0]
    ents, cur, depth, instr = {}, [], 0, False
    for ch in body:
        if instr:
            cur.append(ch)
            if ch == "'":
                instr = False
            continue
        if ch == "'":
            instr = True
            cur.append(ch)
            continue
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == ";" and depth == 0:
            s = "".join(cur).strip()
            cur = []
            if s:
                m = re.match(r"#(\d+)\s*=\s*([A-Za-z0-9_]+)\s*\((.*)\)\s*$", s, re.S)
                if m:
                    ents[int(m.group(1))] = (m.group(2), m.group(3))
        else:
            cur.append(ch)
    return ents


def step_summary(path):
    ents = parse_step(path)
    pts = []
    cyl = []
    for i, (t, a) in ents.items():
        if t == "VERTEX_POINT":
            v = split_args(a)
            pid = ref(v[1])
            if pid in ents and ents[pid][0] == "CARTESIAN_POINT":
                cp = split_args(ents[pid][1])
                pts.append(tuple(float(x) for x in split_args(cp[1][1:-1])))
        elif t == "CYLINDRICAL_SURFACE":
            v = split_args(a)
            cyl.append(round(float(v[2]), 4))
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    zs = [p[2] for p in pts]
    solids = [i for i, (t, a) in ents.items() if t == "MANIFOLD_SOLID_BREP"]
    return {
        "solids": len(solids),
        "bbox": {
            "min": [round(min(xs), 3), round(min(ys), 3), round(min(zs), 3)],
            "max": [round(max(xs), 3), round(max(ys), 3), round(max(zs), 3)],
        },
        "size": [round(max(xs) - min(xs), 3), round(max(ys) - min(ys), 3), round(max(zs) - min(zs), 3)],
        "cylinder_radii": sorted(set(cyl), reverse=True),
        "faces": sum(1 for t, _ in ents.values() if t == "ADVANCED_FACE"),
        "bsplines": sum(1 for t, _ in ents.values() if "B_SPLINE" in t),
    }


# ---------------------------------------------------------------- 3MF 网格
def mesh_summary(path):
    z = zipfile.ZipFile(path)
    name = [n for n in z.namelist() if n.endswith(".model") and "Objects" in n][0]
    data = z.read(name).decode("utf-8", "replace")
    verts = [(float(a), float(b), float(c)) for a, b, c in
             re.findall(r'<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/>', data)]
    tris = [(int(a), int(b), int(c)) for a, b, c in
            re.findall(r'<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"', data)]
    vol = 0.0
    edges = {}
    for (i, j, k) in tris:
        ax, ay, az = verts[i]
        bx, by, bz = verts[j]
        cx, cy, cz = verts[k]
        vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6.0
        for (u, v) in ((i, j), (j, k), (k, i)):
            key = (u, v) if u < v else (v, u)
            edges[key] = edges.get(key, 0) + 1
    counts = {}
    for c in edges.values():
        counts[c] = counts.get(c, 0) + 1
    xs = [p[0] for p in verts]
    ys = [p[1] for p in verts]
    zs = [p[2] for p in verts]
    # 螺纹：半径直方图 + 牙峰间距
    radii = [round(math.hypot(p[0], p[2]), 3) for p in verts]
    near = [r for r in radii if 31.5 < r < 33.5]
    hist = sorted(set(round(r, 1) for r in near))
    crest = [p for p in verts if 31.5 < math.hypot(p[0], p[2]) < 32.3]
    # 固定角度上牙顶的 z 间距 ≈ 牙距
    ys2 = sorted(set(round(p[1], 3) for p in crest))
    gaps = [round(ys2[i + 1] - ys2[i], 3) for i in range(len(ys2) - 1)]
    big = sorted(set(g for g in gaps if 0.5 < g < 1.6))
    return {
        "vertices": len(verts),
        "triangles": len(tris),
        "volume": round(vol, 2),
        "bbox": {"min": [round(min(xs), 3), round(min(ys), 3), round(min(zs), 3)],
                 "max": [round(max(xs), 3), round(max(ys), 3), round(max(zs), 3)]},
        "size": [round(max(xs) - min(xs), 3), round(max(ys) - min(ys), 3), round(max(zs) - min(zs), 3)],
        "edge_use_counts": {str(k): v for k, v in sorted(counts.items())},
        "watertight": counts == {2: len(edges)},
        "thread_radius_levels": hist,
        "pitch_candidates": big,
    }


def main():
    missing = [k for k, p in SRC.items() if not os.path.exists(p)]
    if missing:
        print("缺少参考件：" + ", ".join(missing))
        print("（参考件不在本机时，可直接使用已生成的 reference.json）")
        return 1

    out = {}
    for key in ("tube12", "tube20"):
        out[key] = step_summary(SRC[key])
        print(f"{key:14s} solids={out[key]['solids']} size={out[key]['size']}")
    out["board_m65_3mf"] = mesh_summary(SRC["board_m65_3mf"])
    b = out["board_m65_3mf"]
    print(f"board_m65_3mf  tris={b['triangles']} volume={b['volume']} size={b['size']} watertight={b['watertight']}")
    out["board_0_step"] = step_summary(SRC["board_0_step"])
    s = out["board_0_step"]
    print(f"board_0_step   solids={s['solids']} size={s['size']}")
    out["extension"] = step_summary(SRC["extension"])
    e = out["extension"]
    print(f"extension      solids={e['solids']} size={e['size']} cylinders={e['cylinder_radii']}")
    out["box130"] = step_summary(SRC["box130"])
    bx = out["box130"]
    print(f"box130         solids={bx['solids']} size={bx['size']} cylinders={bx['cylinder_radii']}")

    # 与 README/单测使用的基准核对
    checks = {
        "板 B 体积 13195.75 ±1": abs(b["volume"] - 13195.75) < 1.0,
        "板 B 水密": b["watertight"],
        "板 B 外形 88.5/5/88.5": b["size"] == [88.5, 5.0, 88.5],
        "板 A 外形 88.5/88.5/3": s["size"] == [88.5, 88.5, 3.0],
        "12mm 桶 X 宽 88.5": abs(out["tube12"]["size"][0] - 88.5) < 1e-6,
        "20mm 桶 Y 长 20": abs(out["tube20"]["size"][1] - 20.0) < 1e-6,
        "12mm 桶 Y 长 12": abs(out["tube12"]["size"][1] - 12.0) < 1e-6,
        "延长桶 总高 24.4": abs(out["extension"]["size"][2] - 24.4) < 1e-6,
        "延长桶 外形 88.5": abs(out["extension"]["size"][0] - 88.5) < 1e-6,
        "延长桶 螺纹半径": any(abs(r - 21.0786) < 1e-3 for r in out["extension"]["cylinder_radii"]),
        "方箱总长 130": abs(out["box130"]["size"][1] - 130.0) < 1e-6,
        "方箱外形 88.5": abs(out["box130"]["size"][0] - 88.5) < 1e-6 and abs(out["box130"]["size"][2] - 88.5) < 1e-6,
    }
    print("\n基准核对：")
    for k, v in checks.items():
        print(("  OK   " if v else "  FAIL ") + k)

    out["_checks"] = checks
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print("\n写入 " + OUT)
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
