# Text to Roadmap

A minimal text-to-diagram editor for chapter mind maps. Paste a structured outline, click **Generate Roadmap**, and download the complete diagram on **one A4 PDF page**.

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

**Download A4 PDF** exports the full map, including content outside the viewport. It uses exactly one A4 page, chooses portrait or landscape for the best fit, keeps 8 mm margins, and includes no application header or footer. Large maps scale down to stay on one page. The PDF contains a high-resolution raster of the diagram; formulas are rendered with embedded KaTeX fonts.

## Verification

```sh
npm test
npm run test:e2e
npm run build
```

The browser suite uses installed Chrome on Windows, or Playwright Chromium elsewhere (`npx playwright install chromium`).

This is an independent implementation using React Flow and KaTeX, with UI and visual structure based on roadmap.sh's publicly observable editor. No private editor package is required.
