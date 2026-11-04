"""Line colours, independent of tracing geometry and physical measurements."""
import re

# Screen approximations of the user's neon range; white tubes use black ink.
NEON_COLORS = [
    dict(id='cold-white', name='Kaltweiß', english='Cool white', group='Weiß', color='#000000', swatch='#f5fbff'),
    dict(id='warm-white', name='Warmweiß', english='Warm white', group='Weiß', color='#000000', swatch='#ffe7b2'),
    dict(id='lemon-yellow', name='Zitronengelb', english='Lemon yellow', group='Gelb · Orange · Rot', color='#eedb16'),
    dict(id='gold-yellow', name='Goldgelb', english='Golden yellow', group='Gelb · Orange · Rot', color='#ffb800'),
    dict(id='orange', name='Orange', english='Orange', group='Gelb · Orange · Rot', color='#ff7a18'),
    dict(id='red', name='Rot', english='Red', group='Gelb · Orange · Rot', color='#ef3038'),
    dict(id='light-pink', name='Helles Pink', english='Light pink', group='Pink · Lila', color='#ff9ed6'),
    dict(id='pink', name='Pink', english='Pink', group='Pink · Lila', color='#f333a5'),
    dict(id='purple', name='Lila', english='Purple', group='Pink · Lila', color='#a45bef'),
    dict(id='dark-blue', name='Dunkelblau', english='Dark blue', group='Blau · Grün', color='#244de2'),
    dict(id='ice-blue', name='Eisblau', english='Ice blue', group='Blau · Grün', color='#66d8f5'),
    dict(id='light-green', name='Hellgrün', english='Light green', group='Blau · Grün', color='#83dc45'),
    dict(id='dark-green', name='Dunkelgrün', english='Dark green', group='Blau · Grün', color='#079b55'),
]
PALETTE = {item['id']: item for item in NEON_COLORS}


def valid_color(value):
    return isinstance(value, str) and (value in PALETTE or re.fullmatch(r'#[0-9a-fA-F]{6}', value) is not None)


def line_color(source='#1748bd', override=None):
    value = override or source
    if value in PALETTE:
        return {**PALETTE[value], 'source': source, 'automatic': override is None}
    rgb = [int(value[i:i+2], 16) for i in (1, 3, 5)]
    # Both black artwork and white artwork mean cool-white neon by convention.
    if max(rgb) - min(rgb) < 22 and (max(rgb) < 65 or min(rgb) > 225):
        return {**PALETTE['cold-white'], 'source': source, 'automatic': override is None}
    value = value.lower()
    return dict(id=value, name=('Original ' if override is None else 'Eigene Farbe ') + value.upper(),
                english=('Original ' if override is None else 'Custom ') + value.upper(),
                color=value, source=source, automatic=override is None)
