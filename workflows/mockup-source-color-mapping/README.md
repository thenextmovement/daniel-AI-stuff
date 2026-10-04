# TICKET-077 Mockup source color mapping

The production failure used two source designs with four Trello offer rows:

- Color_1 and Color_2: warm white, two sizes of design 1
- Color_3 and Color_4: orange, two sizes of design 2

The live workers selected Color_[designIndex + 1], so design 2 incorrectly
received Color_2 and became warm white. The separate vision fallback also
looked only at the first source, which could not correct that explicit slot
lock.

This patch keeps every existing generation and QC prompt unchanged. It changes
only the deterministic field-to-design lookup. Four offer rows are divided
into consecutive design groups, with a legacy direct-index fallback when later
rows are empty.

Production workflow IDs:

- T4mdDxLquLMJ6FMl
- qRa1lT7lgpoFlgVo
- eZg2Dn4yG6rsS79p

Run the regression test with:

    node workflows/mockup-source-color-mapping/test-source-color-mapping.mjs

