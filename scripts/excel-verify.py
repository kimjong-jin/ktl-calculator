#!/usr/bin/env python3
"""
excel-verify.py — Version11_(2026).xlsx 수식을 그대로 Python 재현하여 검증
Excel이 없어도 셀 수식 구조를 완전히 재현합니다.

사용:
  python3 scripts/excel-verify.py --code TOC --z1 5 --z2 3 --z3 9.049 --z4 0.05 --z5 11 --range 100
  python3 scripts/excel-verify.py --code pH --vals 6.97 6.98 6.99 4.01 4.00 4.02
"""
import sys, math, statistics, argparse

# ── 엑셀 STDEV (표본 표준편차, n-1) ──────────────────────────────
def excel_stdev(*vals):
    v = [x for x in vals if x is not None]
    if len(v) < 2: return None
    return statistics.stdev(v)

def excel_round(val, digits):
    """엑셀 ROUND — 0.5는 올림"""
    if val is None: return None
    factor = 10 ** digits
    return math.floor(val * factor + 0.5) / factor

# ── 최악 조합 STDEV 선택 (D27~D30 로직) ─────────────────────────
def worst_stdev_combo(z5, init1, init2, fin1, fin2):
    """
    엑셀: MAX(STDEV(Z5,Z_init1,Z_fin1), STDEV(Z5,Z_init1,Z_fin2),
               STDEV(Z5,Z_init2,Z_fin1), STDEV(Z5,Z_init2,Z_fin2))
    """
    combos = [
        (z5, init1, fin1),
        (z5, init1, fin2),
        (z5, init2, fin1),
        (z5, init2, fin2),
    ]
    results = []
    for c in combos:
        s = excel_stdev(*c)
        if s is not None:
            results.append(s)
    return max(results) if results else None

# ── 항목별 반복성 계산 ─────────────────────────────────────────
def calc_repeatability(code, z1, z2, z3, z4, z5, s1, s2, s3, s4, s5, rng):
    """
    TOC/TN/TP/SS/COD:
      D40 = ROUND(MAX(STDEV(D37:D39), STDEV(F37:F39)) / range * 100, 1)
      D37:D39 = [Z5, worst_Z_init, worst_Z_fin]
      F37:F39 = [S5, worst_S_init, worst_S_fin]
      F40: D40 > 3 → 부적합
    """
    code = code.upper()

    if code in ('TOC', 'TN', 'TP', 'SS', 'COD'):
        if rng == 0 or rng is None:
            return {'error': 'range=0'}
        ws_z = worst_stdev_combo(z5, z1, z2, z3, z4)
        ws_s = worst_stdev_combo(s5, s1, s2, s3, s4)
        if ws_z is None or ws_s is None:
            return {'error': '입력값 부족'}
        max_s = max(ws_z, ws_s)
        rsd = excel_round(max_s / rng * 100, 1)
        return {
            'code': code,
            'STDEV_Z': round(ws_z, 6),
            'STDEV_S': round(ws_s, 6),
            'RSD_raw': round(max_s / rng * 100, 6),
            'RSD': rsd,
            '판정': '적 합' if rsd is not None and rsd <= 3 else '부적합',
            '기준': 'RSD ≤ 3%',
        }

    elif code == 'PH':
        # T40 = ROUND(MAX(STDEV(T37:T39), STDEV(V37:V39)), 2)
        # T37:T39 = pH 7 측정값 3회, V37:V39 = pH 4 측정값 3회
        # 인수: --vals ph7_1 ph7_2 ph7_3 ph4_1 ph4_2 ph4_3
        return {'error': 'pH는 --vals 6개 값으로 입력하세요 (pH7 3회, pH4 3회)'}

    elif code == 'DO':
        # Z40 = ROUND(STDEV(Z37:Z39), 2)
        # Z37:Z39 = DO 측정값 3회 (mg/L)
        # AB40: Z40 > 0.3 → 부적합
        return {'error': 'DO는 --vals 3개 값으로 입력하세요'}

    else:
        return {'error': f'미지원 항목: {code}'}

def calc_ph_repeat(ph7_vals, ph4_vals):
    """pH 반복성: STDEV(pH7 3회), STDEV(pH4 3회) 중 MAX ≤ 0.1"""
    s7 = excel_stdev(*ph7_vals)
    s4 = excel_stdev(*ph4_vals)
    if s7 is None or s4 is None:
        return {'error': '입력값 부족 (pH7 3회, pH4 3회 필요)'}
    max_s = max(s7, s4)
    rsd = excel_round(max_s, 2)
    return {
        'code': 'pH',
        'STDEV_pH7': round(s7, 6),
        'STDEV_pH4': round(s4, 6),
        'MAX_STDEV': round(max_s, 6),
        'T40': rsd,
        '판정': '적 합' if rsd is not None and rsd <= 0.1 else '부적합',
        '기준': 'MAX_STDEV ≤ 0.1 pH',
    }

def calc_do_repeat(do_vals):
    """DO 반복성: STDEV ≤ 0.3 mg/L"""
    s = excel_stdev(*do_vals)
    if s is None:
        return {'error': '입력값 부족 (3개 필요)'}
    rsd = excel_round(s, 2)
    return {
        'code': 'DO',
        'STDEV': round(s, 6),
        'Z40': rsd,
        '판정': '적 합' if rsd is not None and rsd <= 0.3 else '부적합',
        '기준': 'STDEV ≤ 0.3 mg/L',
    }

# ── CLI ──────────────────────────────────────────────────────────
def main():
    p = argparse.ArgumentParser(description='엑셀 반복성 수식 검증')
    p.add_argument('--code', default='TOC',
                   help='항목코드: TOC/TN/TP/SS/COD/pH/DO')
    p.add_argument('--z1', type=float, default=None)
    p.add_argument('--z2', type=float, default=None)
    p.add_argument('--z3', type=float, default=None)
    p.add_argument('--z4', type=float, default=None)
    p.add_argument('--z5', type=float, default=None)
    p.add_argument('--s1', type=float, default=None)
    p.add_argument('--s2', type=float, default=None)
    p.add_argument('--s3', type=float, default=None)
    p.add_argument('--s4', type=float, default=None)
    p.add_argument('--s5', type=float, default=None)
    p.add_argument('--range', type=float, default=None, dest='rng')
    p.add_argument('--vals', nargs='+', type=float, default=None,
                   help='pH: 7측정3개 + 4측정3개 / DO: 측정3개')
    args = p.parse_args()

    code = args.code.upper()

    if code == 'PH':
        if not args.vals or len(args.vals) < 6:
            print('pH: --vals ph7_1 ph7_2 ph7_3 ph4_1 ph4_2 ph4_3 (6개)'); sys.exit(1)
        result = calc_ph_repeat(args.vals[:3], args.vals[3:6])
    elif code == 'DO':
        if not args.vals or len(args.vals) < 3:
            print('DO: --vals do1 do2 do3 (3개)'); sys.exit(1)
        result = calc_do_repeat(args.vals[:3])
    else:
        missing = [f for f in ['z1','z2','z3','z4','z5'] if getattr(args, f) is None]
        if missing:
            print(f'누락: {missing}'); sys.exit(1)
        result = calc_repeatability(
            code,
            args.z1, args.z2, args.z3, args.z4, args.z5,
            args.s1, args.s2, args.s3, args.s4, args.s5,
            args.rng
        )

    import json
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
