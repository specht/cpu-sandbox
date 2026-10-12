"""Builds web/vendor/fonts/Segment7-Bold.woff, the 7-segment font of the
number display, from the DSEG7 Classic Bold outlines by keshikan
(https://github.com/keshikan/DSEG, SIL Open Font License 1.1). Only the
glyphs a number display needs: 0-9, "-", space and "!" (a blank digit). The
license reserves the name "DSEG", so the result is called Segment7.

    git clone https://github.com/keshikan/DSEG
    node -e "const fs=require('fs'), t=fs.readFileSync('DSEG/resources/DSEG7/template.txt','utf8'),
      d=require('./DSEG/resources/DSEG7/data.json')['DSEG7Classic-Bold.sfd'];
      let r=t; for (const p in d) r=r.split('\${'+p+'}').join(d[p]); fs.writeFileSync('c7.sfd', r)"
    python3 scripts/segment7-font.py c7.sfd web/vendor/fonts/Segment7-Bold.woff   (needs fonttools)
"""
import sys
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.transformPen import TransformPen

source, target = sys.argv[1], sys.argv[2]
glyphs, current = {}, None
for line in open(source, encoding='utf8'):
    line = line.rstrip('\n')
    if line.startswith('StartChar: '):
        current = {'name': line[11:], 'width': 0, 'contours': [], 'refs': [], 'gid': None, 'unicode': -1}
    elif current is None:
        continue
    elif line.startswith('Encoding: '):
        enc, uni, gid = line[10:].split()[:3]
        current['gid'], current['unicode'] = int(gid), int(uni)
    elif line.startswith('Width: '):
        current['width'] = int(line[7:])
    elif line.startswith('Refer: '):
        parts = line[7:].split()
        current['refs'].append((int(parts[0]), [float(v) for v in parts[3:9]]))
    elif line == 'SplineSet':
        current['spline'] = True
    elif line == 'EndSplineSet':
        current['spline'] = False
    elif current.get('spline'):
        tokens = line.split()
        if not tokens:
            continue
        op = tokens[-2]
        nums = [float(v) for v in tokens[:-2]]
        if op == 'm':
            current['contours'].append([('m', nums)])
        else:
            current['contours'][-1].append((op, nums))
    elif line == 'EndChar':
        glyphs[current['gid']] = current
        current = None

by_unicode = {g['unicode']: g for g in glyphs.values()}


def draw(glyph, pen):
    for contour in glyph['contours']:
        for op, nums in contour:
            if op == 'm':
                pen.moveTo(tuple(nums))
            elif op == 'l':
                pen.lineTo(tuple(nums))
            elif op == 'c':
                pen.curveTo(tuple(nums[0:2]), tuple(nums[2:4]), tuple(nums[4:6]))
        pen.closePath()
    for gid, matrix in glyph['refs']:
        draw(glyphs[gid], TransformPen(pen, matrix))


wanted = {'space': 0x20, 'exclam': 0x21, 'hyphen': 0x2D, **{name: 0x30 + i for i, name in enumerate(
    ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'])}}
order = ['.notdef', *wanted]
charstrings, metrics = {}, {}
width8 = by_unicode[0x38]['width']
for name in order:
    pen = T2CharStringPen(width8, None)
    if name != '.notdef':
        glyph = by_unicode[wanted[name]]
        draw(glyph, pen)
        metrics[name] = (glyph['width'], 0)
    else:
        metrics[name] = (width8, 0)
    charstrings[name] = pen.getCharString()

fb = FontBuilder(1000, isTTF=False)
fb.setupGlyphOrder(order)
fb.setupCharacterMap({code: name for name, code in wanted.items()})
names = {
    'familyName': 'Segment7', 'styleName': 'Bold', 'fullName': 'Segment7 Bold', 'psName': 'Segment7-Bold',
    'copyright': 'Copyright (c) 2020, keshikan (https://www.keshikan.net), with Reserved Font Name "DSEG". '
                 'Segment7 is a subset of DSEG7 Classic Bold, converted for the CPU Sandbox.',
    'licenseDescription': 'This Font Software is licensed under the SIL Open Font License, Version 1.1.',
    'licenseInfoURL': 'https://openfontlicense.org',
}
fb.setupNameTable(names)
fb.setupCFF('Segment7-Bold', {'FullName': 'Segment7 Bold'}, charstrings, {})
fb.setupHorizontalMetrics(metrics)
fb.setupHorizontalHeader(ascent=1000, descent=0)
fb.setupOS2(sTypoAscender=1000, sTypoDescender=0, usWinAscent=1000, usWinDescent=0, usWeightClass=700)
fb.setupPost()
fb.font.flavor = 'woff'
fb.save(target)
print('widths', {n: metrics[n][0] for n in order})
