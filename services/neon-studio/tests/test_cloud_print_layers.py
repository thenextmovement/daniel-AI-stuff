import io
import unittest
from PIL import Image
from cloud_ai import drawing_model, Review
from geometry import build_geometry
from cloud_exports import technical_image, mockup_image
from neon_pricing import drawing_price


class PrintLayersTest(unittest.TestCase):
    def drawing(self, mode):
        svg='''<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="80mm" viewBox="0 0 100 80">
        <path id="neon" fill="none" stroke="blue" d="M0 0 L100 0 L100 40"/>
        <path id="footer" fill="red" stroke="none" d="M0 60 L100 60 L100 80 L0 80 Z"/>
        </svg>'''
        model, modes=drawing_model({'svg':svg,'uv_print':mode=='uv', 'line_plan':[
            {'name':'Neon','mode':'single','path_ids':['neon']},
            {'name':'Unterzeile','mode':mode,'path_ids':['footer']}]})
        return build_geometry(model,{'scale':1,'mode':'single','partModes':modes,'shape':'rectangle','gap':15})

    def test_print_footer_is_visible_and_supports_board_without_neon_length(self):
        for mode in ('uv','plot'):
            with self.subTest(mode=mode):
                d=self.drawing(mode)
                self.assertEqual(len(d['paths']),1)
                self.assertAlmostEqual(d['neonMeters'],.14,places=3)
                self.assertGreater(d['height'],100)
                self.assertIsNotNone(d['uv'])
                for render in (technical_image,mockup_image):
                    im=Image.open(io.BytesIO(render(d))).convert('RGB')
                    self.assertGreater(sum(r>180 and g<80 and b<80 for r,g,b in im.getdata()),1000)
                self.assertEqual(drawing_price(d,{})['items'][0]['uv_print'],mode=='uv')

    def test_uv_claim_without_print_paths_is_rejected(self):
        with self.assertRaisesRegex(Review,'sichtbare Fläche'):
            drawing_model({'svg':'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><path id="n" d="M0 0L100 40" fill="none" stroke="blue"/></svg>',
                           'uv_print':True,'line_plan':[{'name':'Neon','mode':'single','path_ids':['n']}]})

if __name__=='__main__':unittest.main()
