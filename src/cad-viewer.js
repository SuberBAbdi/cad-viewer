import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/environments/RoomEnvironment.js';

const DEG = Math.PI / 180;
const REDUCED = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export class CadViewer {
  constructor(container) {
    this.container = container;
    this.canvas = container.querySelector('canvas');
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xdfe2e6);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.001, 100000);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.enableRotate = true;
    this.controls.enableZoom = true;
    this.controls.zoomToCursor = true;
    this.controls.rotateSpeed = 0.72;
    this.controls.panSpeed = 0.8;
    this.controls.zoomSpeed = 0.9;
    this.controls.minPolarAngle = 0;
    this.controls.maxPolarAngle = Math.PI;
    this.controls.minDistance = 0.01;
    this.controls.maxDistance = 100000;
    this.controls.target.set(0, 0, 0);

    this.model = null;
    this.modelCenter = new THREE.Vector3();
    this.modelRadius = 1;
    this.layerNodes = new Map();
    this.loader = new GLTFLoader();
    this.visible = true;
    this.renderQueued = false;
    this.animationFrame = 0;
    this.tween = null;
    this.disposed = false;
    this.interactive = true;

    this.ui = {
      cube: container.querySelector('#viewCube'),
      layerTree: container.querySelector('#layerTree'),
      layerPanel: container.querySelector('#layerPanel'),
      loading: container.querySelector('#loading'),
      loadingProgress: container.querySelector('#loadingProgress'),
      loadingText: container.querySelector('#loadingText'),
      error: container.querySelector('#error'),
      shield: container.querySelector('#interactionShield'),
      activate: container.querySelector('#activateButton'),
      filter: container.querySelector('#filterButton'),
      home: container.querySelector('#homeButton'),
      fullscreen: container.querySelector('#fullscreenButton')
    };

    this.bindUI();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.intersectionObserver = new IntersectionObserver(entries => {
      this.visible = entries[0]?.isIntersecting ?? true;
      if (this.visible) this.requestRender();
    }, { threshold: 0.01 });
    this.intersectionObserver.observe(container);

    this.canvas.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      this.ui.loading.hidden = false;
      this.ui.loadingText.textContent = 'Graphics context paused…';
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      const url = this.model?.userData?.sourceUrl;
      this.rebuildEnvironment();
      if (url) this.load(url); else this.ui.loading.hidden = true;
    });

    this.controls.addEventListener('change', () => this.requestRender());
    this.controls.addEventListener('start', () => {
      this.cancelTween();
      this.canvas.style.cursor = 'grabbing';
    });
    this.controls.addEventListener('end', () => { this.canvas.style.cursor = 'grab'; });
    this.canvas.style.cursor = 'grab';
    this.resize();
  }

  rebuildEnvironment() {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.requestRender();
  }

  bindUI() {
    this.ui.filter?.addEventListener('click', e => { e.stopPropagation(); this.toggleLayers(); });
    this.ui.home?.addEventListener('click', e => { e.stopPropagation(); this.goHome(); });
    this.ui.fullscreen?.addEventListener('click', e => { e.stopPropagation(); this.toggleFullscreen(); });
    this.ui.activate?.addEventListener('click', e => { e.stopPropagation(); this.setInteractive(true); });
    this.ui.shield?.addEventListener('click', () => this.setInteractive(true));
    containerButton(this.container, '#closeFilter', () => this.toggleLayers(false));
    containerButton(this.container, '#showAllButton', () => this.showAll());
    containerButton(this.container, '#isolateButton', () => this.isolateSelected());

    this.container.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation(); this.setView(el.dataset.view);
    }));
    this.container.querySelectorAll('[data-cube-action]').forEach(el => el.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation(); this.cubeAction(el.dataset.cubeAction);
    }));

    document.addEventListener('fullscreenchange', () => {
      const active = document.fullscreenElement === this.container;
      if (this.ui.fullscreen) this.ui.fullscreen.textContent = active ? 'Exit full screen' : 'Full screen';
      requestAnimationFrame(() => this.resize());
    });
    this.container.addEventListener('keydown', e => this.keyboard(e));
    this.container.tabIndex = 0;
  }

  setInteractive(active) {
    this.interactive = active;
    this.controls.enabled = active;
    this.ui.shield?.classList.toggle('active', !active);
    if (this.ui.activate) this.ui.activate.style.display = active ? 'none' : 'block';
  }

  toggleLayers(force) {
    const open = force === undefined ? !this.ui.layerPanel.classList.contains('open') : force;
    this.ui.layerPanel.classList.toggle('open', open);
    this.ui.layerPanel.setAttribute('aria-hidden', String(!open));
    this.ui.filter?.setAttribute('aria-expanded', String(open));
  }

  async toggleFullscreen() {
    try {
      if (document.fullscreenElement === this.container) await document.exitFullscreen();
      else await this.container.requestFullscreen?.();
    } catch (error) { console.warn('Fullscreen unavailable', error); }
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.requestRender();
  }

  requestRender() {
    if (!this.visible || this.disposed || this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      if (!this.visible || this.disposed) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.syncCube();
      if (this.tween) this.requestRender();
    });
  }

  async load(url) {
    this.disposeModel();
    this.cancelTween();
    this.ui.error.hidden = true;
    this.ui.loading.hidden = false;
    this.ui.loadingText.textContent = 'Loading model…';
    this.ui.loadingProgress.style.width = '0%';

    return new Promise((resolve, reject) => {
      this.loader.load(url, gltf => {
        this.model = gltf.scene;
        this.model.userData.sourceUrl = url;
        this.scene.add(this.model);
        this.prepareModel(this.model);
        this.buildLayers();
        this.frameModel();
        this.ui.loading.hidden = true;
        this.requestRender();
        resolve(this.model);
      }, progress => {
        if (progress.total > 0) {
          const pct = Math.round(progress.loaded / progress.total * 100);
          this.ui.loadingProgress.style.width = `${pct}%`;
          this.ui.loadingText.textContent = `Loading model… ${pct}%`;
        } else this.ui.loadingText.textContent = `Loading model… ${Math.round(progress.loaded / 1024 / 1024)} MB`;
      }, error => {
        console.error(error);
        this.ui.loading.hidden = true;
        this.ui.error.hidden = false;
        this.ui.error.innerHTML = '<strong>Unable to load the CAD model.</strong><br><br><button id="retryModel">Retry</button>';
        this.ui.error.querySelector('#retryModel').onclick = () => this.load(url);
        reject(error);
      });
    });
  }

  prepareModel(root) {
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    root.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
      node.frustumCulled = true;
    });
    if (maxDim > 100000 || maxDim < 0.0001) root.scale.setScalar(10 / maxDim);
  }

  disposeModel() {
    if (!this.model) return;
    this.scene.remove(this.model);
    this.model.traverse(node => {
      if (!node.isMesh) return;
      node.geometry?.dispose();
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      mats.forEach(mat => {
        if (!mat) return;
        for (const key of ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap','alphaMap']) mat[key]?.dispose?.();
        mat.dispose?.();
      });
    });
    this.model = null;
    this.layerNodes.clear();
  }

  frameModel() {
    if (!this.model) return;
    const box = new THREE.Box3().setFromObject(this.model);
    const center = box.getCenter(this.modelCenter);
    const size = box.getSize(new THREE.Vector3());
    this.modelRadius = Math.max(size.length() * 0.5, 0.01);
    this.controls.target.copy(center);
    const distance = this.modelRadius * 2.15;
    this.camera.position.copy(center).add(new THREE.Vector3(distance * 0.72, distance * 0.76, distance * 0.72));
    this.camera.up.set(0, 1, 0);
    this.camera.near = Math.max(this.modelRadius / 10000, 0.00001);
    this.camera.far = Math.max(this.modelRadius * 1000, 100);
    this.camera.lookAt(center);
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = Math.max(this.modelRadius * 0.08, 0.0001);
    this.controls.maxDistance = Math.max(this.modelRadius * 100, 100);
    this.controls.update();
    this.syncCube();
  }

  goHome() { this.navigateToDirection(new THREE.Vector3(1, 1, 1).normalize(), new THREE.Vector3(0, 1, 0)); }

  setView(view) {
    const views = {
      front:[0,0,-1,0,1,0], back:[0,0,1,0,1,0], right:[1,0,0,0,1,0], left:[-1,0,0,0,1,0],
      top:[0,1,0,0,0,-1], bottom:[0,-1,0,0,0,1],
      'top-front':[0,1,-1,0,1,0], 'bottom-front':[0,-1,-1,0,1,0],
      'front-right':[1,0,-1,0,1,0], 'front-left':[-1,0,-1,0,1,0],
      'back-right':[1,0,1,0,1,0], 'back-left':[-1,0,1,0,1,0],
      'top-back':[0,1,1,0,1,0], 'bottom-back':[0,-1,1,0,1,0],
      'top-front-right':[1,1,-1,0,1,0], 'top-front-left':[-1,1,-1,0,1,0],
      'top-back-right':[1,1,1,0,1,0], 'top-back-left':[-1,1,1,0,1,0],
      'bottom-front-right':[1,-1,-1,0,1,0], 'bottom-front-left':[-1,-1,-1,0,1,0],
      'bottom-back-right':[1,-1,1,0,1,0], 'bottom-back-left':[-1,-1,1,0,1,0]
    }[view];
    if (!views || !this.model) return;
    this.navigateToDirection(new THREE.Vector3(views[0],views[1],views[2]).normalize(), new THREE.Vector3(views[3],views[4],views[5]));
  }

  navigateToDirection(direction, up) {
    this.cancelTween();
    const target = this.modelCenter.clone();
    const distance = Math.max(this.controls.getDistance(), this.modelRadius * 2.15);
    const startPos = this.camera.position.clone();
    const endPos = target.clone().add(direction.clone().normalize().multiplyScalar(distance));
    const startTarget = this.controls.target.clone();
    const duration = REDUCED() ? 1 : 500;
    const start = performance.now();
    this.tween = now => {
      const raw = Math.min(1, (now - start) / duration);
      const t = raw < 1 ? 1 - Math.pow(1 - raw, 3) : 1;
      this.controls.target.lerpVectors(startTarget, target, t);
      this.camera.position.lerpVectors(startPos, endPos, t);
      this.camera.up.copy(up).normalize();
      this.camera.lookAt(this.controls.target);
      this.controls.update();
      if (raw >= 1) {
        this.tween = null;
        this.camera.up.copy(up).normalize();
        this.camera.lookAt(this.controls.target);
        this.controls.update();
      }
    };
    this.animateTween();
  }

  animateTween() {
    if (!this.tween || this.disposed) return;
    this.tween(performance.now());
    this.requestRender();
    if (this.tween) this.animationFrame = requestAnimationFrame(() => this.animateTween());
  }

  cancelTween() {
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
    this.tween = null;
  }

  cubeAction(action) {
    if (action === 'left') this.stepView(-1, 0);
    else if (action === 'right') this.stepView(1, 0);
    else if (action === 'up') this.stepView(0, 1);
    else if (action === 'down') this.stepView(0, -1);
    else if (action === 'rollCCW') this.rollCamera(Math.PI / 2);
    else if (action === 'rollCW') this.rollCamera(-Math.PI / 2);
  }

  stepView(horizontal, vertical) {
    const target = this.controls.target.clone();
    const offset = this.camera.position.clone().sub(target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta += horizontal * 45 * DEG;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi - vertical * 45 * DEG, 0.0005, Math.PI - 0.0005);
    const next = new THREE.Vector3().setFromSpherical(spherical).normalize();
    this.navigateToDirection(next, new THREE.Vector3(0, 1, 0));
  }

  rollCamera(angle) {
    this.cancelTween();
    const startUp = this.camera.up.clone();
    const direction = this.camera.getWorldDirection(new THREE.Vector3()).normalize();
    const q = new THREE.Quaternion().setFromAxisAngle(direction, angle);
    const endUp = startUp.clone().applyQuaternion(q).normalize();
    const start = performance.now();
    const duration = REDUCED() ? 1 : 350;
    this.tween = now => {
      const raw = Math.min(1, (now - start) / duration);
      const t = 1 - Math.pow(1 - raw, 3);
      this.camera.up.lerpVectors(startUp, endUp, t).normalize();
      this.camera.lookAt(this.controls.target);
      this.controls.update();
      if (raw >= 1) this.tween = null;
    };
    this.animateTween();
  }

  syncCube() {
    if (!this.ui.cube) return;
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    const rx = THREE.MathUtils.radToDeg(e.x);
    const ry = THREE.MathUtils.radToDeg(e.y);
    const rz = THREE.MathUtils.radToDeg(e.z);
    this.ui.cube.style.transform = `rotateX(${(-rx).toFixed(2)}deg) rotateY(${(-ry).toFixed(2)}deg) rotateZ(${(-rz).toFixed(2)}deg)`;
  }

  buildLayers() {
    this.ui.layerTree.replaceChildren();
    this.layerNodes.clear();
    if (!this.model) return;
    const build = (node, parent, depth = 0) => {
      if (!node.isMesh && node.children.length === 0) return;
      const row = document.createElement('div');
      row.className = 'layer-row';
      row.style.paddingLeft = `${4 + depth * 14}px`;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = node.visible;
      const label = document.createElement('label');
      label.textContent = node.name || `${node.type} ${node.id}`;
      checkbox.addEventListener('change', () => { node.visible = checkbox.checked; this.requestRender(); });
      row.append(checkbox, label);
      parent.append(row);
      this.layerNodes.set(node.uuid, { node, checkbox, row });
      node.children.forEach(child => build(child, parent, depth + 1));
    };
    build(this.model, this.ui.layerTree);
  }

  showAll() {
    this.layerNodes.forEach(({ node, checkbox }) => { node.visible = true; checkbox.checked = true; });
    this.requestRender();
  }

  isolateSelected() {
    const selected = [...this.layerNodes.values()].filter(x => x.checkbox.checked && x.node !== this.model).map(x => x.node);
    if (!selected.length) return;
    this.model.traverse(node => {
      if (!node.isMesh) return;
      node.visible = selected.some(parent => parent === node || parent.getObjectById(node.id));
    });
    this.buildLayers();
    this.requestRender();
  }

  keyboard(e) {
    if (e.target !== this.container) return;
    const views = {1:'front',2:'back',3:'right',4:'left',5:'top',6:'bottom',0:'top-front-right'};
    if (views[e.key]) { e.preventDefault(); this.setView(views[e.key]); }
    if (e.key.toLowerCase() === 'h') { e.preventDefault(); this.goHome(); }
  }

  dispose() {
    this.disposed = true;
    this.cancelTween();
    this.intersectionObserver?.disconnect();
    this.resizeObserver?.disconnect();
    this.controls.dispose();
    this.disposeModel();
    this.renderer.dispose();
  }
}

function containerButton(container, selector, callback) {
  const element = container.querySelector(selector);
  if (element) element.addEventListener('click', event => { event.stopPropagation(); callback(event); });
}
