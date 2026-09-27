import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/environments/RoomEnvironment.js';

const DEG = Math.PI / 180;
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export class CadViewer {
  constructor(container) {
    this.container = container;
    this.canvas = container.querySelector('#cadCanvas');
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xd8dadd);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.001, 1000000);
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this._environment = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = this._environment.fromScene(new RoomEnvironment(), 0.04).texture;
    this._environment.dispose();

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.enableRotate = true;
    this.controls.enableZoom = true;
    this.controls.zoomToCursor = true;
    this.controls.rotateSpeed = 0.8;
    this.controls.panSpeed = 0.75;
    this.controls.zoomSpeed = 0.9;
    this.controls.minPolarAngle = 0.001;
    this.controls.maxPolarAngle = Math.PI - 0.001;
    this.controls.minAzimuthAngle = -Infinity;
    this.controls.maxAzimuthAngle = Infinity;
    this.controls.minDistance = 0.001;
    this.controls.maxDistance = 1000000;

    this.loader = new GLTFLoader();
    this.model = null;
    this.modelCenter = new THREE.Vector3();
    this.modelRadius = 1;
    this.defaultDistance = 2.4;
    this.visible = true;
    this.disposed = false;
    this.interactive = false;
    this.renderQueued = false;
    this.raf = 0;
    this.tween = null;
    this.selectedNode = null;
    this.layerNodes = new Map();

    this.ui = {
      cube: container.querySelector('#viewCube'),
      layerPanel: container.querySelector('#layerPanel'),
      layerTree: container.querySelector('#layerTree'),
      filter: container.querySelector('#filterButton'),
      home: container.querySelector('#homeButton'),
      fullscreen: container.querySelector('#fullscreenButton'),
      shield: container.querySelector('#interactionShield'),
      activate: container.querySelector('#activateButton'),
      loading: container.querySelector('#loading'),
      progress: container.querySelector('#loadingProgress'),
      loadingText: container.querySelector('#loadingText'),
      error: container.querySelector('#error')
    };

    this.bindUI();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.visible = entry?.isIntersecting ?? true;
      if (this.visible) this.requestRender();
    }, { threshold: 0.01 });
    this.intersectionObserver.observe(container);

    this.controls.addEventListener('start', () => {
      this.cancelCameraTween();
      this.canvas.classList.add('is-orbiting');
    });
    this.controls.addEventListener('end', () => this.canvas.classList.remove('is-orbiting'));
    this.controls.addEventListener('change', () => this.requestRender());

    this.canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      this.ui.loading.hidden = false;
      this.ui.loadingText.textContent = 'Graphics context paused…';
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      const source = this.model?.userData?.sourceUrl;
      this.rebuildEnvironment();
      if (source) this.load(source).catch(() => {});
    });

    this.resize();
  }

  bindUI() {
    this.ui.filter?.addEventListener('click', event => {
      event.stopPropagation();
      this.toggleLayers();
    });
    this.ui.home?.addEventListener('click', event => {
      event.stopPropagation();
      this.home();
    });
    this.ui.fullscreen?.addEventListener('click', event => {
      event.stopPropagation();
      this.toggleFullscreen();
    });
    this.ui.activate?.addEventListener('click', event => {
      event.stopPropagation();
      this.setInteractive(true);
    });
    this.ui.shield?.addEventListener('click', event => {
      event.stopPropagation();
      this.setInteractive(true);
    });

    this.container.querySelector('#closeFilter')?.addEventListener('click', () => this.toggleLayers(false));
    this.container.querySelector('#showAllButton')?.addEventListener('click', () => this.showAll());
    this.container.querySelector('#isolateButton')?.addEventListener('click', () => this.isolateSelected());

    this.container.querySelectorAll('[data-view]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        this.setView(button.dataset.view);
      });
    });
    this.container.querySelectorAll('[data-cube-action]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        this.cubeAction(button.dataset.cubeAction);
      });
    });

    this.container.addEventListener('keydown', event => this.keyboard(event));
    this.container.tabIndex = 0;

    document.addEventListener('fullscreenchange', () => {
      const active = document.fullscreenElement === this.container;
      if (this.ui.fullscreen) this.ui.fullscreen.textContent = active ? 'Exit full screen' : 'Full screen';
      requestAnimationFrame(() => this.resize());
    });
  }

  setInteractive(active) {
    this.interactive = Boolean(active);
    this.controls.enabled = this.interactive;
    this.ui.shield?.classList.toggle('active', !this.interactive);
    if (this.ui.activate) this.ui.activate.hidden = this.interactive;
    this.requestRender();
  }

  toggleLayers(force) {
    const open = force === undefined
      ? !this.ui.layerPanel.classList.contains('open')
      : Boolean(force);
    this.ui.layerPanel.classList.toggle('open', open);
    this.ui.layerPanel.setAttribute('aria-hidden', String(!open));
    this.ui.filter?.setAttribute('aria-expanded', String(open));
  }

  async toggleFullscreen() {
    try {
      if (document.fullscreenElement === this.container) {
        await document.exitFullscreen();
      } else if (this.container.requestFullscreen) {
        await this.container.requestFullscreen();
      }
    } catch (error) {
      console.warn('Fullscreen unavailable:', error);
    }
  }

  rebuildEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.requestRender();
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.requestRender();
  }

  requestRender() {
    if (this.renderQueued || this.disposed || !this.visible) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      if (this.disposed || !this.visible) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.syncCube();
    });
  }

  async load(url) {
    this.disposeModel();
    this.cancelCameraTween();
    this.ui.error.hidden = true;
    this.ui.loading.hidden = false;
    this.ui.progress.style.width = '0%';
    this.ui.loadingText.textContent = 'Loading model…';

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
          const percent = Math.round(progress.loaded / progress.total * 100);
          this.ui.progress.style.width = `${percent}%`;
          this.ui.loadingText.textContent = `Loading model… ${percent}%`;
        } else {
          this.ui.loadingText.textContent = `Loading model… ${Math.round(progress.loaded / 1048576)} MB`;
        }
      }, error => {
        console.error('CAD model load failed:', error);
        this.ui.loading.hidden = true;
        this.ui.error.hidden = false;
        this.ui.error.innerHTML = '<strong>Unable to load the CAD model.</strong><br><span>Check the model URL or network connection.</span><br><button type="button" id="retryModel">Retry</button>';
        this.ui.error.querySelector('#retryModel')?.addEventListener('click', () => this.load(url).catch(() => {}));
        reject(error);
      });
    });
  }

  prepareModel(root) {
    root.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
      node.frustumCulled = true;
      if (node.material) {
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach(material => {
          if (!material) return;
          material.needsUpdate = true;
        });
      }
    });
  }

  frameModel() {
    if (!this.model) return;
    const box = new THREE.Box3().setFromObject(this.model);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    this.modelCenter.copy(center);
    this.modelRadius = Math.max(size.length() * 0.5, 0.001);
    this.defaultDistance = this.modelRadius * 2.05;
    this.controls.target.copy(center);
    this.controls.minDistance = Math.max(this.modelRadius * 0.06, 0.0001);
    this.controls.maxDistance = Math.max(this.modelRadius * 100, 100);
    this.camera.near = Math.max(this.modelRadius / 100000, 0.000001);
    this.camera.far = Math.max(this.modelRadius * 1000, 1000);
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(center).add(new THREE.Vector3(0, this.defaultDistance, 0));
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(center);
    this.controls.update();
    this.syncCube();
  }

  home() {
    if (!this.model) return;
    this.navigateTo(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), this.defaultDistance);
  }

  viewDefinition(name) {
    const definitions = {
      front: [new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)],
      back: [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)],
      right: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)],
      left: [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)],
      top: [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1)],
      bottom: [new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1)],
      'top-front': [new THREE.Vector3(0, 1, -1).normalize(), new THREE.Vector3(0, 1, 0)],
      'top-back': [new THREE.Vector3(0, 1, 1).normalize(), new THREE.Vector3(0, 1, 0)],
      'bottom-front': [new THREE.Vector3(0, -1, -1).normalize(), new THREE.Vector3(0, 1, 0)],
      'bottom-back': [new THREE.Vector3(0, -1, 1).normalize(), new THREE.Vector3(0, 1, 0)],
      'front-right': [new THREE.Vector3(1, 0, -1).normalize(), new THREE.Vector3(0, 1, 0)],
      'front-left': [new THREE.Vector3(-1, 0, -1).normalize(), new THREE.Vector3(0, 1, 0)],
      'back-right': [new THREE.Vector3(1, 0, 1).normalize(), new THREE.Vector3(0, 1, 0)],
      'back-left': [new THREE.Vector3(-1, 0, 1).normalize(), new THREE.Vector3(0, 1, 0)],
      'top-front-right': [new THREE.Vector3(1, 1, -1).normalize(), new THREE.Vector3(0, 1, 0)],
      'top-front-left': [new THREE.Vector3(-1, 1, -1).normalize(), new THREE.Vector3(0, 1, 0)],
      'top-back-right': [new THREE.Vector3(1, 1, 1).normalize(), new THREE.Vector3(0, 1, 0)],
      'top-back-left': [new THREE.Vector3(-1, 1, 1).normalize(), new THREE.Vector3(0, 1, 0)],
      'bottom-front-right': [new THREE.Vector3(1, -1, -1).normalize(), new THREE.Vector3(0, 1, 0)],
      'bottom-front-left': [new THREE.Vector3(-1, -1, -1).normalize(), new THREE.Vector3(0, 1, 0)],
      'bottom-back-right': [new THREE.Vector3(1, -1, 1).normalize(), new THREE.Vector3(0, 1, 0)],
      'bottom-back-left': [new THREE.Vector3(-1, -1, 1).normalize(), new THREE.Vector3(0, 1, 0)]
    };
    return definitions[name];
  }

  setView(name) {
    const definition = this.viewDefinition(name);
    if (!definition || !this.model) return;
    this.navigateTo(definition[0], definition[1], Math.max(this.controls.getDistance(), this.defaultDistance));
  }

  navigateTo(direction, up, distance) {
    if (!this.model) return;
    this.cancelCameraTween();
    const target = this.modelCenter.clone();
    const startTarget = this.controls.target.clone();
    const startPosition = this.camera.position.clone();
    const endPosition = target.clone().add(direction.clone().normalize().multiplyScalar(distance));
    const startUp = this.camera.up.clone();
    const endUp = up.clone().normalize();
    const duration = reducedMotion() ? 1 : 520;
    const started = performance.now();

    this.tween = now => {
      const p = Math.min(1, (now - started) / duration);
      const eased = p === 1 ? 1 : 1 - Math.pow(1 - p, 3);
      this.controls.target.lerpVectors(startTarget, target, eased);
      this.camera.position.lerpVectors(startPosition, endPosition, eased);
      this.camera.up.lerpVectors(startUp, endUp, eased).normalize();
      this.camera.lookAt(this.controls.target);
      this.controls.update();
      this.requestRender();
      if (p === 1) this.tween = null;
    };
    this.animateTween();
  }

  animateTween() {
    if (!this.tween || this.disposed) return;
    this.tween(performance.now());
    if (this.tween) this.raf = requestAnimationFrame(() => this.animateTween());
  }

  cancelCameraTween() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.tween = null;
  }

  cubeAction(action) {
    if (!this.model) return;
    if (action === 'rollCCW') return this.rollCamera(Math.PI / 2);
    if (action === 'rollCW') return this.rollCamera(-Math.PI / 2);
    const target = this.controls.target.clone();
    const offset = this.camera.position.clone().sub(target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    if (action === 'left') spherical.theta += 45 * DEG;
    if (action === 'right') spherical.theta -= 45 * DEG;
    if (action === 'up') spherical.phi = THREE.MathUtils.clamp(spherical.phi - 45 * DEG, 0.001, Math.PI - 0.001);
    if (action === 'down') spherical.phi = THREE.MathUtils.clamp(spherical.phi + 45 * DEG, 0.001, Math.PI - 0.001);
    const direction = new THREE.Vector3().setFromSpherical(spherical).normalize();
    const currentUp = this.camera.up.clone();
    this.navigateTo(direction, currentUp, Math.max(offset.length(), this.defaultDistance));
  }

  rollCamera(angle) {
    const target = this.controls.target.clone();
    const direction = target.clone().sub(this.camera.position).normalize();
    const startUp = this.camera.up.clone();
    const endUp = startUp.clone().applyAxisAngle(direction, angle).normalize();
    this.animateRoll(endUp);
  }

  animateRoll(endUp) {
    this.cancelCameraTween();
    const startUp = this.camera.up.clone();
    const target = this.controls.target.clone();
    const start = performance.now();
    const duration = reducedMotion() ? 1 : 420;
    this.tween = now => {
      const p = Math.min(1, (now - start) / duration);
      const eased = p === 1 ? 1 : 1 - Math.pow(1 - p, 3);
      this.camera.up.lerpVectors(startUp, endUp, eased).normalize();
      this.camera.lookAt(target);
      this.controls.update();
      this.requestRender();
      if (p === 1) this.tween = null;
    };
    this.animateTween();
  }

  syncCube() {
    if (!this.ui.cube) return;
    const q = this.camera.quaternion.clone().invert();
    const euler = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    const x = THREE.MathUtils.radToDeg(euler.x);
    const y = THREE.MathUtils.radToDeg(euler.y);
    const z = THREE.MathUtils.radToDeg(euler.z);
    this.ui.cube.style.transform = `perspective(520px) rotateX(${x}deg) rotateY(${y}deg) rotateZ(${z}deg)`;
  }

  buildLayers() {
    this.ui.layerTree.replaceChildren();
    this.layerNodes.clear();
    if (!this.model) return;
    const rootList = document.createDocumentFragment();
    this.addLayerNode(this.model, rootList, 0, true);
    this.ui.layerTree.appendChild(rootList);
  }

  addLayerNode(node, parent, depth, forceRoot = false) {
    if (!node.children?.length && !node.isMesh) return;
    const row = document.createElement('div');
    row.className = 'layer-row';
    row.style.setProperty('--depth', depth);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = node.visible;
    checkbox.setAttribute('aria-label', `Toggle ${node.name || 'unnamed part'}`);
    checkbox.addEventListener('change', () => {
      node.visible = checkbox.checked;
      this.requestRender();
    });

    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'layer-name';
    label.textContent = node.name || (forceRoot ? 'Assembly' : node.isMesh ? 'Mesh' : node.type);
    label.addEventListener('click', () => {
      this.selectedNode = node;
      this.ui.layerTree.querySelectorAll('.layer-row.selected').forEach(el => el.classList.remove('selected'));
      row.classList.add('selected');
    });

    row.append(checkbox, label);
    parent.appendChild(row);
    this.layerNodes.set(node.uuid, node);
    node.children?.forEach(child => this.addLayerNode(child, parent, depth + 1));
  }

  showAll() {
    this.model?.traverse(node => { node.visible = true; });
    this.buildLayers();
    this.requestRender();
  }

  isolateSelected() {
    if (!this.selectedNode) return;
    const selected = this.selectedNode;
    this.model?.traverse(node => { node.visible = node === selected || selected.getObjectById?.(node.id) === node; });
    selected.visible = true;
    this.buildLayers();
    this.requestRender();
  }

  keyboard(event) {
    if (event.target !== this.container) return;
    const key = event.key.toLowerCase();
    const map = { '1': 'front', '2': 'back', '3': 'right', '4': 'left', '5': 'top', '6': 'bottom' };
    if (map[key]) {
      event.preventDefault();
      this.setView(map[key]);
    }
    if (key === 'h') {
      event.preventDefault();
      this.home();
    }
  }

  disposeModel() {
    if (!this.model) return;
    this.scene.remove(this.model);
    this.model.traverse(node => {
      if (!node.isMesh) return;
      node.geometry?.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach(material => {
        if (!material) return;
        ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'].forEach(key => material[key]?.dispose?.());
        material.dispose?.();
      });
    });
    this.model = null;
    this.layerNodes.clear();
    this.selectedNode = null;
    this.ui.layerTree.replaceChildren();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelCameraTween();
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    this.disposeModel();
    this.controls.dispose();
    this.renderer.dispose();
  }
}
