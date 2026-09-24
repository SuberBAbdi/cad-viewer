# CAD Viewer

A standalone Three.js CAD viewer for the portfolio. The viewer is developed independently from the portfolio site so camera/navigation changes cannot break the portfolio.

## Architecture
- `index.html` — viewer shell and controls
- `src/cad-viewer.js` — self-contained viewer class
- `src/styles.css` — viewer UI
- `src/app.js` — model configuration and page wiring

The viewer loads the DAC project GLB assets directly from the source repository and is designed around a stable orbit target rather than camera-first rotation, so orbiting stays centered on the model.
