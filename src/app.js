import { CadViewer } from './cad-viewer.js';

const DAC_BASE = 'https://raw.githubusercontent.com/SuberBAbdi/DAC-using-PIC16F877A-Temperature-Scanner/main/3D%20and%202D%20Models%20/3D%20Model%20of%20PCB/';
const MODELS = {
  assembly: `${DAC_BASE}Temperature%20Checker%20with%20a%20DAC.glb`,
  cover: `${DAC_BASE}Cover%20Body.glb`,
  lower: `${DAC_BASE}Lower%20Body.glb`
};

const root = document.getElementById('cadViewer');
const viewer = new CadViewer(root);

// The standalone viewer starts on the complete assembly. Individual GLBs remain
// available in the configuration so the host portfolio can select them later
// without changing the viewer implementation.
viewer.load(MODELS.assembly).catch(() => {});

// Keep the interaction shield useful for normal page scrolling. The controls
// themselves stay above the shield, so Filter, Home, Full screen and the cube
// remain usable without first enabling canvas interaction.
viewer.setInteractive(false);

window.addEventListener('pagehide', () => viewer.dispose(), { once: true });
