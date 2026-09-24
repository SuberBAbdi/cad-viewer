import { CadViewer } from './cad-viewer.js';

const DAC_BASE = 'https://raw.githubusercontent.com/SuberBAbdi/DAC-using-PIC16F877A-Temperature-Scanner/main/3D%20and%202D%20Models%20/3D%20Model%20of%20PCB/';
const MODELS = {
  assembly: `${DAC_BASE}Temperature%20Checker%20with%20a%20DAC.glb`,
  cover: `${DAC_BASE}Cover%20Body.glb`,
  lower: `${DAC_BASE}Lower%20Body.glb`
};

const root = document.getElementById('cadViewer');
const viewer = new CadViewer(root);

viewer.load(MODELS.assembly).then(() => {
  // Deliberately begin looking straight at the model's top, with no arbitrary
  // diagonal camera orientation. All later navigation is handled by the viewer.
  viewer.setView('top');
}).catch(() => {});

// Canvas interaction is opt-in so normal page scrolling is never hijacked.
// The black shield sits only over the render surface; toolbar, layer panel and
// orientation controls remain above it and remain usable.
viewer.setInteractive(false);

document.addEventListener('pointerdown', event => {
  if (viewer.interactive && !root.contains(event.target)) viewer.setInteractive(false);
});

window.addEventListener('pagehide', () => viewer.dispose(), { once: true });
