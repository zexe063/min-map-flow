# Text to Roadmap

A minimal text-to-diagram editor for chapter mind maps. Paste a structured outline, click **Generate Roadmap**, and download the complete diagram as a vector PDF.

```sh
npm install
npm run dev
```

Open the localhost address printed by Vite.

## Outline format

```text
# Motion in a straight line
## Describing motion
### Displacement
- Change in position
- $\Delta x = x_f - x_i$
### Velocity
- Average velocity
$$\bar v = \frac{\Delta x}{\Delta t}$$
```

Use one `#` title, `##` section labels, `###` topics, and `-` subtopics. Pasted enclosing code fences are accepted. KaTeX supports `$inline math$` and `$$display math$$`, including multiline display equations. Incorrect outline structure reports a line number and leaves the current diagram intact.

The canvas uses a central sequence of topics, alternating side branches, bright yellow topic cards, and pale yellow subtopics. Child connections use React Flow's built-in Bézier curves. Dotted blue lines mark the start and end. Child stacks have even spacing and are centered beside their parent topics. Drag cards to adjust the layout; use the canvas controls to zoom or fit the map. Regenerating replaces the current diagram with the pasted outline.

Text drafts, the current map, and manually adjusted positions save in this browser. Existing stored chapter collections are preserved when upgrading from the earlier studio UI. There is no account, backend, or built-in AI.

The interface, diagram labels, and ordinary math letters and numbers use the supplied **CoFo Sans Regular** font. KaTeX retains the specialist glyphs and geometry for large operators, delimiters, accents, and explicitly styled math alphabets. Scientific font fallbacks cover characters absent from CoFo, including `θ`, `⁻`, and `ₙ`. The PDF embeds the same font faces used on screen.

**Download PDF** creates a file directly in your browser. The continuous page is **256 mm wide**, similar to roadmap.sh's downloadable roadmaps, with 12 mm margins and a height that follows the complete diagram. Longer maps keep the same text size instead of shrinking to fit A4. Cards, curves, and formulas are drawn as vector content with embedded fonts and selectable text. The export uses the rendered card positions and line wrapping, including manually moved cards. There is no print dialog, screenshot conversion, upload, or server requirement. Your browser saves the PDF using its normal download settings.

## Verification

```sh
npm test
npm run test:e2e
npm run build
```

The browser suite uses installed Chrome on Windows, or Playwright Chromium elsewhere (`npx playwright install chromium`).

This is an independent implementation using React Flow and KaTeX, with UI and visual structure based on roadmap.sh's publicly observable editor. No private editor package is required.
