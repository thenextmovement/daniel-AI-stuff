"""Convert pinned OFL fonts to local Three.js outlines.

Usage: python build-fonts.py SOURCE_DIRECTORY OUTPUT_DIRECTORY
Requires fonttools 4.60.1 and skia-pathops 0.9.2. Source metadata and licenses are retained alongside fonts.
"""
import json, sys, shutil, hashlib
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.ttLib.removeOverlaps import removeOverlaps
from fontTools.pens.basePen import BasePen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import DecomposingRecordingPen, replayRecording
from fontTools.pens.areaPen import AreaPen
from fontTools.pens.reverseContourPen import ReverseContourPen

source, output = map(Path, sys.argv[1:])
fonts = {
    'montserrat': ('Montserrat', 600), 'bebasneue': ('Bebas Neue', 400),
    'oswald': ('Oswald', 600), 'poppins': ('Poppins', 600),
    'lora': ('Lora', 600), 'cormorantgaramond': ('Cormorant Garamond', 600),
}
class OutlinePen(BasePen):
    def __init__(self, glyphset, scale):
        super().__init__(glyphset); self.scale=scale; self.commands=[]
    def numbers(self, *points):
        return ' '.join(str(round(v*self.scale, 3)).removesuffix('.0') for p in points for v in p)
    def _moveTo(self,p): self.commands.append('m '+self.numbers(p))
    def _lineTo(self,p): self.commands.append('l '+self.numbers(p))
    def _curveToOne(self,p1,p2,p3): self.commands.append('b '+self.numbers(p3,p1,p2))
    def _qCurveToOne(self,p1,p2): self.commands.append('q '+self.numbers(p2,p1))
    def _closePath(self): self.commands.append('z')
    def _endPath(self): pass

output.mkdir(parents=True,exist_ok=True)
manifest={'upstream':'https://github.com/google/fonts','commit':'47d54ca1ebb14fd864695f1d39dc734f39017c33','fonts':[]}
for key,(name,weight) in fonts.items():
    path=source/(key+'.ttf'); font=TTFont(path)
    # Lora declares a Reserved Font Name; the converted subset gets a distinct name.
    target='serif-soft' if key=='lora' else key
    family='NT Serif Soft' if key=='lora' else name
    license_text=(source/(key+'-OFL.txt')).read_text()
    if 'fvar' in font: font=instantiateVariableFont(font,{'wght':weight},inplace=False)
    # Variable fonts often store overlapping strokes; union them before extrusion.
    removeOverlaps(font)
    glyphset=font.getGlyphSet(); cap=BoundsPen(glyphset); glyphset[font.getBestCmap()[ord('H')]].draw(cap); scale=1000/cap.bounds[3]
    glyphs={}
    for code,glyphname in sorted(font.getBestCmap().items()):
        # Latin text, accents, punctuation, symbols and Euro; no unneeded Indic tables.
        if not (32<=code<=0x24f or 0x1e00<=code<=0x1eff or 0x2000<=code<=0x206f or code in [0x20ac,0x2122]):continue
        recording=DecomposingRecordingPen(glyphset); glyphset[glyphname].draw(recording)
        areas=[]; contour=[]
        for operation in recording.value:
            contour.append(operation)
            if operation[0] in ['closePath','endPath']:
                area=AreaPen(glyphset); replayRecording(contour,area); areas.append(area.value); contour=[]
        reverse=bool(areas and max(areas,key=abs)>0)
        pen=OutlinePen(glyphset,scale)
        recording.replay(ReverseContourPen(pen) if reverse else pen)
        glyphs[chr(code)]={'ha':round(glyphset[glyphname].width*scale,3),'o':' '.join(pen.commands)}
    info={'glyphs':glyphs,'familyName':family,'originalFamilyName':name,'copyright':license_text.split('This Font Software')[0].strip(),'licenseText':license_text,'resolution':1000,'boundingBox':{k:round(getattr(font['head'],k)*scale) for k in ['xMin','xMax','yMin','yMax']},'underlineThickness':round(font['post'].underlineThickness*scale),'ascender':round(font['hhea'].ascent*scale),'descender':round(font['hhea'].descent*scale),'cssFontWeight':str(weight),'cssFontStyle':'normal','license':target+'-OFL.txt'}
    (output/(target+'.json')).write_text(json.dumps(info,ensure_ascii=False,separators=(',',':'))+'\n')
    shutil.copy2(source/(key+'-OFL.txt'),output/(target+'-OFL.txt'))
    manifest['fonts'].append({'id':target,'family':family,'originalFamily':name,'weight':weight,'sourceSHA256':hashlib.sha256(path.read_bytes()).hexdigest(),'license':target+'-OFL.txt','glyphCount':len(glyphs)})
(output/'sources.json').write_text(json.dumps(manifest,indent=2)+'\n')
