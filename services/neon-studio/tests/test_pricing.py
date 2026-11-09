import math
import unittest
from decimal import Decimal
from neon_pricing import calculate

class PricingTests(unittest.TestCase):
    def quote(self, **changes):
        request={'items':[{'width_cm':60,'height_cm':13.02,'neon_m':2.3838}]}
        request.update(changes)
        return calculate(request)

    def test_minimum_applies_to_defaults_and_old_zero_input(self):
        for settings in ({},{'minimum_shipping_usd':0},{'minimum_shipping_usd':20}):
            q=self.quote(**settings)
            self.assertEqual(q['shipping_usd'],'45')
            self.assertEqual(q['production_usd'],'37')
            self.assertEqual(q['total_usd'],'82')
        self.assertEqual(self.quote(minimum_shipping_usd=60)['shipping_usd'],'60')

    def test_fractional_cent_and_customer_price_round_up(self):
        q=self.quote(items=[{'width_cm':83,'height_cm':52.29,'neon_m':6.829}])
        self.assertEqual((q['production_usd'],q['shipping_usd'],q['total_usd']),('106','84','190'))
        self.assertEqual(q['customer_price']['amount_eur'],'437')
        q=self.quote(items=[{'width_cm':20,'height_cm':20,'neon_m':'5.00001'}])
        self.assertEqual(q['production_usd'],'78')
        self.assertEqual(q['customer_price']['amount_eur'],'283')

    def test_rates_loss_outdoor_and_power_supplies(self):
        for color,rate in [('single',14),('rgb',20),('chasing_rgb',28)]:
            q=self.quote(items=[{'width_cm':80,'height_cm':25,'neon_m':5,'color':color,'outdoor':True,'waterproof_psus':2}])
            self.assertEqual(Decimal(q['production_usd']),math.ceil(Decimal(5)*Decimal('1.1')*rate*Decimal('1.2')+50))
            self.assertEqual(q['items'][0]['material_m'],'5.5')

    def test_volume_and_oversize_per_package(self):
        q=self.quote(items=[{'width_cm':120,'height_cm':30,'neon_m':5}])
        self.assertEqual(q['packages'][0]['dimensions_cm'],['130','40','6'])
        self.assertEqual(q['shipping_usd'],'95')
        q=self.quote(items=[{'width_cm':50,'height_cm':20,'neon_m':1}]*2)
        self.assertEqual(q['shipping_usd'],'90')
        q=self.quote(items=[{'width_cm':50,'height_cm':20,'neon_m':1}]*2,packing='stacked')
        self.assertEqual(len(q['packages']),1)
        self.assertEqual(q['packages'][0]['dimensions_cm'],['60','30','10'])
        self.assertEqual(q['shipping_usd'],'45')

    def test_optional_extras_are_provisional_and_not_multiplied_by_loss_or_outdoor(self):
        item={'width_cm':60,'height_cm':13.02,'neon_m':2,'color':'rgb','outdoor':True,'waterproof_psus':1}
        base=self.quote(items=[item])
        q=self.quote(items=[{**item,'uv_print':True,'controllers':2}])
        self.assertEqual(Decimal(q['production_usd'])-Decimal(base['production_usd']),60)
        self.assertEqual(q['items'][0]['uv_print_usd'],'30.00')
        self.assertEqual(q['items'][0]['controller_usd'],'30.00')
        self.assertIn('uv_print_rate_provisional',q['assumptions'])
        self.assertIn('controller_rate_provisional',q['assumptions'])
        self.assertNotIn('controller_rate_provisional',base['assumptions'])
        for changes in ({'uv_print':'yes'},{'controllers':.5},{'controllers':-1}):
            with self.assertRaises(ValueError):self.quote(items=[{**item,**changes}])
