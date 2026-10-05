# Scientific Unicode PDF fonts

These complete fonts are bundled locally as PDF fallbacks. Export fetches the
local assets and embeds only the glyphs used by the document.

- **Noto Sans Regular** supplies literal superscript and subscript characters,
  including superscript minus (U+207B).
  Source: https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf
  License: [OFL-NotoSans.txt](OFL-NotoSans.txt).
- **Noto Sans Math Regular** supplies mathematical operators and arrows.
  Source: https://raw.githubusercontent.com/google/fonts/main/ofl/notosansmath/NotoSansMath-Regular.ttf
  License: [OFL-NotoSansMath.txt](OFL-NotoSansMath.txt).

Both fonts use the SIL Open Font License 1.1. Noto Sans Math does not include the
Unicode superscript/subscript block, so both fallbacks are needed.
