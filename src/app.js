import { CadViewer } from './cad-viewer.js';

const DAC_BASE = 'https://raw.githubusercontent.com/SuberBAbdi/DAC-using-PIC16F877A-Temperature-Scanner/main/3D%20and%202D%20Models%20/3D%20Model%20of%20PCB/';
const MODELS = {
  assembly: `${DAC_BASE}Temperature%20Checker%20with%20a%20DAC.glb`,
  cover: `${DAC_BASE}Cover%20Body.glb`,
  lower: `${DAC_BASE}Lower%20Body.glb`
};

const root = document.getElementById('cadViewer');
const viewer = new CadViewer(root);

viewer.load(MODELS.assembly)
  .then(() => viewer.setView('top'))
  .catch(() => {});

// Normal page scrolling remains the default. The viewer is activated only
// when the user explicitly presses "Click to interact" or the black shield.
viewer.setInteractive(false);

document.addEventListener('pointerdown', event => {
  if (viewer.interactive && !root.contains(event.target)) {
    viewer.setInteractive(false);
  }
});

window.addEventListener('pagehide', () => viewer.dispose(), { once: true });

// Expose the model URLs for simple integration/testing without creating any
// additional global viewer state.
window.CAD_MODELS = Object.freeze(MODELS);
