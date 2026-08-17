import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const $ = id => document.getElementById(id);

/* ---------- 错误提示（方便排查） ---------- */
function showError(msg) {
  const el = $('errOverlay');
  el.style.display = 'block';
  el.textContent = '出错了：' + msg;
}
window.addEventListener('error', e => showError(e.message));
window.addEventListener('unhandledrejection', e => showError(e.reason?.message || String(e.reason)));

/* ---------- 提示条 ---------- */
let toastTimer = null;
function toast(msg, ms = 2600) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  if (ms > 0) toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ---------- 渲染器 / 场景 / 相机 ---------- */
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
console.log('[app] WebGL2:', renderer.capabilities.isWebGL2);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0a0d16');

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 0, 2.8);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.2;
controls.maxDistance = 8;
controls.saveState();

/* ---------- 魔法阵着色器 ---------- */
const vertexShader = /* glsl */`
varying vec2 vUv;
uniform vec2 uUvScale;
uniform vec2 uUvOffset;
uniform float uTime;
uniform float uWaveAmp;
uniform float uWaveSpeed;
uniform float uWaveFreq;
void main() {
  vUv = uv * uUvScale + uUvOffset;
  vec3 pos = position;
  // 旗帜式波动：两个方向的正弦波叠加，产生轻微上下浮动的起伏感
  float t = uTime * uWaveSpeed;
  float w = sin(pos.x * uWaveFreq + t) * 0.6
          + sin(pos.y * uWaveFreq * 1.3 + t * 1.2) * 0.4;
  pos.z += w * uWaveAmp;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const fragmentShader = /* glsl */`
varying vec2 vUv;
uniform sampler2D uMap;
uniform float uTime;
uniform vec3 uColorA;
uniform float uIntensity;
uniform float uKeyBlack;    // 1 = 亮度抠黑底, 0 = 透明通道
uniform float uKeepColor;   // 1 = 保留贴图原色
uniform float uNoiseStrength;
uniform float uNoiseScale;
uniform float uNoiseSpeed;
uniform float uNoiseOctaves;
uniform float uNoiseContrast;

// ---- 2D simplex noise (Ashima / Ian McEwan) ----
vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float fbm(vec2 p, float octaves) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 6; i++) {
    if (float(i) >= octaves) break;
    v += amp * snoise(p);
    p = p * 2.03 + vec2(11.3, -7.7);
    amp *= 0.5;
  }
  return v; // 约 -1..1
}

void main() {
  vec4 tex = texture2D(uMap, vUv);
  float luma = dot(tex.rgb, vec3(0.299, 0.587, 0.114));

  // 遮罩：透明通道 或 亮度抠黑底（保留原色+黑底时 rgb 自带形状，mask 取 1）
  float mask = mix(tex.a, mix(luma, 1.0, uKeepColor), uKeyBlack);

  // ---- 能量噪波：缓慢旋涡 + 漂移 ----
  float t = uTime * uNoiseSpeed;
  vec2 cuv = vUv - 0.5;
  float cr = cos(t * 0.11), sr = sin(t * 0.11);
  mat2 R = mat2(cr, -sr, sr, cr);
  vec2 np = R * cuv * uNoiseScale + vec2(t * 0.35, -t * 0.23);

  float n = fbm(np, uNoiseOctaves) * 0.5 + 0.5;
  n = pow(clamp(n, 0.0, 1.0), uNoiseContrast);
  float energy = mix(1.0, n * 2.4, uNoiseStrength);

  vec3 albedo = mix(uColorA, tex.rgb, uKeepColor);

  vec3 col = albedo * mask * energy * uIntensity;
  gl_FragColor = vec4(col, 1.0); // AdditiveBlending：rgb 已含遮罩
}
`;

const uniforms = {
  uMap: { value: null },
  uTime: { value: 0 },
  uColorA: { value: new THREE.Color('#ff4fd2') },
  uIntensity: { value: 1.0 },
  uKeyBlack: { value: 1.0 },
  uKeepColor: { value: 0.0 },
  uNoiseStrength: { value: 1.0 },
  uNoiseScale: { value: 5.0 },
  uNoiseSpeed: { value: 0.5 },
  uNoiseOctaves: { value: 4.0 },
  uNoiseContrast: { value: 1.8 },
  uWaveAmp: { value: 0.05 },
  uWaveSpeed: { value: 1.0 },
  uWaveFreq: { value: 2.5 },
  uUvScale: { value: new THREE.Vector2(1, 1) },
  uUvOffset: { value: new THREE.Vector2(0, 0) },
};

const material = new THREE.ShaderMaterial({
  uniforms,
  vertexShader,
  fragmentShader,
  blending: THREE.AdditiveBlending,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 128, 128), material);
scene.add(mesh);

/* ---------- 合成器：辉光 ---------- */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(1024, 1024), 1.3, 0.55, 0.5);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

/* ---------- 贴图加载 ---------- */
function detectAlpha(bitmap) {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, s, s);
  const data = ctx.getImageData(0, 0, s, s).data;
  let min = 255;
  for (let i = 3; i < data.length; i += 16) { // 每4个像素抽1个
    if (data[i] < min) min = data[i];
    if (min < 250) break;
  }
  return min < 250; // 有真实透明区域
}

function fitUv(w, h) {
  if (w >= h) {
    const ry = h / w;
    uniforms.uUvScale.value.set(1, ry);
    uniforms.uUvOffset.value.set(0, (1 - ry) / 2);
  } else {
    const rx = w / h;
    uniforms.uUvScale.value.set(rx, 1);
    uniforms.uUvOffset.value.set((1 - rx) / 2, 0);
  }
}

let currentTex = null;
async function loadTextureFromBlob(blob, name = '贴图') {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY' });
  const tex = new THREE.Texture(bitmap);
  tex.flipY = false; // createImageBitmap 已翻转
  tex.needsUpdate = true;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  if (currentTex) currentTex.dispose();
  currentTex = tex;
  uniforms.uMap.value = tex;
  fitUv(bitmap.width, bitmap.height);
  // 自动抠图模式
  if ($('keyMode').value === 'auto') {
    uniforms.uKeyBlack.value = detectAlpha(bitmap) ? 0.0 : 1.0;
    toast(`已载入「${name}」· 自动使用${uniforms.uKeyBlack.value ? '亮度抠黑底' : '透明通道'}`);
  } else {
    applyKeyMode();
    toast(`已载入「${name}」`);
  }
  console.log('[app] texture loaded:', bitmap.width, 'x', bitmap.height, 'keyBlack =', uniforms.uKeyBlack.value);
  window.__texReady = true;
}

function applyKeyMode() {
  const m = $('keyMode').value;
  if (m === 'alpha') uniforms.uKeyBlack.value = 0.0;
  else if (m === 'luma') uniforms.uKeyBlack.value = 1.0;
  else if (currentTex) uniforms.uKeyBlack.value = detectAlpha(currentTex.image) ? 0.0 : 1.0;
}

function loadTextureFromUrl(url, name) {
  return fetch(url)
    .then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); })
    .then(blob => loadTextureFromBlob(blob, name));
}

// 默认贴图
loadTextureFromUrl('assets/magic-circle.png', '默认魔法阵')
  .catch(() => toast('未找到默认贴图，请拖入一张 PNG 魔法阵图片', 5000));

/* ---------- 交互：拖拽 / 粘贴 / 选择文件 ---------- */
const stage = $('stage');
const dropHint = $('dropHint');

window.addEventListener('dragover', e => { e.preventDefault(); dropHint.classList.add('show'); });
window.addEventListener('dragleave', e => { if (e.relatedTarget === null) dropHint.classList.remove('show'); });
window.addEventListener('drop', e => {
  e.preventDefault();
  dropHint.classList.remove('show');
  const file = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith('image/'));
  if (file) loadTextureFromBlob(file, file.name).catch(err => showError(err.message));
  else toast('请拖入图片文件（PNG / JPG / WebP）');
});

window.addEventListener('paste', e => {
  const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
  if (item) {
    const file = item.getAsFile();
    if (file) loadTextureFromBlob(file, '剪贴板图片').catch(err => showError(err.message));
  }
});

$('fileBtn').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) loadTextureFromBlob(file, file.name).catch(err => showError(err.message));
  e.target.value = '';
});

/* ---------- UI 绑定 ---------- */
function bindRange(id, fn, fmt = v => (+v).toFixed(2)) {
  const el = $(id), val = $(id + 'Val');
  const apply = () => { fn(+el.value); if (val) val.textContent = fmt(+el.value); };
  el.addEventListener('input', apply);
  apply();
}
function bindColor(id, fn) {
  const el = $(id);
  const apply = () => fn(el.value);
  el.addEventListener('input', apply);
  apply();
}

bindColor('colorA', v => uniforms.uColorA.value.set(v));
bindRange('intensity', v => uniforms.uIntensity.value = v);
bindRange('fov', v => { camera.fov = v; camera.updateProjectionMatrix(); }, v => v.toFixed(0) + '°');
bindColor('bgColor', v => scene.background.set(v));
bindRange('noiseStrength', v => uniforms.uNoiseStrength.value = v);
bindRange('noiseScale', v => uniforms.uNoiseScale.value = v, v => v.toFixed(1));
bindRange('noiseSpeed', v => uniforms.uNoiseSpeed.value = v);
bindRange('noiseOctaves', v => uniforms.uNoiseOctaves.value = v, v => v.toFixed(0));
bindRange('noiseContrast', v => uniforms.uNoiseContrast.value = v);
bindRange('waveAmp', v => uniforms.uWaveAmp.value = v, v => v.toFixed(3));
bindRange('waveSpeed', v => uniforms.uWaveSpeed.value = v);
bindRange('waveFreq', v => uniforms.uWaveFreq.value = v, v => v.toFixed(1));
bindRange('bloomStrength', v => bloomPass.strength = v);
bindRange('bloomRadius', v => bloomPass.radius = v);
bindRange('bloomThreshold', v => bloomPass.threshold = v);
bindRange('exposure', v => renderer.toneMappingExposure = v);

$('keyMode').addEventListener('change', applyKeyMode);
$('keepColor').addEventListener('change', e => {
  uniforms.uKeepColor.value = e.target.checked ? 1.0 : 0.0;
});
$('resetView').addEventListener('click', () => controls.reset());

// 测试钩子：球坐标设置相机（theta 方位角, phi 极角, dist 距离）
window.__setCamera = (theta = 0, phi = Math.PI / 2, dist = 2.8) => {
  camera.position.set(
    dist * Math.sin(phi) * Math.sin(theta),
    dist * Math.cos(phi),
    dist * Math.sin(phi) * Math.cos(theta)
  );
  controls.update();
};

/* ---------- 动画循环 ---------- */
const clock = new THREE.Clock();
let time = 0;
let firstFrame = true;

function animate() {
  requestAnimationFrame(animate);
  if (firstFrame) { firstFrame = false; console.log('[app] first frame, uMap =', !!uniforms.uMap.value); }
  const dt = Math.min(clock.getDelta(), 0.1);
  time += dt;
  uniforms.uTime.value = time;
  controls.update();
  composer.render();
}

/* ---------- 画布尺寸 ---------- */
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();
animate();

/* ---------- 导出 ---------- */
function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// 以指定尺寸离屏渲染一帧（始终黑底），返回是否成功
function renderFrame(size) {
  const prevSize = new THREE.Vector2();
  renderer.getSize(prevSize);
  const prevPR = renderer.getPixelRatio();
  const prevAspect = camera.aspect;
  const prevBg = scene.background.clone();

  scene.background.set('#000000');
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  composer.setSize(size, size);
  camera.aspect = 1;
  camera.updateProjectionMatrix();
  uniforms.uTime.value = time;
  composer.render();

  const restore = () => {
    scene.background.copy(prevBg);
    renderer.setPixelRatio(prevPR);
    renderer.setSize(prevSize.x, prevSize.y, false);
    composer.setSize(prevSize.x, prevSize.y);
    camera.aspect = prevAspect;
    camera.updateProjectionMatrix();
    composer.render();
  };
  return restore;
}

let exporting = false;

$('exportPngBlack').addEventListener('click', () => {
  if (exporting) return;
  exporting = true;
  try {
    const size = +$('exportSize').value;
    const restore = renderFrame(size);
    canvas.toBlob(blob => {
      restore(); exporting = false;
      if (blob) { download(blob, `魔法阵_黑底_${size}.png`); toast('已导出黑底 PNG'); }
      else showError('PNG 导出失败');
    }, 'image/png');
  } catch (err) { exporting = false; showError(err.message); }
});

$('exportPngAlpha').addEventListener('click', () => {
  if (exporting) return;
  exporting = true;
  try {
    const size = +$('exportSize').value;
    const restore = renderFrame(size);

    // 黑底 → 透明：alpha = max(r,g,b)，颜色做反预乘
    const c2 = document.createElement('canvas');
    c2.width = c2.height = size;
    const ctx = c2.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, size, size);
    const img = ctx.getImageData(0, 0, size, size);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const m = Math.max(r, g, b);
      if (m === 0) { d[i + 3] = 0; continue; }
      d[i] = Math.min(255, r * 255 / m);
      d[i + 1] = Math.min(255, g * 255 / m);
      d[i + 2] = Math.min(255, b * 255 / m);
      d[i + 3] = m;
    }
    ctx.putImageData(img, 0, 0);
    restore();

    c2.toBlob(blob => {
      exporting = false;
      if (blob) { download(blob, `魔法阵_透明_${size}.png`); toast('已导出透明 PNG'); }
      else showError('PNG 导出失败');
    }, 'image/png');
  } catch (err) { exporting = false; showError(err.message); }
});

$('recordBtn').addEventListener('click', () => {
  if (exporting) return;
  const secs = +$('videoSecs').value;
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    .find(m => MediaRecorder.isTypeSupported(m));
  if (!mime) { showError('当前浏览器不支持 WebM 录制'); return; }

  exporting = true;
  $('recordBtn').disabled = true;
  const stream = canvas.captureStream(60);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16_000_000 });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    exporting = false;
    $('recordBtn').disabled = false;
    toast('已导出 WebM 视频');
    download(new Blob(chunks, { type: 'video/webm' }), `魔法阵_${secs}s.webm`);
  };
  rec.start();

  let left = secs;
  toast(`录制中… 剩余 ${left}s`, 0);
  const timer = setInterval(() => {
    left--;
    if (left <= 0) { clearInterval(timer); rec.stop(); toast('正在封装视频…', 0); }
    else toast(`录制中… 剩余 ${left}s`, 0);
  }, 1000);
});
