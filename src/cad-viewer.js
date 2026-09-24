import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/environments/RoomEnvironment.js';

const DEG = Math.PI / 180;

export class CadViewer {
  constructor(container, options = {}) {
    this.container = container;
    this.canvas = container.querySelector('canvas');
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xdfe2e6);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.001, 100000);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.pmrem.dispose();

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.enableRotate = true;
    this.controls.enableZoom = true;
    this.controls.zoomToCursor = true;
    this.controls.rotateSpeed = 0.85;
    this.controls.panSpeed = 0.75;
    this.controls.zoomSpeed = 0.9;
    this.controls.minDistance = 0.01;
    this.controls.maxDistance = 100000;
    this.controls.minPolarAngle = 0;
    this.controls.maxPolarAngle = Math.PI;
    this.controls.target.set(0, 0, 0);

    this.model = null;
    this.modelCenter = new THREE.Vector3();
    this.modelRadius = 1;
    this.visible = true;
    this.renderQueued = false;
    this.animation = null;
    this.disposed = false;
    this.interactive = true;
    this.loader = new GLTFLoader();
    this.layerNodes = new Map();

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

    this.canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      this.ui.loading.hidden = false;
      this.ui.loadingText.textContent = 'Graphics context paused…';
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.ui.loadingText.textContent = 'Restoring model…';
      this.rebuildEnvironment();
      if (this.model?.userData?.sourceUrl) this.load(this.model.userData.sourceUrl);
      else this.ui.loading.hidden = true;
    });

    this.controls.addEventListener('change', () => {
      this.syncCube();
      this.requestRender();
    });

    this.controls.addEventListener('start', () => { this.canvas.style.cursor = 'grabbing'; });
    this.controls.addEventListener('end', () => { this.canvas.style.cursor = 'grab'; });
    this.canvas.style.cursor = 'grab';
    this.resize();
  }

  rebuildEnvironment() {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.requestRender();
  }

  bindUI() {
    this.ui.filter.addEventListener('click', e => { e.stopPropagation(); this.toggleLayers(); });
    containerButton(this.container, '#closeFilter', () => this.toggleLayers(false));
    containerButton(this.container, '#showAllButton', () => this.showAll());
    containerButton(this.container, '#isolateButton', () => this.isolateSelected());
    this.ui.home.addEventListener('click', e => { e.stopPropagation(); this.goHome(); });
    this.ui.fullscreen.addEventListener('click', e => { e.stopPropagation(); this.toggleFullscreen(); });
    this.ui.activate.addEventListener('click', () => this.setInteractive(true));
    this.ui.shield.addEventListener('click', () => this.setInteractive(true));

    this.container.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', e => {
      e.stopPropagation();
      this.setView(el.dataset.view);
    }));
    this.container.querySelectorAll('[data-cube-action]').forEach(el => el.addEventListener('click', e => {
      e.stopPropagation();
      this.cubeAction(el.dataset.cubeAction);
    }));

    document.addEventListener('fullscreenchange', () => {
      const active = document.fullscreenElement === this.container;
      this.ui.fullscreen.textContent = active ? 'Exit full screen' : 'Full screen';
      requestAnimationFrame(() => this.resize());
    });

    this.container.addEventListener('keydown', e => this.keyboard(e));
    this.container.tabIndex = 0;
  }

  setInteractive(active) {
    this.interactive = active;
    this.controls.enabled = active;
    this.ui.shield.classList.toggle('active', !active);
    this.ui.activate.style.display = active ? 'none' : 'block';
    this.ui.activate.textContent = 'Click to interact';
  }

  toggleLayers(force) {
    const open = force === undefined ? !this.ui.layerPanel.classList.contains('open') : force;
    this.ui.layerPanel.classList.toggle('open', open);
    this.ui.layerPanel.setAttribute('aria-hidden', String(!open));
    this.ui.filter.setAttribute('aria-expanded', String(open));
  }

  async toggleFullscreen() {
    try {
      if (document.fullscreenElement === this.container) await document.exitFullscreen();
      else if (this.container.requestFullscreen) await this.container.requestFullscreen();
    } catch (error) {
      console.warn('Fullscreen unavailable', error);
    }
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
      if (this.animation) this.requestRender();
    });
  }

  async load(url) {
    this.disposeModel();
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
        } else {
          this.ui.loadingText.textContent = `Loading model… ${Math.round(progress.loaded / 1024 / 1024)} MB`;
        }
      }, error => {
        console.error(error);
        this.ui.loading.hidden = true;
        this.ui.error.hidden = false;
        this.ui.error.innerHTML = `<strong>Unable to load the CAD model.</strong><br><br><button id="retryModel">Retry</button>`;
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
      if (node.material) {
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach(mat => {
          if ('roughness' in mat && mat.roughness === undefined) mat.roughness = 0.38;
          if ('metalness' in mat && mat.metalness === undefined) mat.metalness = 0.12;
        });
      }
    });
    // Keep the source CAD orientation intact. Only normalize extreme units.
    if (maxDim > 100000 || maxDim < 0.0001) {
      const scale = 10 / maxDim;
      root.scale.setScalar(scale);
    }
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
        for (const key of ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap','alphaMap']) {
          if (mat[key]?.dispose) mat[key].dispose();
        }
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
    // Initial presentation is top/front/right rather than an arbitrary distant camera.
    this.camera.position.copy(center).add(new THREE.Vector3(distance * 0.72, distance * 0.76, distance * 0.72));
    this.camera.near = Math.max(this.modelRadius / 10000, 0.00001);
    this.camera.far = Math.max(this.modelRadius * 1000, 100);
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = Math.max(this.modelRadius * 0.08, 0.0001);
    this.controls.maxDistance = Math.max(this.modelRadius * 100, 100);
    this.controls.update();
    this.syncCube();
  }

  goHome() {
    if (!this.model) return;
    this.animateToDirection(new THREE.Vector3(1, 1, 1).normalize(), new THREE.Vector3(0, 1, 0));
    this.animateTarget(this.modelCenter);
  }

  setView(view) {
    if (!this.model) return;
    const d = {
      front:[new THREE.Vector3(0,0,-1),new THREE.Vector3(0,1,0)],
      back:[new THREE.Vector3(0,0,1),new THREE.Vector3(0,1,0)],
      top:[new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,-1)],
      bottom:[new THREE.Vector3(0,-1,0),new THREE.Vector3(0,0,1)],
      right:[new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,0)],
      left:[new THREE.Vector3(-1,0,0),new THREE.Vector3(0,1,0)],
      'top-front':[new THREE.Vector3(0,1,-1).normalize(),new THREE.Vector3(0,1,0)],
      'bottom-front':[new THREE.Vector3(0,-1,-1).normalize(),new THREE.Vector3(0,1,0)],
      'front-right':[new THREE.Vector3(1,0,-1).normalize(),new THREE.Vector3(0,1,0)],
      'front-left':[new THREE.Vector3(-1,0,-1).normalize(),new THREE.Vector3(0,1,0)],
      'top-front-right':[new THREE.Vector3(1,1,-1).normalize(),new THREE.Vector3(0,1,0)],
      'top-front-left':[new THREE.Vector3(-1,1,-1).normalize(),new THREE.Vector3(0,1,0)],
      'bottom-front-right':[new THREE.Vector3(1,-1,-1).normalize(),new THREE.Vector3(0,1,0)],
      'bottom-front-left':[new THREE.Vector3(-1,-1,-1).normalize(),new THREE.Vector3(0,1,0)]
    }[view];
    if (!d) return;
    this.animateToDirection(d[0], d[1]);
  }

  animateTarget(target) {
    const start = this.controls.target.clone();
    const end = target.clone();
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 450;
    this.startTween(duration, t => this.controls.target.lerpVectors(start, end, t));
  }

  animateToDirection(direction, up) {
    const target = this.controls.target.clone();
    const distance = Math.max(this.controls.getDistance(), this.modelRadius * 2.15);
    const startPos = this.camera.position.clone();
    const endPos = target.clone().add(direction.clone().normalize().multiplyScalar(distance));
    const startQuat = this.camera.quaternion.clone();
    const dummy = new THREE.Object3D();
    dummy.position.copy(endPos); dummy.up.copy(up); dummy.lookAt(target);
    const endQuat = dummy.quaternion.clone();
    const startUp = this.camera.up.clone();
    const endUp = up.clone().normalize();
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 500;
    this.startTween(duration, t => {
      const eased = 1 - Math.pow(1 - t, 3);
      this.camera.position.lerpVectors(startPos, endPos, eased);
      this.camera.quaternion.slerpQuaternions(startQuat, endQuat, eased);
      this.camera.up.lerpVectors(startUp, endUp, eased).normalize();
      this.camera.lookAt(target);
      this.controls.update();
    });
  }

  startTween(duration, step) {
    const start = performance.now();
    this.animation = true;
    const tick = now => {
      if (!this.animation) return;
      const t = Math.min(1, (now - start) / duration);
      step(t);
      this.requestRender();
      if (t >= 1) { this.animation = null; this.controls.update(); this.requestRender(); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  cubeAction(action) {
    const step = 25 * DEG;
    if (action === 'left') this.rotateAroundTarget(step, 0);
    if (action === 'right') this.rotateAroundTarget(-step, 0);
    if (action === 'up') this.rotateAroundTarget(0, step);
    if (action === 'down') this.rotateAroundTarget(0, -step);
    if (action === 'rollCCW') this.rollCamera(step);
    if (action === 'rollCW') this.rollCamera(-step);
  }

  rotateAroundTarget(azimuth, polar) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta += azimuth;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi + polar, 0.0001, Math.PI - 0.0001);
    const targetPos = new THREE.Vector3().setFromSpherical(spherical).add(this.controls.target);
    const direction = targetPos.clone().sub(this.controls.target).normalize();
    this.animateToDirection(direction, new THREE.Vector3(0,1,0));
  }

  rollCamera(angle) {
    const start = this.camera.quaternion.clone();
    const axis = this.camera.getWorldDirection(new THREE.Vector3()).normalize();
    const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    const end = q.multiply(start.clone());
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 300;
    this.startTween(duration, t => this.camera.quaternion.slerpQuaternions(start, end, t));
  }

  syncCube() {
    if (!this.ui.cube) return;
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    const x = THREE.MathUtils.radToDeg(e.x);
    const y = THREE.MathUtils.radToDeg(e.y);
    const z = THREE.MathUtils.radToDeg(e.z);
    this.ui.cube.style.transform = `perspective(320px) rotateX(${(-x).toFixed(2)}deg) rotateY(${(-y).toFixed(2)}deg) rotateZ(${(-z).toFixed(2)}deg)`;
  }

  buildLayers() {
    this.ui.layerTree.replaceChildren();
    this.layerNodes.clear();
    if (!this.model) return;
    const build = (node, parent) => {
      const meaningful = node.isMesh || node.children.length > 0;
      if (!meaningful) return;
      const row = document.createElement('div');
      row.className = 'layer-row';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = node.visible;
      const label = document.createElement('label'); label.textContent = node.name || `${node.type} ${node.id}`;
      checkbox.addEventListener('change', () => { node.visible = checkbox.checked; this.requestRender(); });
      row.append(checkbox,label); parent.append(row);
      this.layerNodes.set(node.uuid, {node, checkbox, row});
      if (node.children.length) {
        const children = document.createElement('div'); children.className = 'layer-indent'; parent.append(children);
        node.children.forEach(child => build(child, children));
      }
    };
    build(this.model, this.ui.layerTree);
  }

  showAll() {
    this.layerNodes.forEach(({node, checkbox}) => { node.visible = true; checkbox.checked = true; });
    this.requestRender();
  }

  isolateSelected() {
    const selected = [...this.layerNodes.values()].filter(x => x.checkbox.checked && x.node !== this.model).map(x => x.node);
    if (!selected.length) return;
    this.model.traverse(node => { if (node.isMesh) node.visible = selected.some(s => s === node || s.getObjectById(node.id)); });
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
