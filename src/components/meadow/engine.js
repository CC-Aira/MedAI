/* ============================================================
   meadow.js — the 3D meadow
   procedural terrain · instanced grass that bends where you walk
   · dandelions · birds that judge you · a coral tree
   ============================================================ */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const T = THREE;

  /* ------------------------------------------------ helpers */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smoothstep(a, b, x) {
    x = clamp((x - a) / (b - a), 0, 1);
    return x * x * (3 - 2 * x);
  }
  function rand(a, b) { return a + Math.random() * (b - a); }

  function terrainHeight(x, z) {
    var d = Math.sqrt(x * x + z * z);
    var flat = smoothstep(4, 30, d);
    var h =
      Math.sin(x * 0.045) * Math.cos(z * 0.052) * 2.0 +
      Math.sin(x * 0.11 + 1.7) * Math.sin(z * 0.09) * 0.55 +
      Math.cos((x + z) * 0.021) * 1.1;
    h *= flat;
    // distant hills: gentle, never a wall
    var rise = smoothstep(110, 300, d);
    h += rise * 13.0 * (0.55 + 0.45 * Math.sin(x * 0.017) * Math.cos(z * 0.013));
    return h;
  }

  var MEADOW_CENTER = new T.Vector3(3, 0, -4);

  /* ------------------------------------------------ canvas textures */
  function makeCanvas(size) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    return c;
  }

  function flowerTexture() {
    var c = makeCanvas(64), g = c.getContext('2d');
    g.translate(32, 32);
    g.fillStyle = 'rgba(255,253,244,1)';
    for (var i = 0; i < 5; i++) {
      g.beginPath();
      g.ellipse(0, -13, 6.5, 12.5, 0, 0, Math.PI * 2);
      g.fill();
      g.rotate((Math.PI * 2) / 5);
    }
    g.beginPath();
    g.arc(0, 0, 5.6, 0, Math.PI * 2);
    g.fillStyle = '#f6cf72';
    g.fill();
    return new T.CanvasTexture(c);
  }

  // 星辰花（勿忘我）：五片小圆蓝瓣 + 奶白花心，用来在草地上点几笔蓝
  function starFlowerTexture() {
    var c = makeCanvas(64), g = c.getContext('2d');
    g.translate(32, 32);
    // 五片分开一点的圆瓣，缩小到十几像素时还能看出是"五瓣小花"而不是一团蓝
    for (var i = 0; i < 5; i++) {
      var a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      var px = Math.cos(a) * 11.0, py = Math.sin(a) * 11.0;
      var grd = g.createRadialGradient(px - 1.5, py - 2.5, 0.5, px, py, 8.6);
      grd.addColorStop(0, 'rgba(215,235,255,1)');
      grd.addColorStop(0.42, 'rgba(126,171,238,1)');
      grd.addColorStop(0.80, 'rgba(74,126,208,1)');
      grd.addColorStop(1, 'rgba(64,116,200,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(px, py, 8.4, 0, Math.PI * 2);
      g.fill();
    }
    // 花心：一小团奶白，别画太大，远看才像星点
    var cg = g.createRadialGradient(0, 0, 0, 0, 0, 4.6);
    cg.addColorStop(0, 'rgba(255,253,240,1)');
    cg.addColorStop(0.7, 'rgba(255,247,209,0.98)');
    cg.addColorStop(1, 'rgba(255,242,190,0)');
    g.fillStyle = cg;
    g.beginPath();
    g.arc(0, 0, 4.6, 0, Math.PI * 2);
    g.fill();
    return new T.CanvasTexture(c);
  }

  function puffTexture() {    var c = makeCanvas(128), g = c.getContext('2d');
    var grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255,255,250,0.98)');
    grad.addColorStop(0.45, 'rgba(255,255,248,0.62)');
    grad.addColorStop(0.78, 'rgba(255,255,246,0.2)');
    grad.addColorStop(1, 'rgba(255,255,246,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(64, 64, 62, 0, Math.PI * 2);
    g.fill();
    // little filaments
    g.strokeStyle = 'rgba(255,255,250,0.5)';
    g.lineWidth = 1;
    for (var i = 0; i < 26; i++) {
      var a = Math.random() * Math.PI * 2, r0 = rand(6, 20), r1 = rand(40, 60);
      g.beginPath();
      g.moveTo(64 + Math.cos(a) * r0, 64 + Math.sin(a) * r0);
      g.lineTo(64 + Math.cos(a) * r1, 64 + Math.sin(a) * r1);
      g.stroke();
    }
    return new T.CanvasTexture(c);
  }

  function seedTexture() {
    var c = makeCanvas(64), g = c.getContext('2d');
    g.strokeStyle = 'rgba(255,255,250,0.95)';
    g.lineWidth = 1.3;
    g.lineCap = 'round';
    for (var i = 0; i < 7; i++) {
      var a = -Math.PI / 2 + (i - 3) * 0.28;
      g.beginPath();
      g.moveTo(32, 46);
      g.lineTo(32 + Math.cos(a) * 24, 46 + Math.sin(a) * 24);
      g.stroke();
    }
    g.fillStyle = 'rgba(255,255,250,1)';
    g.beginPath();
    g.arc(32, 46, 2.4, 0, Math.PI * 2);
    g.fill();
    return new T.CanvasTexture(c);
  }

  function fluffTexture() {
    var c = makeCanvas(128), g = c.getContext('2d');
    var grad = g.createRadialGradient(64, 64, 1, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255,253,246,1)');
    grad.addColorStop(0.35, 'rgba(255,252,240,0.92)');
    grad.addColorStop(0.62, 'rgba(255,249,232,0.5)');
    grad.addColorStop(0.82, 'rgba(255,247,226,0.16)');
    grad.addColorStop(1, 'rgba(255,246,224,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    // a whisper of fibre at the rim so the sprite isn't a perfect circle
    g.globalAlpha = 0.32;
    g.strokeStyle = 'rgba(255,252,240,0.9)';
    g.lineWidth = 2;
    for (var i = 0; i < 22; i++) {
      var a = (i / 22) * Math.PI * 2 + Math.random() * 0.2;
      g.beginPath();
      g.moveTo(64 + Math.cos(a) * 34, 64 + Math.sin(a) * 34);
      g.lineTo(64 + Math.cos(a) * (50 + Math.random() * 10), 64 + Math.sin(a) * (50 + Math.random() * 10));
      g.stroke();
    }
    return new T.CanvasTexture(c);
  }

  function dotTexture() {
    var c = makeCanvas(64), g = c.getContext('2d');
    var grad = g.createRadialGradient(32, 32, 0, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,252,235,1)');
    grad.addColorStop(0.5, 'rgba(255,250,225,0.4)');
    grad.addColorStop(1, 'rgba(255,250,225,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new T.CanvasTexture(c);
  }

  /* ------------------------------------------------ shaders */
  var SKY_VS = [
    'varying vec3 vDir;',
    'void main() {',
    '  vDir = position;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n');

  var SKY_FS = [
    'precision highp float;',
    'varying vec3 vDir;',
    'uniform float uTime;',
    'uniform vec3 uSunDir;',
    'uniform vec3 uZenith;',
    'uniform vec3 uMid;',
    'uniform vec3 uHorizon;',
    'uniform vec3 uSunColor;',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }',
    'float vnoise(vec2 p){',
    '  vec2 i = floor(p), f = fract(p);',
    '  vec2 u = f * f * (3.0 - 2.0 * f);',
    '  float a = hash(i), b = hash(i + vec2(1.0, 0.0));',
    '  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));',
    '  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);',
    '}',
    'float fbm(vec2 p){',
    '  float v = 0.0, amp = 0.5;',
    '  for (int i = 0; i < 5; i++) { v += amp * vnoise(p); p *= 2.03; amp *= 0.5; }',
    '  return v;',
    '}',
    'void main() {',
    '  vec3 dir = normalize(vDir);',
    '  float h = dir.y;',
    '  vec3 col = mix(uHorizon, uMid, smoothstep(-0.01, 0.13, h));',
    '  col = mix(col, uZenith, smoothstep(0.13, 0.62, h));',
    '  vec2 uv = dir.xz / max(h + 0.17, 0.07) * 1.15;',
    '  uv += vec2(uTime * 0.0042, uTime * 0.0016);',
    '  float n1 = fbm(uv * 1.05);',
    '  float n2 = fbm(uv * 2.6 + 4.3);',
    '  float cloud = smoothstep(0.58, 0.92, n1 * 0.8 + n2 * 0.33);',
    '  cloud *= smoothstep(0.05, 0.30, h);',
    '  cloud *= 1.0 - smoothstep(0.55, 0.98, h);',
    '  vec3 cloudCol = mix(vec3(0.99, 0.995, 1.0), uSunColor, 0.16);',
    '  col = mix(col, cloudCol, cloud * 0.42);',
    '  float sd = max(dot(dir, normalize(uSunDir)), 0.0);',
    '  col += uSunColor * pow(sd, 3000.0) * 1.15;',
    '  col += uSunColor * pow(sd, 120.0) * 0.12;',
    '  col += uSunColor * pow(sd, 12.0) * 0.04;',
    '  gl_FragColor = vec4(col, 1.0);',
    '  #include <colorspace_fragment>',
    '}'
  ].join('\n');

  var GRASS_VS = [
    'precision highp float;',
    'attribute vec3 aOffset;',
    'attribute vec2 aScale;',
    'attribute vec2 aRot;',
    'attribute float aPhase;',
    'attribute vec3 aTint;',
    'uniform float uTime;',
    'uniform vec2 uWindDir;',
    'uniform float uWind;',
    'uniform vec4 uTrail[10];',
    'varying float vH;',
    'varying vec3 vTint;',
    'varying float vDepth;',
    'varying float vFlatten;',
    'void main() {',
    '  float h = position.y;',
    '  vec3 p = vec3(position.x * aScale.x, h * aScale.y, position.z * aScale.y * 0.6);',
    '  p.xz = vec2(p.x * aRot.x - p.z * aRot.y, p.x * aRot.y + p.z * aRot.x);',
    '  vec3 world = aOffset + p;',
    '',
    '  float sway = sin(uTime * 1.35 + aPhase + aOffset.x * 0.35 + aOffset.z * 0.22);',
    '  sway += 0.42 * sin(uTime * 2.6 + aPhase * 1.7 + aOffset.z * 0.4);',
    '  sway += 0.30 * sin(uTime * 0.55 - aOffset.x * 0.05 + aOffset.z * 0.035);',
    '  vec2 push = uWindDir * sway * uWind;',
    '',
    '  float flatten = 0.0;',
    '  for (int i = 0; i < 10; i++) {',
    '    vec4 tr = uTrail[i];',
    '    if (tr.z <= 0.002) continue;',
    '    vec2 d = aOffset.xz - tr.xy;',
    '    float dist = length(d);',
    '    float infl = smoothstep(tr.w, 0.0, dist) * tr.z;',
    '    if (infl > 0.0) {',
    '      vec2 dir = dist > 0.0001 ? d / dist : vec2(1.0, 0.0);',
    '      push += dir * infl * 0.42;',
    '      flatten = max(flatten, infl);',
    '    }',
    '  }',
    '',
    '  float k = pow(h, 1.55);',
    '  world.xz += push * k;',
    '  world.y -= flatten * aScale.y * 0.30 * k;',
    '',
    '  vH = h;',
    '  vTint = aTint;',
    '  vFlatten = flatten;',
    '  vec4 mv = viewMatrix * vec4(world, 1.0);',
    '  vDepth = -mv.z;',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');

  var GRASS_FS = [
    'precision highp float;',
    'uniform vec3 uRoot;',
    'uniform vec3 uTip;',
    'uniform vec3 uSun;',
    'uniform vec3 uFog;',
    'uniform float uFogDensity;',
    'varying float vH;',
    'varying vec3 vTint;',
    'varying float vDepth;',
    'varying float vFlatten;',
    'void main() {',
    '  vec3 col = mix(uRoot, uTip, smoothstep(0.0, 1.0, vH));',
    '  col *= vTint;',
    '  col *= 0.80 + 0.34 * vH;',
    '  col = mix(col, uSun * 0.96, 0.10 * pow(vH, 3.0));',
    '  col = mix(col, vec3(0.42, 0.50, 0.26), vFlatten * 0.45);',
    '  float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);',
    '  col = mix(col, uFog, clamp(fogFactor, 0.0, 1.0));',
    '  gl_FragColor = vec4(col, 1.0);',
    '  #include <colorspace_fragment>',
    '}'
  ].join('\n');

  var POINTS_VS = [
    'precision highp float;',
    'attribute float aSize;',
    'attribute vec3 aColor;',
    'uniform float uScale;',
    'uniform float uMaxSize;',
    'varying vec3 vColor;',
    'varying float vDepth;',
    'void main() {',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  vDepth = -mv.z;',
    '  gl_Position = projectionMatrix * mv;',
    '  gl_PointSize = min(aSize * uScale / max(0.12, -mv.z), uMaxSize);',
    '  vColor = aColor;',
    '}'
  ].join('\n');

  var POINTS_FS = [
    'precision highp float;',
    'uniform sampler2D uMap;',
    'uniform vec3 uFog;',
    'uniform float uFogDensity;',
    'uniform float uOpacity;',
    'varying vec3 vColor;',
    'varying float vDepth;',
    'void main() {',
    '  vec4 tex = texture2D(uMap, gl_PointCoord);',
    '  if (tex.a < 0.06) discard;',
    '  float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);',
    '  vec3 col = mix(vColor, uFog, clamp(fogFactor, 0.0, 1.0));',
    '  gl_FragColor = vec4(col, tex.a * uOpacity);',
    '  #include <colorspace_fragment>',
    '}'
  ].join('\n');

  // 星辰花专用：把贴图本身的颜色乘进来（蓝瓣 + 奶白花心），
  // 通用的 POINTS_FS 只用贴图的 alpha 通道，蓝花会变成一整片死蓝。
  var STAR_FS = [
    'precision highp float;',
    'uniform sampler2D uMap;',
    'uniform vec3 uFog;',
    'uniform float uFogDensity;',
    'uniform float uOpacity;',
    'varying vec3 vColor;',
    'varying float vDepth;',
    'void main() {',
    '  vec4 tex = texture2D(uMap, gl_PointCoord);',
    '  if (tex.a < 0.06) discard;',
    '  float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);',
    '  vec3 col = mix(tex.rgb * vColor, uFog, clamp(fogFactor, 0.0, 1.0));',
    '  gl_FragColor = vec4(col, tex.a * uOpacity);',
    '  #include <colorspace_fragment>',
    '}'
  ].join('\n');


  /* ------------------------------------------------ 写实积云 */
  // 密度图在 R 通道（由 makeCloudTexture 现场生成）。
  // 立体感来自"密度梯度当受光面 + 太阳方向"，不是画上去的高光；
  // 薄的地方透一点天光、底部压暗、四周虚掉，凑出积云的体积和软边。
  var CLOUD_VS = [
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = uv;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n');

  var CLOUD_FS = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uMap;',
    'uniform float uOpacity;',
    'uniform vec2 uLightXY;',
    'uniform vec3 uSun;',
    'uniform vec3 uShadow;',
    'uniform vec3 uAmbient;',
    'uniform vec3 uHaze;',
    'uniform float uHazeAmt;',
    'uniform float uTime;',
    'uniform float uPhase;',
    'uniform float uFlipX;',
    'void main() {',
    // 极慢的采样偏移：云体自己轻轻呼吸，不是一张图硬平移过去
    '  float tt = uTime + uPhase;',
    '  vec2 wob = vec2(sin(tt * 0.19) * 0.010, cos(tt * 0.15) * 0.007);',
    '  vec2 uv = vec2(uFlipX > 0.5 ? 1.0 - vUv.x : vUv.x, vUv.y);',
    '  float d = texture2D(uMap, uv + wob).r;',
    '  if (d < 0.02) discard;',
    // 密度梯度 → 受光面
    '  float e = 0.014;',
    '  float dx = texture2D(uMap, uv + vec2(e, 0.0) + wob).r - texture2D(uMap, uv - vec2(e, 0.0) + wob).r;',
    '  float dy = texture2D(uMap, uv + vec2(0.0, e) + wob).r - texture2D(uMap, uv - vec2(0.0, e) + wob).r;',
    '  vec2 g = vec2(dx, dy) * 11.0;',
    '  float ndl = clamp(dot(normalize(vec2(-g.x, -g.y) + vec2(0.0002)), uLightXY) * 0.5 + 0.5, 0.0, 1.0);',
    '  vec3 col = mix(uShadow, uSun, smoothstep(0.08, 0.86, ndl));',
    // 越薄越透天光：边缘和稀薄处带一点天空色，才不像白纸片
    '  float thin = 1.0 - smoothstep(0.04, 0.60, d);',
    '  col = mix(col, uAmbient, thin * 0.32);',
    // 底部略压暗：真实积云的下沉面是灰的
    '  col *= 1.0 - smoothstep(0.55, 1.0, vUv.y) * 0.12;',
    // 远处掺一点雾色，和草地/远山同一个色系
    '  col = mix(col, uHaze, uHazeAmt);',
    // 四周虚化，任何角度都不出现硬边
    '  float edge = smoothstep(0.0, 0.16, uv.x) * (1.0 - smoothstep(0.84, 1.0, uv.x))',
    '             * smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.88, 1.0, vUv.y));',
    '  float a = d * uOpacity * edge;',
    '  if (a < 0.006) discard;',
    '  gl_FragColor = vec4(col, a);',
    '  #include <colorspace_fragment>',
    '}'
  ].join('\n');

  /* -------------------------------------------- 今天的药：吊牌的木料 */

  // 参考图那种长条锯切板：横向长、纵向窄，两根细链条吊着
  var SIGN_W_WORLD = 1.52;
  var SIGN_H_WORLD = 0.70;
  // 文字区比板面小一圈，字不贴着锯口
  var SIGN_TEXT_W = 1.42;
  var SIGN_TEXT_H = 0.58;
  // 链条从板子上沿一直拉到画面外，看不见头才像「挂在那儿」
  var SIGN_CHAIN = 6.4;
  // 板子厚度：长条板厚约 5cm 换算下来差不多是这个比例
  var SIGN_T_WORLD = 0.062;
  // 板子在屏幕上的目标宽度（桌面）
  var SIGN_W_PX = 252;

  // 贴图在屏幕上有大约 2.3 倍的余量：板子 252px 宽，DPR 1.75 也就 440 物理像素
  var WOOD_W = 1024;
  var WOOD_H = 512;
  var woodCache = null;

  function valueNoise(seed) {
    var perm = new Uint8Array(512);
    var s = seed >>> 0;

    function rnd() {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return (s >>> 8) / 16777216;
    }

    var i;
    for (i = 0; i < 256; i++) perm[i] = i;
    for (i = 255; i > 0; i--) {
      var k = (rnd() * (i + 1)) | 0;
      var tmp = perm[i];
      perm[i] = perm[k];
      perm[k] = tmp;
    }
    for (i = 0; i < 256; i++) perm[256 + i] = perm[i];

    function lattice(x, y) {
      return perm[(perm[x & 255] + y) & 255] / 255;
    }

    return function (x, y) {
      var xi = Math.floor(x);
      var yi = Math.floor(y);
      var xf = x - xi;
      var yf = y - yi;
      xf = xf * xf * (3 - 2 * xf);
      yf = yf * yf * (3 - 2 * yf);
      var a = lattice(xi, yi);
      var b = lattice(xi + 1, yi);
      var c = lattice(xi, yi + 1);
      var d = lattice(xi + 1, yi + 1);
      return (a + (b - a) * xf) * (1 - yf) + (c + (d - c) * xf) * yf;
    };
  }

  /**
   * 木料贴图：一张颜色图 + 一张法线图 + 一张粗糙度图，外加端面用的一张小图。
   *
   * 真实木头的表面靠三件事撑起来，缺一件就不像：
   *   1. 年轮只是骨架，真正让眼睛觉得「这是木头」的是年轮之间那层细密的纤维线；
   *   2. 光打上去要被打断 —— 所以把高度场求导做成法线图，不是硬塞凹凸；
   *   3. 一块实木不可能处处一样：木节、树脂线、导管孔、边缘的磨损深浅都得有。
   * 全程不引入外部贴图，也不画高光：画上去的高光一转身就错位。
   */
  function woodMaps() {
    if (woodCache) return woodCache;

    var w = WOOD_W;
    var h = WOOD_H;
    var noise = valueNoise(80231);
    var fineNoise = valueNoise(31177);
    var blotchNoise = valueNoise(49057);
    var resinNoise = valueNoise(10733);

    // 浅白橡木：早材偏米黄，晚材深褐但不发黑
    var deep = [88, 60, 34];
    var pale = [237, 216, 184];

    var col = document.createElement('canvas');
    col.width = w;
    col.height = h;
    var cg = col.getContext('2d');
    var img = cg.createImageData(w, h);
    var px = img.data;

    var rgh = document.createElement('canvas');
    rgh.width = w;
    rgh.height = h;
    var rg = rgh.getContext('2d');
    var rimg = rg.createImageData(w, h);
    var rpx = rimg.data;

    // 高度场先整个存下来：法线要对邻居求导，边算边丢就没法求了
    var height = new Float32Array(w * h);

    // 木节（uv）：避开中间的字，藏在右下角那块空地上
    var KX = 0.845;
    var KY = 0.762;

    for (var y = 0; y < h; y++) {
      var v = y / h;
      for (var x = 0; x < w; x++) {
        var u = x / w;

        // 纤维：沿板长几乎不变、横向很密，天然就是一条条长纹，还自带断点。
        // 四层不同尺度叠起来，比拿正弦画更像木头。
        var fib1 = noise(u * 0.7, v * 13);
        var fib2 = noise(u * 1.9, v * 32);
        var fib3 = fineNoise(u * 5.2, v * 56);
        var fib4 = fineNoise(u * 9.6, v * 104);

        // 木节：纹路绕着它弯过去
        var kdx = (u - KX) * 2;
        var kdy = v - KY;
        var kd2 = kdx * kdx + kdy * kdy;

        // 年轮沿板长走，接近水平：锯切角只让它中间略拱一点。
        // 真正的「不规则」来自三个尺度上顺纹拉长的扰动 —— 沿板长变慢、横向变快，
        // 所以线是细碎的起伏，不是一条条大波浪。频率放低就变成等高线了。
        var gd = v + 0.045 * (u - 0.45) * (u - 0.45);
        // 顺着板长慢慢起伏：年轮不是一条水平线，会跟着树的形状爬坡下坡
        gd += 0.014 * (noise(u * 0.9, 0.5) - 0.5);
        gd +=
          (noise(u * 3.2, v * 26) - 0.5) * 0.015 +
          (noise(u * 7.5, v * 62) - 0.5) * 0.0065 +
          (noise(u * 17, v * 128) - 0.5) * 0.0028;

        // 沿板长方向年轮的稀密本来就不一样：左半边长得快就宽，右半边挤成一堆
        var density = 12 + 6 * noise(u * 1.6, 0.4);
        var pos = gd * density + 0.4 * Math.exp(-kd2 * 52);

        var ring = 0.5 + 0.5 * Math.sin(pos * Math.PI * 2);

        // 每一圈年轮的「性格」都不一样：有的又粗又黑，有的细得只剩一根发丝。
        // 用圈序号做哈希，保证同一圈内部整条一致 —— 粗细处处随机的线是贴图，会露馅。
        var rId = Math.floor(pos);
        var h1 = (rId * 0.6180339887) % 1;
        var h2 = (rId * 0.4142135624) % 1;
        h1 = h1 < 0 ? h1 + 1 : h1;
        h2 = h2 < 0 ? h2 + 1 : h2;

        // 晚材只占一圈里很小的一段：阈值卡在 0.8 以上才切得出细线。
        // 卡低了整圈都压在深色里，纹路就糊成一片水彩。
        // 过渡宽度固定得很窄，粗细全靠 thr 的高低来给 —— 宽带子也是硬边，软边就成了阴影。
        var thr = 0.79 + 0.13 * h1 + 0.02 * (noise(u * 2.2, v * 1.05) - 0.5);
        var line = smoothstep(thr, thr + 0.035, ring);
        var lineCore = smoothstep(thr + 0.055, 1, ring);
        // 一条木板上年轮不会处处都清楚：有的段落糊掉了，有的特别深
        var presence = 0.32 + 0.68 * smoothstep(0.22, 0.7, blotchNoise(u * 1.7, v * 1.9));
        var bandDark = 0.2 + 1.05 * blotchNoise(u * 1.1 + 3.3, v * 1.6 + 8.1);
        // 一圈里深一脚浅一脚：同一条线上有的地方浓、有的地方只剩影
        bandDark *= 0.62 + 0.8 * h2;
        // 一条线走着走着会淡掉：真实的木纹没有一条是笔直通到底的
        var fade = smoothstep(0.08, 0.58, noise(u * 3.4 + 1.7, v * 9));
        var lineStrength =
          (line * 0.82 + lineCore * 0.35) * presence * bandDark * (0.35 + 0.65 * fade);

        // 导管：沿纹理拉长的短划线，不是圆点 —— 圆点看着像脏
        var pore = fineNoise(u * 96, v * 190);
        var poreDark = pore > 0.72 ? (pore - 0.72) * 4 : 0;
        // 锯痕、小豁口：一两像素的浅坑，凑近看才有的粗糙
        var chip = noise(u * 20, v * 58);
        var chipDark = chip > 0.83 ? (chip - 0.83) * 3.4 : 0;

        // 大块的深浅：靠近树心、含水率不同，一片板子本来就不均匀
        var blotch = blotchNoise(u * 1.0 + 4.1, v * 1.5 + 7.7);

        // 树脂线：一条横穿板子的细深线，边缘略晕开
        var resinD = Math.abs(resinNoise(u * 2.1, v * 0.95) - 0.5);
        var resin = resinD < 0.028 ? (0.028 - resinD) * 17 : 0;

        // 木节本体：中间最深，外面几圈绕着它，环间距被噪声打散过，不是标准同心圆
        var kRad = Math.sqrt(kd2 * (1 + 0.3 * noise(u * 7, v * 7)));
        var knotCore = Math.exp(-kd2 * 420);
        var knotRing = Math.pow(0.5 + 0.5 * Math.sin(kRad * 190), 2);
        var knotDark = clamp(
          knotCore * 0.85 + knotRing * Math.exp(-kd2 * 58) * 0.55,
          0, 1
        );

        // 边缘压一点暗：一块实木板四周本来就不如中心受光，纯平会像一张纸
        var edge = Math.min(1, Math.min(u, 1 - u) * 10, Math.min(v, 1 - v) * 7);

        var tone = clamp(
          0.93 - 0.82 * lineStrength +
          0.17 * (blotch - 0.5) +
          0.065 * (fib1 - 0.5) + 0.06 * (fib2 - 0.5) +
          0.09 * (fib3 - 0.5) + 0.07 * (fib4 - 0.5) -
          0.16 * poreDark - 0.18 * chipDark - resin * 0.16 - knotDark * 0.32,
          0, 1
        );
        var shade =
          (0.88 + 0.12 * edge) * (0.87 + 0.15 * (1 - (u * 0.45 + (1 - v) * 0.55))) +
          0.014 * (fib2 - 0.5);
        var i4 = (y * w + x) * 4;

        px[i4] = (deep[0] + (pale[0] - deep[0]) * tone) * shade;
        px[i4 + 1] = (deep[1] + (pale[1] - deep[1]) * tone) * shade;
        px[i4 + 2] = (deep[2] + (pale[2] - deep[2]) * tone) * shade;
        px[i4 + 3] = 255;

        // 高度：晚材凹下去，导管是孔，锯痕是坑，纤维本身也有起伏
        height[y * w + x] = clamp(
          0.5 - 0.4 * lineStrength - 0.06 * (fib2 - 0.5) - 0.05 * (fib3 - 0.5) -
          0.026 * (fib4 - 0.5) - 0.5 * poreDark - 0.55 * chipDark -
          0.24 * knotDark + 0.05 * (blotch - 0.5),
          0, 1
        );

        // 粗糙度：早材疏松更毛，晚材致密略滑，差别不大才不会看着像塑料
        var rough = clamp(0.84 + 0.11 * (1 - tone) + 0.05 * poreDark + 0.03 * chipDark, 0, 1);
        rpx[i4] = rpx[i4 + 1] = rpx[i4 + 2] = rough * 255;
        rpx[i4 + 3] = 255;
      }
    }

    cg.putImageData(img, 0, 0);
    rg.putImageData(rimg, 0, 0);

    // 高度场 → 法线图。边界像素直接复制，省得四周出现一圈假的棱
    var nrm = document.createElement('canvas');
    nrm.width = w;
    nrm.height = h;
    var ng = nrm.getContext('2d');
    var nimg = ng.createImageData(w, h);
    var npx = nimg.data;
    var STR = 4.6;

    for (var ny2 = 0; ny2 < h; ny2++) {
      var up = (ny2 > 0 ? ny2 - 1 : 0) * w;
      var dn = (ny2 < h - 1 ? ny2 + 1 : h - 1) * w;
      var row = ny2 * w;
      for (var nx2 = 0; nx2 < w; nx2++) {
        var xl = nx2 > 0 ? nx2 - 1 : 0;
        var xr = nx2 < w - 1 ? nx2 + 1 : w - 1;
        var gx = (height[row + xl] - height[row + xr]) * STR;
        var gy = (height[dn + nx2] - height[up + nx2]) * STR;
        var len = Math.sqrt(gx * gx + gy * gy + 1);
        var j4 = (row + nx2) * 4;
        npx[j4] = ((gx / len) * 0.5 + 0.5) * 255;
        npx[j4 + 1] = ((gy / len) * 0.5 + 0.5) * 255;
        npx[j4 + 2] = ((1 / len) * 0.5 + 0.5) * 255;
        npx[j4 + 3] = 255;
      }
    }
    ng.putImageData(nimg, 0, 0);

    woodCache = { color: col, normal: nrm, rough: rgh, edge: woodEdgeMap() };
    return woodCache;
  }

  /**
   * 端面：锯开的断面看到的是年轮的横切，纹路是弧线而不是平行线，
   * 颜色也比板面深一档 —— 正面那张贴图糊上去会露馅。
   */
  function woodEdgeMap() {
    var w = 256;
    var h = 64;
    var cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    var g = cv.getContext('2d');
    var img = g.createImageData(w, h);
    var px = img.data;
    var nz = valueNoise(55201);

    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var u = x / w;
        var v = y / h;
        // 端面上的年轮是一道道横切的弧线，沿板长方向排开
        var arc = 0.5 + 0.5 * Math.sin((u * 7.5 + Math.sin(v * 2.1 + u * 1.3) * 0.7) * Math.PI * 2);
        var dark = Math.pow(arc, 4);
        var shade = (0.82 + 0.16 * nz(u * 6, v * 3) - dark * 0.2) * (1 - v * 0.12);
        var i4 = (y * w + x) * 4;
        px[i4] = 156 * shade;
        px[i4 + 1] = 116 * shade;
        px[i4 + 2] = 76 * shade;
        px[i4 + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return cv;
  }

  /** 锯出来的板：上下两条边各走一点，不是机加工那种笔直的边 */
  function sawnBoard(w, h) {
    var s = new T.Shape();
    var hw = w / 2;
    var hh = h / 2;
    var wob = valueNoise(9317);
    var n = 64;
    var i, t, d;

    s.moveTo(-hw, -hh);
    for (i = 1; i <= n; i++) {
      t = i / n;
      d = (wob(t * 7.5, 0.37) - 0.5) * 0.024;
      s.lineTo(-hw + w * t, -hh + d);
    }
    for (i = n - 1; i >= 0; i--) {
      t = i / n;
      d = (wob(t * 6.2, 4.11) - 0.5) * 0.024;
      s.lineTo(-hw + w * t, hh + d);
    }
    s.closePath();
    return s;
  }

  /* ------------------------------------------------ meadow */
  function Meadow(canvas) {
    this.canvas = canvas;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.isMobile = window.matchMedia('(max-width: 860px), (pointer: coarse)').matches;

    this.renderer = new T.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.isMobile ? 1.5 : 1.75));
    this.renderer.toneMapping = T.NoToneMapping;

    this.scene = new T.Scene();
    this.FOG = new T.Color('#dae9f4');
    this.fogDensity = 0.0105;
    this.scene.fog = new T.FogExp2(this.FOG.getHex(), this.fogDensity);

    this.camera = new T.PerspectiveCamera(55, 1, 0.1, 2400);
    this.camera.position.set(0, terrainHeight(0, 18) + 1.68, 18);

    this.sunDir = new T.Vector3(0.47, 0.26, -0.84).normalize();
    this.clock = new T.Clock();
    this.time = 0;

    // camera state — the framing is fixed, only a slow idle drift and a little
    // parallax keep the meadow alive
    this.yaw = -0.13;
    this.pitch = -0.055;
    this.pointer = new T.Vector2();
    this.pointerSmooth = new T.Vector2();

    // companion state
    // 一进场先正面朝人：pointer 初始是屏幕中心，桌面兔子偏右，
    // 用 pointer 开局会让它先歪着头看中间，2.5 秒后才转回来
    this.gazeMode = 'viewer';
    this.eyeAim = { yaw: 0, pitch: 0 };
    this.blinkLeft = 0;
    this.nextBlink = 2.6;
    // 点一下的跳跃：还剩多久、总时长、幅度
    this.hopLeft = 0;
    this.hopDur = 0.52;
    this.hopPower = 1;
    this.flowP = 0;          // 0 = standing in the meadow, 1 = perched on the panel
    this.flowDir = 0;
    this.flowT0 = 0;         // 这段过渡开始的时刻（performance.now）
    this.flowFrom = 0;       // 这段过渡的起点进度
    this.flowDur = 1.1;      // keep in sync with --flow in style.css
    this.perchPoint = null;  // {x, y} in css pixels — the panel's top edge
    this.homeWorld = new T.Vector3();
    this.perchWorld = new T.Vector3();

    this.trail = [];
    this.trailUniforms = [];
    this.frame = 0;
    this.fps = 0;

    this.curve = new T.CatmullRomCurve3([
      new T.Vector3(0, 0, 19),
      new T.Vector3(1.6, 0, 11),
      new T.Vector3(-0.6, 0, 3),
      new T.Vector3(2.4, 0, -5),
      new T.Vector3(6.2, 0, -13),
      new T.Vector3(4.4, 0, -21)
    ], false, 'catmullrom', 0.4);

    for (var i = 0; i < 10; i++) {
      this.trailUniforms.push(new T.Vector4(0, 0, 0, 1));
    }

    // 初始化各步耗时（毫秒），调性能问题时在控制台看 window.__meadow.buildMs
    this.buildMs = {};
    var __tPrev = performance.now();
    var __mark = function (self, key) {
      var nowMs = performance.now();
      self.buildMs[key] = +(nowMs - __tPrev).toFixed(1);
      __tPrev = nowMs;
    };

    this.buildSky();          __mark(this, 'sky');
    this.buildLights();       __mark(this, 'lights');
    this.buildFaceLight();    __mark(this, 'faceLight');
    this.buildGround();       __mark(this, 'ground');
    this.buildGrass();        __mark(this, 'grass');
    this.buildFlowers();      __mark(this, 'flowers');
    this.buildStarFlowers();  __mark(this, 'starFlowers');
    this.buildDandelions();   __mark(this, 'dandelions');
    this.buildPollen();       __mark(this, 'pollen');
    this.buildTree();         __mark(this, 'tree');
    this.buildBirds();        __mark(this, 'birds');
    this.buildCompanion();    __mark(this, 'companion');
    // 木牌不依赖灯光，建好先藏着；拿到「今天的药」才立起来
    this.buildSign();          __mark(this, 'sign');

    this.onResize = this.resize.bind(this);
    window.addEventListener('resize', this.onResize);
    this.resize();
    __mark(this, 'resize');
    // 云的落点依赖相机的 fov / 俯仰角，必须等 resize 把相机参数设好之后再建
    this.buildClouds();       __mark(this, 'clouds');
    // 开发时直接挂；生产里加 ?debug=1 才挂，方便线上排查转场与注视
    if (typeof window !== 'undefined' && (process.env.NODE_ENV !== 'production' || /[?&]debug=1/.test(window.location.search))) {
      window.__meadow = this;
    }
  }

  Meadow.prototype = {

    /* ---------------- sky ---------------- */
    buildSky: function () {
      var geo = new T.SphereGeometry(1100, 48, 28);
      var mat = new T.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uSunDir: { value: this.sunDir },
          uZenith: { value: new T.Color('#4a8fc9') },
          uMid: { value: new T.Color('#86bfe9') },
          uHorizon: { value: new T.Color('#cfe3f3') },
          uSunColor: { value: new T.Color('#ffeec4') }
        },
        vertexShader: SKY_VS,
        fragmentShader: SKY_FS,
        side: T.BackSide,
        depthWrite: false,
        fog: false
      });
      this.sky = new T.Mesh(geo, mat);
      this.sky.frustumCulled = false;
      this.sky.renderOrder = -10;
      this.scene.add(this.sky);
    },


    /* ---------------- 写实积云 ---------------- */

    /**
     * 现场生成一张"积云密度图"：R 通道存密度，越亮越厚。
     * 做法是把 fbm 噪声乘上「下平上蓬」的垂直剖面，再用软阈值切出团块轮廓，
     * 最后四周收边保证贴图外圈是全透明的 —— 不引入任何外部贴图。
     * 一次做四张不同种子的，轮流用，避免一眼看出重复。
     */
    makeCloudTexture: function (seed) {
      var W = 256, H = 256;
      var cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      var ctx = cv.getContext('2d');
      var img = ctx.createImageData(W, H);
      var data = img.data;

      function h2(x, y) {
        var n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
        return n - Math.floor(n);
      }
      function vn(x, y) {
        var ix = Math.floor(x), iy = Math.floor(y);
        var fx = x - ix, fy = y - iy;
        var ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
        var a = h2(ix, iy), b = h2(ix + 1, iy), c = h2(ix, iy + 1), d = h2(ix + 1, iy + 1);
        var top = a + (b - a) * ux, bot = c + (d - c) * ux;
        return top + (bot - top) * uy;
      }
      function fbm(x, y, oct) {
        var v = 0, amp = 0.5, fx = x, fy = y;
        for (var i = 0; i < oct; i++) {
          v += amp * vn(fx, fy);
          fx *= 2.03; fy *= 2.03; amp *= 0.5;
        }
        return v;
      }
      function sm(a, b, x) {
        var t = (x - a) / (b - a);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        return t * t * (3 - 2 * t);
      }

      // 积云轮廓 = 几个圆团取并集：底排三个、中层两个、顶上一个。
      // 直接拿噪声当形状会得到一条横带，叠团圆才有"花椰菜"那种上头鼓、底下平的体态。
      var lobes = [
        [0.26, 0.66, 0.23, 0.20],
        [0.50, 0.62, 0.27, 0.24],
        [0.74, 0.66, 0.22, 0.19],
        [0.38, 0.44, 0.20, 0.17],
        [0.62, 0.42, 0.21, 0.18],
        [0.50, 0.28, 0.16, 0.14]
      ];

      for (var y = 0; y < H; y++) {
        var v = y / (H - 1);                      // 0 顶 → 1 底
        for (var x = 0; x < W; x++) {
          var u = x / (W - 1);

          // 轮廓：所有团里取最饱满的那个
          var base = 0;
          for (var L = 0; L < lobes.length; L++) {
            var dx = (u - lobes[L][0]) / lobes[L][2];
            var dy = (v - lobes[L][1]) / lobes[L][3];
            var r = 1 - (dx * dx + dy * dy);
            if (r > base) base = r;
          }
          base = sm(0, 0.55, base);

          var nx = u * 5.0, ny = v * 5.0;
          // 域扭曲，边缘被气流拱得不规则
          var wx = fbm(nx * 0.6 + 11.3, ny * 0.6 + 3.1, 3);
          var wy = fbm(nx * 0.6 + 5.7, ny * 0.6 + 8.9, 3);
          var n1 = fbm(nx + wx * 1.5, ny + wy * 1.5, 5);
          var n2 = fbm(nx * 2.7 + 21.0, ny * 2.7 + 7.4, 4);

          // 轮廓内的密度随噪声起伏；底部切平，顶部长得更散
          var mass = base * (0.45 + 1.05 * (n1 * 0.72 + n2 * 0.34));
          mass *= 1 - sm(0.80, 0.97, v);

          var a = sm(0.24, 0.60, mass);
          a *= sm(0.0, 0.07, u) * (1 - sm(0.93, 1.0, u));
          a *= sm(0.0, 0.05, v);

          var i4 = (y * W + x) * 4;
          var val = Math.round(Math.min(1, a) * 255);
          data[i4] = val;
          data[i4 + 1] = val;
          data[i4 + 2] = val;
          data[i4 + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);

      var tex = new T.CanvasTexture(cv);
      tex.colorSpace = T.NoColorSpace;
      tex.wrapS = T.ClampToEdgeWrapping;
      tex.wrapT = T.ClampToEdgeWrapping;
      tex.minFilter = T.LinearMipmapLinearFilter;
      tex.magFilter = T.LinearFilter;
      return tex;
    },

    makeCloudMaterial: function (map, opacity, lightXY, haze, flip, tint) {
      return new T.ShaderMaterial({
        uniforms: {
          uMap: { value: map },
          uOpacity: { value: opacity },
          uLightXY: { value: lightXY },
          // 直接取场景里那两盏灯的色值：受光的暖白、背光的冷灰、薄处的天光。
          // 灯光本身一点没动，只是把它的颜色读过来，云和草地的色温才不会打架。
          uSun: { value: tint.sun },
          uShadow: { value: tint.shadow },
          uAmbient: { value: tint.ambient },
          uHaze: { value: new T.Color('#' + this.FOG.getHexString()) },
          uHazeAmt: { value: haze },
          uTime: { value: 0 },
          uPhase: { value: Math.random() * 20 },
          uFlipX: { value: flip ? 1 : 0 }
        },
        vertexShader: CLOUD_VS,
        fragmentShader: CLOUD_FS,
        transparent: true,
        depthWrite: false,
        side: T.FrontSide,
        fog: false
      });
    },

    /**
     * 三个高度带的积云。每朵云由四层半透明贴片叠出体积（雾底 / 主体 / 顶团 / 底部），
     * 层与层之间的偏移和透明度错开，所以近看也不是一张平面。
     * 云全部排在兔子后方的高空，且 raycast 是空函数 —— 不遮挡、不抢点击。
     */
    /** 屏幕 y（CSS 像素）→ 指定深度平面上的世界 y。自动适配不同 fov 与俯仰角 */
    worldYAtScreen: function (screenY, z) {
      var cam = this.camera;
      cam.updateMatrixWorld();
      var ny = 1 - (screenY / window.innerHeight) * 2;
      var v = this._cloudProbe || (this._cloudProbe = new T.Vector3());
      v.set(0, ny, 0.5).unproject(cam).sub(cam.position);
      var t = (z - cam.position.z) / (v.z || -1e-6);
      return cam.position.y + v.y * t;
    },

    /** 地平线在屏幕上的 y：云不能压到草地下面去 */
    horizonScreenY: function () {
      var cam = this.camera;
      cam.updateMatrixWorld();
      var fwd = this._cloudFwd || (this._cloudFwd = new T.Vector3());
      fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) return window.innerHeight * 0.55;
      fwd.normalize();
      var p = this._cloudHorizon || (this._cloudHorizon = new T.Vector3());
      p.copy(cam.position).addScaledVector(fwd, 1e5).project(cam);
      return (-p.y * 0.5 + 0.5) * window.innerHeight;
    },

    buildClouds: function () {
      var textures = [];
      for (var i = 0; i < 4; i++) textures.push(this.makeCloudTexture(3.1 + i * 13.7));

      var group = new T.Group();
      group.name = 'clouds';
      this.scene.add(group);
      this.cloudGroup = group;
      this.clouds = [];
      this.cloudWrap = 172;

      // 光从画面哪个方向来：直接由既有的太阳方向投影到画面平面
      var lx = this.sunDir.x, ly = this.sunDir.y;
      var ll = Math.sqrt(lx * lx + ly * ly) || 1;
      var lightXY = new T.Vector2(lx / ll, ly / ll);

      // 三段"屏幕高度带"（相对地平线的高度比例）× 三个深度：
      // 近的高一些、远的一点点贴近地平线，越远越大越淡 —— 空气透视就出来了。
      // 用屏幕比例而不是写死世界 y，手机上（fov 66、俯角 19°）也照样落在天空里。
      // 相机在构造函数里还没摆好俯仰角（第一次 updateCamera 之后才稳定）。
      // 先让它一步到位，否则按屏幕比例算出来的云会整体偏高，手机上直接飘出画面。
      this.updateCamera(4);

      var hz = this.horizonScreenY();
      var bands = [
        { z: -72,  sy: [0.30, 0.52], w: [26, 38], op: 0.92, n: 3, sp: [0.9, 1.3], haze: 0.08 },
        { z: -112, sy: [0.20, 0.38], w: [36, 52], op: 0.74, n: 3, sp: [0.6, 0.9], haze: 0.18 },
        { z: -158, sy: [0.08, 0.24], w: [50, 72], op: 0.54, n: 2, sp: [0.4, 0.65], haze: 0.30 }
      ];

      // 从现有灯光取色：太阳的暖白、天空的冷蓝，云的明暗层次跟场景是同一套
      var sunLight = null, hemiLight = null;
      for (var li = 0; li < this.scene.children.length; li++) {
        var o = this.scene.children[li];
        if (o.isDirectionalLight && o.intensity >= 1 && !sunLight) sunLight = o;
        if (o.isHemisphereLight && !hemiLight) hemiLight = o;
      }
      var sunCol = sunLight ? sunLight.color.clone() : new T.Color('#fff2d2');
      var hemiCol = hemiLight ? hemiLight.color.clone() : new T.Color('#dcefff');
      var tint = {
        // 受光面：太阳色再提亮一点，接近过曝的白
        sun: sunCol.clone().lerp(new T.Color('#ffffff'), 0.62),
        // 天光：半球光的天顶色
        ambient: hemiCol.clone(),
        // 背光面：天光压暗，掺一点太阳色免得发紫
        shadow: hemiCol.clone().multiplyScalar(0.52).lerp(sunCol, 0.16)
      };

      var ti = 0;
      var sizeK = this.isMobile ? 0.6 : 1;
      for (var b = 0; b < bands.length; b++) {
        var band = bands[b];
        for (var k = 0; k < band.n; k++) {
          var w = rand(band.w[0], band.w[1]) * sizeK;
          var h = w * rand(0.58, 0.68);
          var span = this.cloudWrap * 1.5;
          var x = -this.cloudWrap * 0.75 + (k + 0.5) * (span / band.n) + rand(-20, 20);

          var cg = new T.Group();
          var sy = rand(band.sy[0], band.sy[1]);
          cg.position.set(x, this.worldYAtScreen(hz * sy, band.z), band.z + rand(-12, 12));

          // 四层：雾底托体积、主体最实、顶部一团、底部一条暗边
          var layers = [
            { s: 1.24, ox: 0, oy: 0.02, z: -7, op: 0.50 },
            { s: 1.0, ox: 0, oy: 0, z: 0, op: 1.0 },
            { s: 0.66, ox: -0.2, oy: 0.3, z: 4, op: 0.86 },
            { s: 0.88, ox: 0.2, oy: -0.13, z: 3, op: 0.68 }
          ];

          var quads = [];
          for (var L = 0; L < layers.length; L++) {
            var lay = layers[L];
            var mat = this.makeCloudMaterial(
              textures[ti++ % 4],
              band.op * lay.op,
              lightXY,
              band.haze,
              Math.random() < 0.5,
              tint
            );
            var mesh = new T.Mesh(new T.PlaneGeometry(w * lay.s, h * lay.s), mat);
            mesh.position.set(w * lay.ox, h * lay.oy, lay.z);
            // 云不参与任何射线拾取：点兔子只看屏幕空间，双保险
            mesh.raycast = function () {};
            mesh.frustumCulled = false;
            cg.add(mesh);
            quads.push(mesh);
          }

          group.add(cg);
          this.clouds.push({
            group: cg,
            speed: rand(band.sp[0], band.sp[1]),
            // 一点朝向差异，别所有云都板板正正
            yaw: rand(-0.12, 0.12),
            // 屏幕比例 + 深度：窗口尺寸变了按新相机重新落位
            sy: sy,
            z: cg.position.z
          });
        }
      }
    },

    /** 视口 / 相机参数变了，按屏幕比例重新算每朵云的高度 */
    syncCloudHeights: function () {
      if (!this.clouds || !this.clouds.length) return;
      var hz = this.horizonScreenY();
      for (var i = 0; i < this.clouds.length; i++) {
        var c = this.clouds[i];
        c.group.position.y = this.worldYAtScreen(hz * c.sy, c.z);
      }
    },

    /** 缓慢横向漂移 + 循环；同时把时间喂给云的自呼吸 */
    updateClouds: function (dt) {
      if (!this.clouds) return;
      var wrap = this.cloudWrap;
      var cam = this.camera;
      for (var i = 0; i < this.clouds.length; i++) {
        var c = this.clouds[i];
        var pos = c.group.position;
        pos.x += c.speed * dt;
        if (pos.x > wrap) pos.x = -wrap;
        // 一直朝着镜头偏一点：云飘到画面两侧时不会因为侧看而被压扁
        c.group.rotation.y = Math.atan2(cam.position.x - pos.x, cam.position.z - pos.z) + c.yaw;
      }
      for (var j = 0; j < this.cloudGroup.children.length; j++) {
        var kids = this.cloudGroup.children[j].children;
        for (var k = 0; k < kids.length; k++) {
          kids[k].material.uniforms.uTime.value = this.time;
        }
      }
    },
    /* ---------------- 只照脸的小灯 ---------------- */

    buildFaceLight: function () {
      // 兔子是奶油白的毛，草地上正面会显得平。这盏暖白小灯跟着它走，
      // 从镜头这一侧、略偏右上方补一点光：鼻子、腮红、眼睛的立体感就出来了。
      // 近距衰减 + 不投影，只影响兔子本体那一小块。
      var light = new T.PointLight(0xfff2df, 0, 4.2, 2);
      light.castShadow = false;
      this.scene.add(light);
      this.faceLight = light;
      // 灯拉远到 1.85 倍头身、强度只给到原来的五成：脸上是柔柔一层，不是一块高光
      this.faceBase = 1.7;
      this.faceDist = 1.85;
    },

    buildLights: function () {
      var hemi = new T.HemisphereLight(0xdcefff, 0x54742f, 0.92);
      this.scene.add(hemi);

      var sun = new T.DirectionalLight(0xfff2d2, 1.45);
      sun.position.copy(this.sunDir).multiplyScalar(60);
      this.scene.add(sun);

      var fill = new T.DirectionalLight(0xffe9cf, 0.62);
      fill.position.set(-26, 14, 42);
      this.scene.add(fill);
    },

    /* ---------------- terrain ---------------- */
    buildGround: function () {
      var size = 940, seg = 230;
      var geo = new T.PlaneGeometry(size, size, seg, seg);
      geo.rotateX(-Math.PI / 2);

      var pos = geo.attributes.position;
      var colors = new Float32Array(pos.count * 3);
      var c = new T.Color();
      var dark = new T.Color('#3f6b2b');
      var mid = new T.Color('#5c8a37');
      var light = new T.Color('#7fa246');

      for (var i = 0; i < pos.count; i++) {
        var x = pos.getX(i), z = pos.getZ(i);
        var y = terrainHeight(x, z);
        pos.setY(i, y);

        var n = 0.5 + 0.5 * Math.sin(x * 0.7 + Math.cos(z * 0.5) * 2.1) * Math.cos(z * 0.62);
        c.copy(dark).lerp(mid, n);
        c.lerp(light, clamp(y * 0.05 + n * 0.25, 0, 0.45));
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new T.BufferAttribute(colors, 3));
      geo.computeVertexNormals();

      var mat = new T.MeshStandardMaterial({
        vertexColors: true, roughness: 0.98, metalness: 0.0
      });
      var mesh = new T.Mesh(geo, mat);
      mesh.position.set(MEADOW_CENTER.x, 0, MEADOW_CENTER.z);
      // ground heights were computed in world space; shifting the mesh would
      // move them, so bake the offset into vertices instead.
      mesh.position.set(0, 0, 0);
      this.scene.add(mesh);
    },

    /* ---------------- grass ---------------- */
    buildGrass: function () {
      var segments = 3;
      var positions = [], indices = [];
      for (var i = 0; i <= segments; i++) {
        var t = i / segments;
        var w = 0.5 * Math.pow(1 - t, 0.6);
        var zc = 0.16 * t * t;
        positions.push(-w, t, zc, w, t, zc);
      }
      for (var s = 0; s < segments; s++) {
        var a = s * 2, b = a + 1, c2 = a + 2, d = a + 3;
        indices.push(a, c2, b, b, c2, d);
      }

      var geo = new T.InstancedBufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
      geo.setIndex(indices);

      var COUNT = this.isMobile ? 36000 : 98000;
      var RADIUS = this.isMobile ? 32 : 46;
      var offsets = new Float32Array(COUNT * 3);
      var scales = new Float32Array(COUNT * 2);
      var rots = new Float32Array(COUNT * 2);
      var phases = new Float32Array(COUNT);
      var tints = new Float32Array(COUNT * 3);

      for (var n = 0; n < COUNT; n++) {
        var ang = Math.random() * Math.PI * 2;
        var r = Math.sqrt(Math.random()) * RADIUS;
        // a little cluster bias so the field is not evenly speckled
        if (Math.random() < 0.32) r *= 0.82;
        var x = MEADOW_CENTER.x + Math.cos(ang) * r;
        var z = MEADOW_CENTER.z + Math.sin(ang) * r;

        offsets[n * 3] = x;
        offsets[n * 3 + 1] = terrainHeight(x, z) - 0.02;
        offsets[n * 3 + 2] = z;

        var h = rand(0.30, 0.72) * (r > RADIUS * 0.8 ? 1.1 : 1);
        scales[n * 2] = rand(0.023, 0.042);
        scales[n * 2 + 1] = h;

        var rot = Math.random() * Math.PI * 2;
        rots[n * 2] = Math.cos(rot);
        rots[n * 2 + 1] = Math.sin(rot);
        phases[n] = Math.random() * Math.PI * 2;

        var patch = 0.90 + 0.16 * Math.sin(x * 0.085 + Math.cos(z * 0.06) * 1.7) * Math.cos(z * 0.075);
        var v = rand(0.88, 1.08) * patch;
        tints[n * 3] = v * rand(0.95, 1.02);
        tints[n * 3 + 1] = v;
        tints[n * 3 + 2] = v * rand(0.82, 0.95);
      }

      geo.setAttribute('aOffset', new T.InstancedBufferAttribute(offsets, 3));
      geo.setAttribute('aScale', new T.InstancedBufferAttribute(scales, 2));
      geo.setAttribute('aRot', new T.InstancedBufferAttribute(rots, 2));
      geo.setAttribute('aPhase', new T.InstancedBufferAttribute(phases, 1));
      geo.setAttribute('aTint', new T.InstancedBufferAttribute(tints, 3));
      geo.instanceCount = COUNT;
      geo.boundingSphere = new T.Sphere(new T.Vector3(MEADOW_CENTER.x, 0, MEADOW_CENTER.z), RADIUS + 10);

      var mat = new T.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uWindDir: { value: new T.Vector2(0.86, 0.5).normalize() },
          uWind: { value: 0.06 },
          uTrail: { value: this.trailUniforms },
          uRoot: { value: new T.Color('#2b4d1e') },
          uTip: { value: new T.Color('#83b445') },
          uSun: { value: new T.Color('#cfe08a') },
          uFog: { value: this.FOG },
          uFogDensity: { value: this.fogDensity }
        },
        vertexShader: GRASS_VS,
        fragmentShader: GRASS_FS,
        side: T.DoubleSide,
        fog: false
      });

      this.grass = new T.Mesh(geo, mat);
      this.grass.frustumCulled = false;
      this.scene.add(this.grass);
    },

    /* ---------------- flowers ---------------- */
    buildFlowers: function () {
      var COUNT = this.isMobile ? 900 : 2400;
      var RADIUS = this.isMobile ? 26 : 38;
      var pos = new Float32Array(COUNT * 3);
      var size = new Float32Array(COUNT);
      var col = new Float32Array(COUNT * 3);
      var palette = [
        [1.0, 0.99, 0.93],
        [1.0, 0.98, 0.9],
        [0.99, 0.86, 0.86],
        [0.99, 0.94, 0.7]
      ];
      for (var i = 0; i < COUNT; i++) {
        var a = Math.random() * Math.PI * 2;
        var r = Math.sqrt(Math.random()) * RADIUS;
        var x = MEADOW_CENTER.x + Math.cos(a) * r;
        var z = MEADOW_CENTER.z + Math.sin(a) * r;
        pos[i * 3] = x;
        pos[i * 3 + 1] = terrainHeight(x, z) + rand(0.22, 0.56);
        pos[i * 3 + 2] = z;
        size[i] = rand(0.12, 0.21);
        var p = palette[(Math.random() * palette.length) | 0];
        col[i * 3] = p[0];
        col[i * 3 + 1] = p[1];
        col[i * 3 + 2] = p[2];
      }
      var geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      geo.setAttribute('aSize', new T.BufferAttribute(size, 1));
      geo.setAttribute('aColor', new T.BufferAttribute(col, 3));

      var tex = flowerTexture();
      tex.colorSpace = T.SRGBColorSpace;
      var mat = new T.ShaderMaterial({
        uniforms: {
          uMap: { value: tex },
          uScale: { value: 600 },
          uMaxSize: { value: 90 },
          uOpacity: { value: 1 },
          uFog: { value: this.FOG },
          uFogDensity: { value: this.fogDensity }
        },
        vertexShader: POINTS_VS,
        fragmentShader: POINTS_FS,
        transparent: true,
        depthWrite: false
      });
      this.flowers = new T.Points(geo, mat);
      this.flowers.frustumCulled = false;
      this.scene.add(this.flowers);
    },

    /* ---------------- star flowers ---------------- */
    // 零星的蓝色星辰花：成小簇散在草里，不抢白花的密度，只负责点在绿底上的蓝
    buildStarFlowers: function () {
      var clusters = this.isMobile ? 18 : 34;
      var perCluster = this.isMobile ? 7 : 11;
      var COUNT = clusters * perCluster;
      var pos = new Float32Array(COUNT * 3);
      var size = new Float32Array(COUNT);
      var col = new Float32Array(COUNT * 3);

      var idx = 0;
      for (var ci = 0; ci < clusters; ci++) {
        var ca = Math.random() * Math.PI * 2;
        var cr = rand(5.5, this.isMobile ? 23 : 33);
        var ccx = MEADOW_CENTER.x + Math.cos(ca) * cr;
        var ccz = MEADOW_CENTER.z + Math.sin(ca) * cr;
        for (var k = 0; k < perCluster; k++) {
          var a2 = Math.random() * Math.PI * 2;
          var rr = Math.pow(Math.random(), 0.6) * 1.35;
          var x = ccx + Math.cos(a2) * rr;
          var z = ccz + Math.sin(a2) * rr;
          pos[idx * 3] = x;
          pos[idx * 3 + 1] = terrainHeight(x, z) + rand(0.16, 0.40);
          pos[idx * 3 + 2] = z;
          size[idx] = rand(0.14, 0.235);
          var v = rand(0.90, 1.06);
          col[idx * 3] = v * 0.88;
          col[idx * 3 + 1] = v * 0.95;
          col[idx * 3 + 2] = v * 1.02;
          idx++;
        }
      }

      var geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      geo.setAttribute('aSize', new T.BufferAttribute(size, 1));
      geo.setAttribute('aColor', new T.BufferAttribute(col, 3));

      var tex = starFlowerTexture();
      tex.colorSpace = T.SRGBColorSpace;
      var mat = new T.ShaderMaterial({
        uniforms: {
          uMap: { value: tex },
          uScale: { value: 600 },
          uMaxSize: { value: 84 },
          uOpacity: { value: 0.96 },
          uFog: { value: this.FOG },
          uFogDensity: { value: this.fogDensity }
        },
        vertexShader: POINTS_VS,
        fragmentShader: STAR_FS,
        transparent: true,
        depthWrite: false
      });
      this.starFlowers = new T.Points(geo, mat);
      this.starFlowers.frustumCulled = false;
      this.scene.add(this.starFlowers);
    },

    /* ---------------- dandelions ---------------- */
    buildDandelions: function () {
      var perHead = 5;
      var count = 0;
      var headList = [];

      // 兔子身位（含绒球半径）+ 一点余量：这块地不种蒲公英，免得挡在它前面
      var rg = this.rabbitGround();
      var mobileNow = this.isMobile;
      var keep = 2.6;
      function clearOfRabbit(x, z) {
        var dx = x - rg.x, dz = z - rg.z;
        return dx * dx + dz * dz > keep * keep;
      }


      var target = this.isMobile ? 26 : 48;
      for (var i = 0; i < target; i++) {
        var cx = 0, cz = 0, tries = 0;
        do {
          var a = Math.random() * Math.PI * 2;
          var r = rand(3.0, this.isMobile ? 21 : 34);
          cx = MEADOW_CENTER.x + Math.cos(a) * r;
          cz = MEADOW_CENTER.z + Math.sin(a) * r;
          tries++;
        } while (tries < 20 && (this.pathDistance(cx, cz) < 5.5 || !clearOfRabbit(cx, cz)));
        headList.push({
          x: cx, z: cz,
          h: rand(0.95, 1.3),
          size: rand(0.30, 0.40)
        });
      }

      // 贴着画面下沿的一圈前景（比中景更近、绒球更大，用来压住构图）
      [[-1.9, 14.4, 0.40], [-0.8, 15.4, 0.38], [-3.5, 13.7, 0.40],
       [4.9, 14.6, 0.37], [0.3, 15.5, 0.35], [-2.7, 15.3, 0.34],
       [-4.6, 12.6, 0.34], [5.4, 12.4, 0.34], [6.2, 11.6, 0.32]].forEach(function (spot) {
        // 手机上兔子几乎占满画面、视场又窄，贴镜头这几丛会直接糊在它脸上，只留两侧的
        if (mobileNow && spot[1] > 13.2) return;
        if (!clearOfRabbit(spot[0], spot[1])) return;
        headList.push({ x: spot[0], z: spot[1], h: rand(0.95, 1.15), size: spot[2] });
      });

      // a few heads right beside the path, for the foreground
      [[-3.4, 13.5, 0.44], [4.4, 15.0, 0.40], [-4.8, 6.0, 0.42],
       [8.6, 12.2, 0.38], [-7.4, 16.4, 0.40], [10.8, 4.6, 0.36]].forEach(function (spot) {
        if (!clearOfRabbit(spot[0], spot[1])) return;
        headList.push({ x: spot[0], z: spot[1], h: rand(1.0, 1.3), size: spot[2] });
      });

      count = headList.length * perHead;
      var pos = new Float32Array(count * 3);
      var size = new Float32Array(count);
      var col = new Float32Array(count * 3);

      for (var k = 0; k < headList.length; k++) {
        var hd = headList[k];
        hd.y = terrainHeight(hd.x, hd.z) + hd.h;
        for (var j = 0; j < perHead; j++) {
          var idx = k * perHead + j;
          pos[idx * 3] = hd.x + rand(-0.05, 0.05);
          pos[idx * 3 + 1] = hd.y + rand(-0.05, 0.05);
          pos[idx * 3 + 2] = hd.z + rand(-0.05, 0.05);
          size[idx] = hd.size;
          col[idx * 3] = 1.0; col[idx * 3 + 1] = 0.99; col[idx * 3 + 2] = 0.94;
        }
      }

      var geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      geo.setAttribute('aSize', new T.BufferAttribute(size, 1));
      geo.setAttribute('aColor', new T.BufferAttribute(col, 3));

      var tex = puffTexture();
      tex.colorSpace = T.SRGBColorSpace;
      var mat = new T.ShaderMaterial({
        uniforms: {
          uMap: { value: tex },
          uScale: { value: 600 },
          uMaxSize: { value: 120 },
          uOpacity: { value: 0.9 },
          uFog: { value: this.FOG },
          uFogDensity: { value: this.fogDensity }
        },
        vertexShader: POINTS_VS,
        fragmentShader: POINTS_FS,
        transparent: true,
        depthWrite: false
      });
      this.dandelions = new T.Points(geo, mat);
      this.dandelions.frustumCulled = false;
      this.scene.add(this.dandelions);

      // stems, so the heads are not floating puffs
      // 杆子细一点、暗一点，并且用 6 段而不是 4 段：
      // 原来 0.014 半径 + 亮绿，凑近看就是插在草里的一根签子
      var stemGeo = new T.CylinderGeometry(0.0021, 0.0058, 1, 6, 1);
      stemGeo.translate(0, 0.5, 0);
      // 颜色取草地中间调偏亮一点：太深会变成一根扎眼的地线，太亮又像塑料杆
      var stemMat = new T.MeshStandardMaterial({ color: '#6f9445', roughness: 1.0, metalness: 0 });
      var stems = new T.InstancedMesh(stemGeo, stemMat, headList.length);
      var mtx = new T.Matrix4();
      var q = new T.Quaternion();
      var sc3 = new T.Vector3();
      var p3 = new T.Vector3();
      // 离镜头近的那几丛，杆子只留露在草丛外面的上半截：
      // 整根从绒球拉到地面时，凑近看就是草地上的一条绿线
      var camPos = this.camera.position;
      for (var hi = 0; hi < headList.length; hi++) {
        var hd2 = headList[hi];
        var near = Math.sqrt(
          (hd2.x - camPos.x) * (hd2.x - camPos.x) + (hd2.z - camPos.z) * (hd2.z - camPos.z)
        ) < 9;
        // 杆顶收到绒球下沿以内：顶到球心的话，会有一根线从球中间穿过去。
        // 底端仍然踩在地面上，近处那几丛只保留上面一半（下半截让草挡住）
        var stemBottom = hd2.y - hd2.h;
        var topY = hd2.y - hd2.size * 0.45;
        var stemLen = (topY - stemBottom) * (near ? 0.5 : 1);
        p3.set(hd2.x, topY - stemLen, hd2.z);
        q.setFromEuler(new T.Euler(rand(-0.05, 0.05), 0, rand(-0.05, 0.05)));
        sc3.set(1, stemLen, 1);
        mtx.compose(p3, q, sc3);
        stems.setMatrixAt(hi, mtx);
      }
      stems.instanceMatrix.needsUpdate = true;
      stems.frustumCulled = false;
      this.scene.add(stems);

      // drifting seeds
      // 种子是贴在镜头前的点，靠近镜头的一颗会被投影成一大团模糊的白斑。
      // 所以要挡住「落在兔子身上」的那些点：用深度估算兔子在那个距离上占多宽 ——
      // 越靠近镜头，同样的世界偏移投影得越开，所以允许的半宽按深度等比缩。
      var rgSeed = this.rabbitGround();
      var camZSeed = this.camera.position.z;
      var rabbitDepth = Math.max(0.8, camZSeed - rgSeed.z);
      function seedSafe(x, z) {
        var depth = camZSeed - z;
        if (depth <= 0.5) return false;           // 已经贴到镜头、甚至在后头
        if (depth < 3.2) return false;            // 太近：再小的点也会糊成一片
        var half = 1.9 * (depth / rabbitDepth);
        return Math.abs(x - rgSeed.x) > half;
      }
      var n = this.isMobile ? 60 : 130;
      // 镜头前再加一层：更近、更大、飘得更慢，从眼前慢慢过去
      // 手机屏幕窄、兔子几乎占满，前景种子只留少量放在两侧
      var nearN = this.isMobile ? 12 : 88;
      var seedTotal = n + nearN;
      this.seedData = [];
      var sp = new Float32Array(seedTotal * 3);
      var ss = new Float32Array(seedTotal);
      var sc = new Float32Array(seedTotal * 3);
      for (var s2 = 0; s2 < n; s2++) {
        var sa = Math.random() * Math.PI * 2;
        var sr = Math.sqrt(Math.random()) * (this.isMobile ? 16 : 26);
        var sx = Math.cos(sa) * sr, sz = Math.sin(sa) * sr;
        // 抽到兔子身上就再抽一次，几次都不行就放到旁边去
        for (var st = 0; st < 6 && !seedSafe(sx, sz); st++) {
          sa = Math.random() * Math.PI * 2;
          sr = Math.sqrt(Math.random()) * (this.isMobile ? 16 : 26);
          sx = Math.cos(sa) * sr; sz = Math.sin(sa) * sr;
        }
        if (!seedSafe(sx, sz)) { sx = rgSeed.x + (sx > rgSeed.x ? 5.2 : -5.2); }
        var sy = rand(0.8, 5.0);
        sp[s2 * 3] = sx; sp[s2 * 3 + 1] = sy; sp[s2 * 3 + 2] = sz;
        ss[s2] = rand(0.05, 0.14);
        sc[s2 * 3] = 1.0; sc[s2 * 3 + 1] = 0.995; sc[s2 * 3 + 2] = 0.96;
        this.seedData.push({
          vy: rand(0.10, 0.32),
          phase: Math.random() * Math.PI * 2,
          speed: rand(0.4, 1.0),
          baseX: sx,
          baseZ: sz
        });
      }
      // 前景那层：避开兔子所在的中间偏右，走画面左右两侧
      for (var q2 = 0; q2 < nearN; q2++) {
        var ni = n + q2;
        var leftSide = Math.random() < 0.6;
        // 桌面兔子在 x≈2.45，前景种子分左右两带避开它；手机上屏幕窄，收在 ±1.4 之内
        var nx = this.isMobile
          ? (leftSide ? rand(-3.4, -1.8) : rand(2.6, 3.4))
          : (leftSide ? rand(-2.8, -0.6) : rand(4.4, 6.6));
        // 手机上不收进这么近，否则会投到兔子脸上
        var nz = this.isMobile ? rand(11.2, 12.6) : rand(11.2, 14.6);
        for (var nt = 0; nt < 6 && !seedSafe(nx, nz); nt++) {
          nx = this.isMobile
            ? (leftSide ? rand(-3.4, -1.8) : rand(2.6, 3.4))
            : (leftSide ? rand(-2.8, -0.6) : rand(4.4, 6.6));
          nz = this.isMobile ? rand(11.2, 12.6) : rand(11.2, 14.6);
        }
        var ny = rand(0.7, 3.1);
        sp[ni * 3] = nx;
        sp[ni * 3 + 1] = ny;
        sp[ni * 3 + 2] = nz;
        ss[ni] = rand(0.07, 0.13);
        sc[ni * 3] = 1.0; sc[ni * 3 + 1] = 0.995; sc[ni * 3 + 2] = 0.96;
        this.seedData.push({
          vy: rand(0.06, 0.18),
          phase: Math.random() * Math.PI * 2,
          speed: rand(0.22, 0.55),
          baseX: nx,
          baseZ: nz
        });
      }

      var sgeo = new T.BufferGeometry();
      sgeo.setAttribute('position', new T.BufferAttribute(sp, 3));
      sgeo.setAttribute('aSize', new T.BufferAttribute(ss, 1));
      sgeo.setAttribute('aColor', new T.BufferAttribute(sc, 3));
      var stex = seedTexture();
      stex.colorSpace = T.SRGBColorSpace;
      var smat = new T.ShaderMaterial({
        uniforms: {
          uMap: { value: stex },
          uScale: { value: 600 },
          // 前景那层离镜头更近，允许到 64px，不然会被上限压成一样大
          uMaxSize: { value: 52 },
          uOpacity: { value: 0.9 },
          uFog: { value: this.FOG },
          uFogDensity: { value: this.fogDensity }
        },
        vertexShader: POINTS_VS,
        fragmentShader: POINTS_FS,
        transparent: true,
        depthWrite: false
      });
      this.seeds = new T.Points(sgeo, smat);
      this.seeds.frustumCulled = false;
      this.scene.add(this.seeds);
    },

    /* ---------------- pollen ---------------- */
    buildPollen: function () {
      var n = this.isMobile ? 220 : 520;
      var pos = new Float32Array(n * 3);
      var size = new Float32Array(n);
      var col = new Float32Array(n * 3);
      for (var i = 0; i < n; i++) {
        pos[i * 3] = rand(-26, 30);
        pos[i * 3 + 1] = rand(0.4, 8);
        pos[i * 3 + 2] = rand(-32, 20);
        size[i] = rand(0.02, 0.06);
        col[i * 3] = 1; col[i * 3 + 1] = 0.97; col[i * 3 + 2] = 0.82;
      }
      var geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      geo.setAttribute('aSize', new T.BufferAttribute(size, 1));
      geo.setAttribute('aColor', new T.BufferAttribute(col, 3));
      var tex = dotTexture();
      var mat = new T.ShaderMaterial({
        uniforms: {
          uMap: { value: tex },
          uScale: { value: 600 },
          uMaxSize: { value: 26 },
          uOpacity: { value: 0.7 },
          uFog: { value: this.FOG },
          uFogDensity: { value: this.fogDensity }
        },
        vertexShader: POINTS_VS,
        fragmentShader: POINTS_FS,
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending
      });
      this.pollen = new T.Points(geo, mat);
      this.pollen.frustumCulled = false;
      this.scene.add(this.pollen);
    },

    /* ---------------- tree ---------------- */
    makeTree: function (x, z, scale) {
      var g = new T.Group();
      var y = terrainHeight(x, z);
      g.position.set(x, y, z);
      g.scale.setScalar(scale);

      var bark = new T.MeshStandardMaterial({ color: '#6b5140', roughness: 0.95, flatShading: true });
      var trunkH = 5.2;
      var trunk = new T.Mesh(new T.CylinderGeometry(0.17, 0.44, trunkH, 7, 1), bark);
      trunk.position.y = trunkH / 2;
      trunk.rotation.z = 0.04;
      g.add(trunk);

      var branches = [
        { a: 0.5, h: 4.4, len: 1.3, tilt: 0.85 },
        { a: 2.4, h: 4.6, len: 1.2, tilt: -0.9 },
        { a: 4.2, h: 4.8, len: 1.0, tilt: 0.75 }
      ];
      branches.forEach(function (b) {
        var m = new T.Mesh(new T.CylinderGeometry(0.05, 0.14, b.len, 5, 1), bark);
        m.position.set(Math.cos(b.a) * b.len * 0.32, b.h, Math.sin(b.a) * b.len * 0.32);
        m.rotation.z = b.tilt;
        m.rotation.y = -b.a;
        g.add(m);
      });

      var palette = ['#d9535f', '#e4707a', '#c8495a', '#e8868a'];
      var mats = palette.map(function (c) {
        return new T.MeshStandardMaterial({ color: c, roughness: 0.92 });
      });
      var blobGeo = new T.IcosahedronGeometry(1, 2);
      for (var i = 0; i < 62; i++) {
        var a2 = Math.random() * Math.PI * 2;
        var rr = Math.pow(Math.random(), 0.55);
        var m = new T.Mesh(blobGeo, mats[i % mats.length]);
        m.position.set(
          Math.cos(a2) * rr * 2.15,
          6.3 + (Math.random() - 0.35) * 1.85,
          Math.sin(a2) * rr * 1.95
        );
        m.scale.setScalar(rand(0.34, 0.78) * (1.2 - rr * 0.3));
        m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
        g.add(m);
      }

      // soft contact shadow
      var sc = makeCanvas(128), sg = sc.getContext('2d');
      var sgrad = sg.createRadialGradient(64, 64, 4, 64, 64, 62);
      sgrad.addColorStop(0, 'rgba(38,54,28,0.42)');
      sgrad.addColorStop(0.55, 'rgba(38,54,28,0.16)');
      sgrad.addColorStop(1, 'rgba(38,54,28,0)');
      sg.fillStyle = sgrad;
      sg.fillRect(0, 0, 128, 128);
      var shadowTex = new T.CanvasTexture(sc);
      var shadow = new T.Mesh(
        new T.PlaneGeometry(6.2, 6.2),
        new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, fog: true })
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.04;
      g.add(shadow);

      // a few blossom specks that catch the light
      var n = 90;
      var pos = new Float32Array(n * 3);
      var size = new Float32Array(n);
      var col = new Float32Array(n * 3);
      for (var i = 0; i < n; i++) {
        var a = Math.random() * Math.PI * 2;
        var rr = Math.pow(Math.random(), 0.5) * 2.3;
        pos[i * 3] = Math.cos(a) * rr;
        pos[i * 3 + 1] = 5.1 + rand(-0.3, 2.3);
        pos[i * 3 + 2] = Math.sin(a) * rr;
        size[i] = rand(0.05, 0.11);
        col[i * 3] = 1; col[i * 3 + 1] = 0.86; col[i * 3 + 2] = 0.86;
      }
      var geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      geo.setAttribute('aSize', new T.BufferAttribute(size, 1));
      geo.setAttribute('aColor', new T.BufferAttribute(col, 3));
      var tex = dotTexture();
      var mat = new T.ShaderMaterial({
        uniforms: {
          uMap: { value: tex },
          uScale: { value: 600 },
          uMaxSize: { value: 30 },
          uOpacity: { value: 0.5 },
          uFog: { value: this.FOG },
          uFogDensity: { value: this.fogDensity }
        },
        vertexShader: POINTS_VS,
        fragmentShader: POINTS_FS,
        transparent: true,
        depthWrite: false
      });
      g.add(new T.Points(geo, mat));

      return g;
    },

    /* ---------------- trees ---------------- */
    // 背景里的樱花树按需求去掉了：只留草地、蒲公英和远山，
    // 视线不再被树干切断。makeTree 留着，想加回来时直接调用即可。
    buildTree: function () {
      // this.scene.add(this.makeTree(11.5, -8, 1.25));
      // this.scene.add(this.makeTree(-17, -21, 0.72));
      // this.scene.add(this.makeTree(23, 3, 0.55));
    },


    /* ---------------- birds ---------------- */
    buildBirds: function () {
      var count = this.isMobile ? 6 : 10;
      this.birds = [];
      var mat = new T.MeshBasicMaterial({ color: '#4a5148', side: T.DoubleSide, fog: true });

      for (var i = 0; i < count; i++) {
        var g = new T.Group();

        var wingGeo = new T.BufferGeometry();
        wingGeo.setAttribute('position', new T.Float32BufferAttribute([
          0, 0, 0,
          -0.62, 0.06, 0.14,
          -0.5, 0, -0.16
        ], 3));
        wingGeo.computeVertexNormals();

        var left = new T.Mesh(wingGeo, mat);
        var right = new T.Mesh(wingGeo, mat);
        right.scale.x = -1;
        g.add(left, right);

        var scale = rand(0.45, 0.8);
        g.scale.setScalar(scale);
        this.scene.add(g);

        this.birds.push({
          group: g,
          left: left,
          right: right,
          angle: Math.random() * Math.PI * 2,
          radius: rand(20, 42),
          height: rand(10, 18),
          speed: rand(0.05, 0.14) * (Math.random() < 0.5 ? -1 : 1),
          flap: Math.random() * Math.PI * 2,
          flapSpeed: rand(5.5, 9),
          center: new T.Vector3(rand(-8, 16), 0, rand(-26, -2)),
          scared: 0,
          bank: 0
        });
      }
    },

    /* ---------------- the fluffy companion ---------------- */
    buildCompanion: function () {
      var self = this;

      var root = new T.Group();     // placed & scaled by the flow
      var roll = new T.Group();     // rolls around the view axis
      var body = new T.Group();     // head pitch + squash
      roll.add(body);
      root.add(roll);
      this.scene.add(root);
      this.ballRoot = root;
      this.ballRoll = roll;
      this.ballBody = body;

      // ---- 兔子医生：外部 GLB 模型（与桌面查看器同一只） ----
      // 先放一个素色小球占位，模型一到就换上来，避免草地上空一块
      var placeholder = new T.Mesh(
        new T.SphereGeometry(0.55, 24, 18),
        new T.MeshStandardMaterial({ color: '#fffdf6', roughness: 1 })
      );
      body.add(placeholder);

      // 绒毛材质：roughness 拉满 + sheen 绒面反射 + 物体空间短毛法线噪声（无贴图，不受 UV 接缝影响）
      var FUR = {
        uFurScale:      { value: 44.0 },   // 毛簇尺度
        uFurStrength:   { value: 0.13 },   // 毛簇起伏
        uGrainScale:    { value: 165.0 },  // 单根短毛尺度
        uGrainStrength: { value: 0.105 },
        uRoughJitter:   { value: 0.18 },   // 粗糙度扰动
        uTintJitter:    { value: 0.028 }   // 极轻微色斑，模拟毛流深浅
      };

      function createFurMaterial(map) {
        var mat = new T.MeshPhysicalMaterial({
          map: map || null,
          color: 0xffffff,              // 保留贴图原色：白毛、粉耳、腮红、紫蝴蝶结
          roughness: 0.97,
          metalness: 0.0,
          sheen: 1.0,                   // 绒面反射，边缘出柔光
          sheenRoughness: 0.78,
          sheenColor: new T.Color(0xfff1f3),
          specularIntensity: 0.10,
          envMapIntensity: 0.45,
          ior: 1.42
        });

        mat.onBeforeCompile = function (shader) {
          Object.assign(shader.uniforms, FUR);

          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>
        varying vec3 vFurPos;
        varying vec3 vFurObjNormal;
        varying mat3 vFurNormalMat;`)
            .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        vFurObjNormal = normalize(objectNormal);
        vFurNormalMat = normalMatrix;
        vFurPos = position;`);

          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
        uniform float uFurScale;
        uniform float uFurStrength;
        uniform float uGrainScale;
        uniform float uGrainStrength;
        uniform float uRoughJitter;
        uniform float uTintJitter;
        varying vec3 vFurPos;
        varying vec3 vFurObjNormal;
        varying mat3 vFurNormalMat;

        vec3 gFurGrad;
        float gFurGrain;

        float furHash(vec3 p) {
          p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }

        float furNoise(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float n000 = furHash(i);
          float n100 = furHash(i + vec3(1.0, 0.0, 0.0));
          float n010 = furHash(i + vec3(0.0, 1.0, 0.0));
          float n110 = furHash(i + vec3(1.0, 1.0, 0.0));
          float n001 = furHash(i + vec3(0.0, 0.0, 1.0));
          float n101 = furHash(i + vec3(1.0, 0.0, 1.0));
          float n011 = furHash(i + vec3(0.0, 1.0, 1.0));
          float n111 = furHash(i + vec3(1.0, 1.0, 1.0));
          return mix(
            mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
            mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
            f.z
          );
        }

        vec3 furGradient(vec3 p) {
          float e = 0.45;
          float c = furNoise(p);
          return vec3(
            furNoise(p + vec3(e, 0.0, 0.0)) - c,
            furNoise(p + vec3(0.0, e, 0.0)) - c,
            furNoise(p + vec3(0.0, 0.0, e)) - c
          ) / e;
        }`)
            .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        {
          vec3 fp = vFurPos;
          gFurGrain = furNoise(fp * uGrainScale);
          gFurGrad = furGradient(fp * uFurScale) * uFurStrength
                   + furGradient(fp * uGrainScale) * uGrainStrength;
        }`)
            .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= mix(1.0 - uTintJitter, 1.0, gFurGrain);`)
            .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * (1.0 + (gFurGrain - 0.5) * uRoughJitter), 0.45, 1.0);`)
            .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        {
          vec3 n = normalize(vFurObjNormal);
          vec3 perturbed = normalize(n + (gFurGrad - n * dot(gFurGrad, n)));
          normal = normalize(vFurNormalMat * perturbed);
        }`);
        };

        return mat;
      }

      // 给 sheen 一点环境反射：白棚渐变（和桌面查看器同一套做法）
      (function buildEnv() {
        try {
          var c = document.createElement('canvas');
          c.width = 256; c.height = 128;
          var ctx = c.getContext('2d');
          var g = ctx.createLinearGradient(0, 0, 0, c.height);
          g.addColorStop(0.00, '#ffffff');
          g.addColorStop(0.42, '#f7f4f1');
          g.addColorStop(0.55, '#efeae6');
          g.addColorStop(1.00, '#ded8d4');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, c.width, c.height);
          var spot = ctx.createRadialGradient(c.width * 0.3, c.height * 0.26, 0, c.width * 0.3, c.height * 0.26, c.width * 0.26);
          spot.addColorStop(0, 'rgba(255,255,255,0.95)');
          spot.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = spot;
          ctx.fillRect(0, 0, c.width, c.height);
          var tex = new T.CanvasTexture(c);
          tex.mapping = T.EquirectangularReflectionMapping;
          tex.colorSpace = T.SRGBColorSpace;
          var pmrem = new T.PMREMGenerator(self.renderer);
          pmrem.compileEquirectangularShader();
          self.scene.environment = pmrem.fromEquirectangular(tex).texture;
          pmrem.dispose();
          tex.dispose();
        } catch (e) { /* 环境贴图失败不影响主流程 */ }
      })();

      var glbUrl = '/models/rabbit.glb';
      var gltfLoader = new GLTFLoader();
      gltfLoader.load(
        glbUrl,
        function (gltf) {
          var model = gltf.scene;
          model.traverse(function (child) {
            if (!child.isMesh) return;
            var geo = child.geometry;
            if (!geo.attributes.normal) geo.computeVertexNormals();  // trimesh 导出无法线
            geo.computeBoundingBox();
            geo.computeBoundingSphere();
            var mats = Array.isArray(child.material) ? child.material : [child.material];
            var srcMap = mats[0] && mats[0].map ? mats[0].map : null;
            if (srcMap) {
              srcMap.colorSpace = T.SRGBColorSpace;
              srcMap.anisotropy = self.renderer.capabilities.getMaxAnisotropy();
              srcMap.needsUpdate = true;
            }
            child.material = createFurMaterial(srcMap);
            child.frustumCulled = false;
          });

          // 统一尺寸：最大边归一到 2.1，中心对齐原点，底部微沉
          var box = new T.Box3().setFromObject(model);
          var size = box.getSize(new T.Vector3());
          var center = box.getCenter(new T.Vector3());
          var s = 2.1 / Math.max(size.x, size.y, size.z);
          model.position.sub(center);
          model.scale.setScalar(s);
          var wrap = new T.Group();
          wrap.add(model);
          wrap.position.y = 0.1;   // 底部略微陷进草里 / 框沿里

          body.remove(placeholder);
          body.add(wrap);
        },
        undefined,
        function (err) {
          console.warn('[medai] 兔子模型加载失败，保留占位球', err);
        }
      );

      // a soft contact shadow so it sits in the grass
      var sc = makeCanvas(128), sg = sc.getContext('2d');
      var sg2 = sg.createRadialGradient(64, 64, 2, 64, 64, 62);
      sg2.addColorStop(0, 'rgba(34,48,26,0.5)');
      sg2.addColorStop(0.55, 'rgba(34,48,26,0.18)');
      sg2.addColorStop(1, 'rgba(34,48,26,0)');
      sg.fillStyle = sg2;
      sg.fillRect(0, 0, 128, 128);
      var shadowTex = new T.CanvasTexture(sc);
      this.ballShadow = new T.Mesh(
        new T.PlaneGeometry(1.9, 1.9),
        new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.9 })
      );
      this.ballShadow.rotation.x = -Math.PI / 2;
      this.scene.add(this.ballShadow);

      this.layoutBall();
    },

    /** 兔子站在地面的哪一点（布局和"别挡住兔子"的摆放判断共用这一套数） */
    rabbitGround: function () {
      // 桌面上 x 从 3.35 收回到 2.45（原来太贴右边）；z 越大离镜头越近
      return this.isMobile ? { x: 0.5, z: 11.4 } : { x: 2.45, z: 12.7 };
    },

    layoutBall: function () {
      var g = this.rabbitGround();
      // 站着时的整体缩放（趴到框沿时会插值回 0.23）
      this.homeScale = 1.1;
      // 坐在草尖上，不然草叶会挡住脸；脚底跟着缩放走，别陷进草里
      this.homeWorld.set(g.x, terrainHeight(g.x, g.z) + 1.12 * this.homeScale, g.z);
    },

    /* ---------------- 今天的药：吊在天上的木板 ----------------
     * 为什么是吊牌、为什么不让兔子举：
     *   这个号可以存全家的档案，吊牌是「全家今天」的总览，
     *   而兔子是你和**一个人**说话时的搭子 —— 两件事别混在一个身体上。
     * 为什么挂在左上那片天上：档案栏和兔子中间正好空着，不挡人也不挡路；
     * 链条一直拉出画面，它就像本来就挂在画外某颗钉子上。
     */
    buildSign: function () {
      var group = new T.Group();
      group.visible = false;
      this.signGroup = group;
      this.signShown = 0;
      this.signTarget = 0;
      // resize 后还要重摆多久（秒）。0 表示不用再跟着重摆
      this.signRelayout = 0;
      this.scene.add(group);

      // 摆动以链条顶端为轴，牌子才像真吊着，不是贴了一张图在屏幕上
      var swing = new T.Group();
      group.add(swing);
      this.signSwing = swing;

      var maps = woodMaps();
      var aniso = this.renderer.capabilities.getMaxAnisotropy();

      var map = new T.CanvasTexture(maps.color);
      map.colorSpace = T.SRGBColorSpace;
      map.anisotropy = aniso;
      var normal = new T.CanvasTexture(maps.normal);
      normal.anisotropy = aniso;
      var roughMap = new T.CanvasTexture(maps.rough);
      roughMap.anisotropy = aniso;

      // 端面单独一张贴图：锯开的那一面看到的是年轮横切，弧线方向和板面垂直
      var edgeMap = new T.CanvasTexture(maps.edge);
      edgeMap.colorSpace = T.SRGBColorSpace;
      edgeMap.wrapS = T.RepeatWrapping;
      edgeMap.wrapT = T.ClampToEdgeWrapping;
      edgeMap.anisotropy = aniso;

      var geo = new T.ExtrudeGeometry(sawnBoard(SIGN_W_WORLD, SIGN_H_WORLD), {
        depth: SIGN_T_WORLD,
        bevelEnabled: true,
        bevelThickness: 0.01,
        bevelSize: 0.011,
        bevelSegments: 3,
        steps: 1
      });

      geo.computeBoundingBox();
      var bb = geo.boundingBox;
      geo.translate(0, 0, -(bb.min.z + bb.max.z) / 2);
      this.signFaceZ = (bb.max.z - bb.min.z) / 2;

      // 一个顶点要么只属于板面、要么只属于端面，先按挤出几何的材质组标出来。
      // ExtrudeGeometry 出来的是非索引几何，groups 的 start/count 直接就是顶点下标
      var pos = geo.attributes.position;
      var uv = geo.attributes.uv;
      var idx = geo.index ? geo.index.array : null;
      var sideVerts = new Uint8Array(pos.count);
      for (var gi = 0; gi < geo.groups.length; gi++) {
        var gr = geo.groups[gi];
        if (gr.materialIndex === 0) continue;
        for (var gk = gr.start; gk < gr.start + gr.count; gk++) {
          sideVerts[idx ? idx[gk] : gk] = 1;
        }
      }

      for (var i = 0; i < pos.count; i++) {
        if (sideVerts[i]) {
          // 端面很窄：沿板长多铺几遍，厚度方向只露一小段
          uv.setXY(i, (pos.getX(i) + pos.getY(i) * 0.42) * 4.5, pos.getZ(i) * 16 + 0.5);
        } else {
          uv.setXY(
            i,
            (pos.getX(i) + SIGN_W_WORLD / 2) / SIGN_W_WORLD,
            (pos.getY(i) + SIGN_H_WORLD / 2) / SIGN_H_WORLD
          );
        }
      }

      var board = new T.Mesh(geo, [
        new T.MeshStandardMaterial({
          map: map,
          color: 0xe4dcd0,
          normalMap: normal,
          normalScale: new T.Vector2(1.15, 1.15),
          roughnessMap: roughMap,
          roughness: 1,
          metalness: 0
        }),
        new T.MeshStandardMaterial({
          map: edgeMap,
          color: 0xd6c2a4,
          roughness: 0.94,
          metalness: 0
        })
      ]);
      board.position.y = -(SIGN_CHAIN + SIGN_H_WORLD / 2);
      // 稍微侧一点，木纹的凹凸才接得到光；歪太多字就斜了
      board.rotation.y = 0.09;
      // 太阳在板子背后，正面只剩半球光和很弱的填充光，木纹的凹凸会被整个抹平。
      // 所以给板子单开一盏只在 layer 2 上的斜射光 —— 别的物体收不到，场景不受影响。
      var key = new T.DirectionalLight(0xfff3dc, 0.46);
      key.position.set(-4.2, 5.2, 9);
      key.layers.set(2);
      this.scene.add(key);
      board.layers.enable(2);
      this.camera.layers.enable(2);
      swing.add(board);
      this.signBoard = board;

      // 哑光铁链：每节转 90°，正面看是环、侧面看是一条线，串起来才有链子的层次
      var metal = new T.MeshStandardMaterial({
        color: 0x9fa3a7,
        metalness: 0.82,
        roughness: 0.52
      });
      var chainX = SIGN_W_WORLD / 2 - 0.085;
      var step = 0.042;
      var perChain = Math.round(SIGN_CHAIN / step) + 2;
      var links = new T.InstancedMesh(
        new T.TorusGeometry(0.019, 0.0072, 6, 16),
        metal,
        perChain * 2
      );
      var mtx = new T.Matrix4();
      var quat = new T.Quaternion();
      var eul = new T.Euler();
      // 真链环是长圆的，不是正圆环；顺带每节差一点点，链条才不会像一根直棍
      var scl = new T.Vector3(1, 1.32, 1);
      var jitter = valueNoise(7717);
      var at = new T.Vector3();
      var n = 0;
      for (var side = -1; side <= 1; side += 2) {
        for (var k = 0; k < perChain; k++) {
          eul.set(
            (jitter(k * 0.31, side) - 0.5) * 0.06,
            (k % 2 ? Math.PI / 2 : 0) + (jitter(k * 0.19, side + 2) - 0.5) * 0.08,
            0
          );
          quat.setFromEuler(eul);
          at.set(side * chainX, 0.012 - k * step, 0.026);
          mtx.compose(at, quat, scl);
          links.setMatrixAt(n++, mtx);
        }
      }
      links.instanceMatrix.needsUpdate = true;
      links.frustumCulled = false;
      swing.add(links);

      // 板子两头的挂环
      var eyeGeo = new T.TorusGeometry(0.026, 0.0076, 6, 16);
      for (var s = -1; s <= 1; s += 2) {
        var eye = new T.Mesh(eyeGeo, metal);
        eye.position.set(s * chainX, -(SIGN_CHAIN - 0.014), 0.026);
        eye.scale.set(1, 1.18, 1);
        swing.add(eye);
      }

      this.layoutSign();
    },


    layoutSign: function () {
      if (!this.signGroup) return;

      var cam = this.camera;
      var W = window.innerWidth;
      var H = window.innerHeight;
      // 反投影要的是这一刻的相机矩阵，resize 里相机参数刚改完还没渲染过
      cam.updateMatrixWorld();

      // 左边是档案栏：挂在它右边那片天上。问诊时栏会挪走，right 变负数，夹回 0
      var panel = document.querySelector('.records');
      var left = 0;
      if (panel) left = clamp(panel.getBoundingClientRect().right, 0, W);

      // 板子按屏幕像素定大小：换窗口宽度时，板上的字不会跟着胖瘦
      var boardPx = clamp(W - left - 96, 170, SIGN_W_PX);
      var tanHalf = Math.tan((cam.fov * Math.PI) / 360);
      // 要让板子在这个距离上占 boardPx 个像素，倒推它该站多远
      var depth = ((H / 2) * SIGN_W_WORLD) / (tanHalf * boardPx);

      var cx = left + 34 + boardPx / 2;
      var cy = H * 0.235;
      var dir = new T.Vector3((cx / W) * 2 - 1, 1 - (cy / H) * 2, 0.5)
        .unproject(cam)
        .sub(cam.position)
        .normalize();
      var head = cam.position.clone().addScaledVector(dir, depth);

      // 原点是链条顶端，板子挂在下面 SIGN_CHAIN 处
      this.signGroup.position.set(
        head.x,
        head.y + SIGN_CHAIN + SIGN_H_WORLD / 2,
        head.z
      );
    },

    /** 传入「今天的药」。一条跟踪都没有也把牌子挂起来，字由 HTML 那层去写。 */
    setBoard: function (board) {
      if (!this.signGroup) return;
      // 桌面常挂：空板子也是一块板子。手机在 updateSign 里仍然强制收起
      this.signTarget = 1;
      this.boardData = board || null;
    },

    /** 板面四角在屏幕上的位置（左上、右上、右下、左下），给 HTML 文字层贴上去 */
    signQuad: function () {
      var board = this.signBoard;
      if (!board || !this.signGroup || !this.signGroup.visible) return null;

      board.updateWorldMatrix(true, false);

      var x = SIGN_TEXT_W / 2;
      var y = SIGN_TEXT_H / 2;
      var z = (this.signFaceZ || 0.035) + 0.004;
      var corners = [
        [-x, y],
        [x, y],
        [x, -y],
        [-x, -y]
      ];
      var v = new T.Vector3();
      var w = window.innerWidth;
      var h = window.innerHeight;
      var pts = [];

      for (var i = 0; i < 4; i++) {
        v.set(corners[i][0], corners[i][1], z);
        board.localToWorld(v);
        v.project(this.camera);
        if (v.z > 1) return null;
        pts.push({
          x: (v.x * 0.5 + 0.5) * w,
          y: (-v.y * 0.5 + 0.5) * h
        });
      }

      return { pts: pts, opacity: this.signShown };
    },

    /** 这个位置放种子会不会投影到兔子身上（buildDandelions 和飘动重生共用） */
    seedSafe: function (x, z) {
      var rg = this.rabbitGround();
      var camZ = this.camera.position.z;
      var depth = camZ - z;
      if (depth <= 0.5) return false;
      if (depth < 3.2) return false;
      var rabbitDepth = Math.max(0.8, camZ - rg.z);
      return Math.abs(x - rg.x) > 1.9 * (depth / rabbitDepth);
    },

    updateSign: function (dt) {
      var group = this.signGroup;
      if (!group) return;

      // resize 之后的收尾：CSS 和相机都要过几帧才落定，这期间每帧按最新位置重摆
      if (this.signRelayout > 0) {
        this.signRelayout -= dt;
        this.layoutSign();
      }

      // 手机上这片天太小：牌子和兔子抢位置，缩到能放下又看不清字。
      // 所以吊牌只在桌面挂着，手机上换成档案栏顶上的一条（见 .medtoday）。
      var want = this.isMobile ? 0 : this.signTarget;

      if (this.signShown !== want) {
        // 指数逼近，和场景里其它过渡一个手感
        var k = 1 - Math.pow(0.0018, Math.min(dt, 0.05));
        this.signShown += (want - this.signShown) * k;
        if (Math.abs(this.signShown - want) < 0.003) this.signShown = want;
      }

      var p = this.signShown;
      group.visible = p > 0.004;
      if (!group.visible) return;

      // 有风：链条顶端不动，板子跟着轻轻摆，幅度小到看不出是动效
      var e = smoothstep(0, 1, p);
      this.signSwing.rotation.z = Math.sin(this.time * 0.72) * 0.005 * e;
      this.signSwing.rotation.x = Math.sin(this.time * 0.51 + 1.2) * 0.0024 * e;
    },

    /** 木牌在屏幕上的矩形（命中判定用） */
    signAnchor: function () {
      var group = this.signGroup;
      if (!group || !group.visible || !this.signBoard) return null;

      var cam = this.camera;
      var w = window.innerWidth;
      var h = window.innerHeight;
      var box = new T.Box3().setFromObject(this.signBoard);
      var xs = [box.min.x, box.max.x];
      var ys = [box.min.y, box.max.y];
      var zs = [box.min.z, box.max.z];
      var v = new T.Vector3();

      var left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
      for (var a = 0; a < 2; a++) {
        for (var b = 0; b < 2; b++) {
          for (var c = 0; c < 2; c++) {
            v.set(xs[a], ys[b], zs[c]).project(cam);
            var px = (v.x * 0.5 + 0.5) * w;
            var py = (-v.y * 0.5 + 0.5) * h;
            if (px < left) left = px;
            if (px > right) right = px;
            if (py < top) top = py;
            if (py > bottom) bottom = py;
          }
        }
      }

      return {
        left: left,
        top: top,
        right: right,
        bottom: bottom,
        cx: (left + right) / 2,
        cy: (top + bottom) / 2
      };
    },

    /** 手指/鼠标是不是点在木牌上 */
    hitSign: function (clientX, clientY) {
      var a = this.signAnchor();
      if (!a) return false;
      return clientX >= a.left && clientX <= a.right && clientY >= a.top && clientY <= a.bottom;
    },

    gazeAt: function (nx, ny) {
      this.gazeMode = 'pointer';
      this.pointer.set(nx, ny);
    },

    gazeToViewer: function () {
      this.gazeMode = 'viewer';
    },

    setPerchPixel: function (x, y) {
      this.perchPoint = { x: x, y: y };
    },

    /** 让兔子跳一下（点它的时候用）。连点会重新起跳，像连着蹦 */
    hop: function (power) {
      this.hopDur = 0.52;
      this.hopLeft = this.hopDur;
      this.hopPower = power || 1;
    },

    /* ---------------- 气泡锚点：兔子的屏幕坐标 ----------------
     * 模型统一缩放到最大边 2.1、中心对齐原点、整体再抬 0.1，
     * 所以头顶大约在 ballRoot.position 上方 1.15 × scale（世界单位）。
     * 这里只做投影，不改兔子的位置、旋转、材质和缩放。
     */
    rabbitAnchor: function () {
      var root = this.ballRoot;
      if (!root) return null;

      var cam = this.camera;
      var s = root.scale.x;
      var pos = root.position;
      var w = window.innerWidth;
      var h = window.innerHeight;

      var c = this._rabbitCenter || (this._rabbitCenter = new T.Vector3());
      var p = this._rabbitProbe || (this._rabbitProbe = new T.Vector3());

      // 圆心（模型中心）——点选命中用
      c.copy(pos).project(cam);
      var cx = (c.x * 0.5 + 0.5) * w;
      var cy = (-c.y * 0.5 + 0.5) * h;

      // 竖直半径：投影一段 1.05 × scale 的上偏移
      p.set(pos.x, pos.y + 1.05 * s, pos.z).project(cam);
      var ry = Math.abs((-p.y * 0.5 + 0.5) * h - cy);

      // 水平半径：投影一段 0.92 × scale 的右偏移
      p.set(pos.x + 0.92 * s, pos.y, pos.z).project(cam);
      var rx = Math.abs((p.x * 0.5 + 0.5) * w - cx);

      return {
        // 头顶正中：气泡挂在这里。1.10 而不是 1.05，是因为耳朵比"半个身高的球"还高一点
        x: cx,
        y: cy - ry * 1.1,
        // 命中测试用的椭圆
        cx: cx,
        cy: cy,
        rx: Math.max(8, rx),
        ry: Math.max(8, ry),
        scale: s,
        // 飞行途中（转场）气泡先让开
        flowing: this.flowDir !== 0,
        perched: this.flowP > 0.62
      };
    },

    /** 鼠标/手指是不是落在兔子身上（屏幕空间椭圆判定，比 raycast 便宜且更宽容） */
    hitRabbit: function (clientX, clientY, pad) {
      var a = this.rabbitAnchor();
      if (!a) return false;
      var k = pad || 1.06;
      var dx = (clientX - a.cx) / (a.rx * k);
      var dy = (clientY - a.cy) / (a.ry * k);
      return dx * dx + dy * dy <= 1;
    },

    startFlow: function () {
      this.flowFrom = this.flowP;
      this.flowT0 = performance.now();
      this.flowDir = 1;
    },

    endFlow: function () {
      this.flowFrom = this.flowP;
      this.flowT0 = performance.now();
      this.flowDir = -1;
    },

    updateBall: function (dt) {
      var t = this.time;
      var cam = this.camera;

      // --- the flow: roll right 90°, look up, shrink, and lie on the panel
      // 用墙钟算进度，不累加 dt：dt 被钳到 0.05 时低帧率设备会把 1.1 秒拖成两三秒，
      // 那样球和面板就停不到同一刻了
      if (this.flowDir !== 0) {
        var elapsed = (performance.now() - this.flowT0) / 1000;
        this.flowP = clamp(this.flowFrom + (this.flowDir * elapsed) / this.flowDur, 0, 1);
        if ((this.flowDir > 0 && this.flowP >= 1) || (this.flowDir < 0 && this.flowP <= 0)) {
          this.flowDir = 0;
        }
      }
      var p = this.flowP;

      // 点一下会跳：这一帧的起跳位移和伸缩先算出来，下面分别叠到位置和缩放上。
      // 趴到框沿之后幅度收一半，免得整个飞出视口。
      var hopLift = 0;
      var hopSq = 1;
      if (this.hopLeft > 0) {
        this.hopLeft = Math.max(0, this.hopLeft - dt);
        var hp = 1 - this.hopLeft / this.hopDur;             // 0 → 1
        var lift = Math.sin(Math.PI * clamp(hp, 0, 1));
        var amp = (this.isMobile ? 0.30 : 0.40) * (1 - 0.45 * p) * this.hopPower;
        hopLift = lift * amp;
        // 起跳先压一下、空中拉长、落地回弹
        hopSq = 1 + 0.09 * lift - 0.08 * Math.max(0, 1 - hp * 8);
      }

      // 毛绒兔子不是球：真滚到 90°，那块平的底面会整个翻向镜头，怎么补都会"露底"。
      // 所以改成"小角度翻滚 + 顺势侧转 + 一跃"：动感够，底面始终朝下压着看不见。
      var rollA = -0.40 * (smoothstep(0, 0.36, p) - smoothstep(0.58, 0.82, p));
      var yawA = 0.46 * (smoothstep(0.02, 0.32, p) - smoothstep(0.6, 0.86, p));
      // 以前是"趴下去抬头"，可是镜头在兔子下方两米多，
      // 一仰头就把那块平的底面整个亮给镜头。改成微微俯身、低头看着你和对话框，
      // 底面始终朝下藏着——飞行途中和落在框沿上都看不到底。
      var pitchA = 0.34 * smoothstep(0.36, 0.7, p);
      this.ballRoll.rotation.z = rollA;
      this.ballBody.rotation.x = pitchA;

      // 趴框时的大小：桌面 0.23 / 手机 0.26，保证球顶留在视口里、不顶到顶栏
      var perchScale = this.isMobile ? 0.22 : 0.23;
      var homeScale = this.homeScale || 1;
      var scale = homeScale + (perchScale - homeScale) * smoothstep(0.74, 1, p);
      this.ballRoot.scale.setScalar(scale);

      // perched: a little flatter, like it flopped onto the frame
      var squash = 1 - 0.15 * smoothstep(0.8, 1, p);
      var breath = 1 + Math.sin(t * 1.55) * 0.013;
      var wide = (1 + (1 - squash) * 0.5) * (1 - (hopSq - 1) * 0.5);
      this.ballBody.scale.set(wide, squash * breath * hopSq, wide);

      // --- where the fluff ball lives
      cam.updateMatrixWorld();
      var PERCH_DIST = 5.0;
      if (this.perchPoint) {
        var w = window.innerWidth, h = window.innerHeight;
        var nx = (this.perchPoint.x / w) * 2 - 1;
        var ny = 1 - (this.perchPoint.y / h) * 2;

        // 让球"坐在"面板上边缘下方：抬得少一点，整个圆屁股藏在框后面，只露头
        var halfFov = Math.tan((cam.fov * Math.PI) / 360);
        var radiusNdc = (perchScale * 0.95) / (halfFov * PERCH_DIST);
        ny += radiusNdc * 0.37;

        var v = new T.Vector3(nx, ny, 0.5).unproject(cam);
        v.sub(cam.position).normalize();
        this.perchWorld.copy(cam.position).addScaledVector(v, PERCH_DIST);
      }

      var e = smoothstep(0.08, 0.94, p);
      this.ballRoot.position.lerpVectors(this.homeWorld, this.perchWorld, e);
      // a small hop while it travels
      this.ballRoot.position.y += Math.sin(Math.PI * clamp((p - 0.05) / 0.82, 0, 1)) * 0.42;
      // idle breathing bob, gone once it has settled on the frame
      this.ballRoot.position.y += Math.sin(t * 1.1) * 0.018 * (1 - p);
      // 起跳位移叠在呼吸之上
      if (hopLift > 0) this.ballRoot.position.y += hopLift;
      // 以前这里整只左右摆 ±0.06rad（约 3.4°），周期 14 秒，
      // 有一半时间停在"往右偏"的相位上，看起来像没在正眼看人。
      // 生命感交给上下呼吸和竖耳抖动就够了，这里压到 0.01rad（约 0.6°，肉眼几乎看不出）。
      this.ballRoot.rotation.y = Math.sin(t * 0.45) * 0.01 * (1 - p);

      // shadow only while it is on the ground
      var groundY = terrainHeight(this.ballRoot.position.x, this.ballRoot.position.z);
      var above = this.ballRoot.position.y - groundY;
      var shadowOn = clamp(1 - (above - 0.9) / 1.6, 0, 1);
      this.ballShadow.position.set(this.ballRoot.position.x, groundY + 0.03, this.ballRoot.position.z);
      var shScale = (0.75 + shadowOn * 0.35) * scale;
      this.ballShadow.scale.setScalar(shScale);
      this.ballShadow.material.opacity = 0.55 * shadowOn;

      // --- 面部补光：一直待在"兔子和镜头之间、略偏右上"的位置
      if (this.faceLight) {
        var fs = this.ballRoot.scale.x;
        if (!this._faceDir) this._faceDir = new T.Vector3();
        this._faceDir.copy(cam.position).sub(this.ballRoot.position);
        var camDist = this._faceDir.length() || 1;
        this._faceDir.multiplyScalar(1 / camDist);

        this.faceLight.position
          .copy(this.ballRoot.position)
          .addScaledVector(this._faceDir, (this.faceDist || 1.85) * fs);
        this.faceLight.position.x += 0.30 * fs;
        this.faceLight.position.y += 0.42 * fs;
        // 距离跟着 scale 缩，强度按平方补回来，近距离平视和趴框时亮度一致
        this.faceLight.intensity = this.faceBase * fs * fs;
      }

      // --- eyes: follow the pointer, drift back to the viewer when it rests
      // 以前用「鼠标在小兔屏幕坐标上的偏移」直接映射角度：手机能对上，因为兔子就在屏幕中间、
      // 相机在它正前方；桌面兔子在 x=3.3（偏右 28°），那套映射等于把"正脸"定在了偏右的方向上，
      // 鼠标停在兔子身上时反而歪着头。现在改成真的去看鼠标：
      // 把指针在"兔子所在深度"反投影成世界坐标，算它相对兔子的方位角。
      var baseYaw = -Math.atan2(this.ballRoot.position.x - cam.position.x, cam.position.z - this.ballRoot.position.z) * 0.93;
      var yaw, pitch;
      if (this.gazeMode === 'viewer') {
        // 静止时正面看着屏幕前的你
        yaw = baseYaw;
        pitch = 0.06;
      } else {
        var bp = this.ballRoot.position;
        var tgt = this._lookAt || (this._lookAt = new T.Vector3());
        // 反投影出这条视线，再沿它推到兔子所在的深度。
        // 注意：方向向量不能和 tgt 共用同一个对象，否则 addScaledVector 会把自己算进去
        tgt.set(this.pointer.x, this.pointer.y, 0.5).unproject(cam);
        tgt.sub(cam.position);
        var rayLen = tgt.length() || 1;
        tgt.multiplyScalar(cam.position.distanceTo(bp) / rayLen).add(cam.position);

        var hx = tgt.x - bp.x;
        var hz = tgt.z - bp.z;
        var horiz = Math.hypot(hx, hz);
        if (horiz < 0.35) {
          // 指针正好落在兔子身上：此时"看鼠标"就是看着你，回到正脸，别抖动
          yaw = baseYaw;
          pitch = 0.06;
        } else {
          // 往左（朝镜头这一侧）可以转到 43°，往右收到 25°：
          // 脸是画在球面上的，往镜头反方向转太多就只剩侧后方了（实测右侧 41° 就几乎看不到眼睛）
          var lo = baseYaw - 0.75;
          var hi = baseYaw + 0.44;
          yaw = clamp(-Math.atan2(-hx, hz) * 0.93, lo, hi);
          // 抬头/低头：眼睛画在球面上，低太多就只剩头顶
          pitch = clamp(Math.atan2(tgt.y - bp.y, horiz) * 0.9, -0.24, 0.26);
        }
      }
      var k = 1 - Math.exp(-dt * 12);
      this.eyeAim.yaw += (yaw - this.eyeAim.yaw) * k;
      this.eyeAim.pitch += (pitch - this.eyeAim.pitch) * k;
      if (!isFinite(this.eyeAim.yaw)) this.eyeAim.yaw = yaw;
      if (!isFinite(this.eyeAim.pitch)) this.eyeAim.pitch = pitch;
      // 脸是画在贴图上的：整只（含耳朵、蝴蝶结）一起转，看着鼠标
      this.ballBody.rotation.y = this.eyeAim.yaw + yawA;
      this.ballBody.rotation.x = pitchA - this.eyeAim.pitch * 0.55;
      // 眨眼不再适用；用一次极轻的"竖耳"抖动代替
      this.nextBlink -= dt;
      if (this.nextBlink <= 0) {
        this.blinkLeft = 0.17;
        this.nextBlink = rand(2.6, 5.6);
      }
      if (this.blinkLeft > 0) this.blinkLeft -= dt;
      var open = this.blinkLeft > 0
        ? Math.max(0.06, Math.abs(this.blinkLeft - 0.085) / 0.085)
        : 1;
      this.ballBody.scale.y = squash * breath * (1 + (1 - open) * 0.02) * hopSq;

      // the fluff breathes with the body
      if (this.fluff) this.fluff.material.uniforms.uOpacity.value = 0.9 + Math.sin(t * 1.55) * 0.05;
    },

    /* ---------------- camera ---------------- */
    pathDistance: function (x, z) {
      var best = Infinity;
      for (var i = 0; i <= 24; i++) {
        var pt = this.curve.getPointAt(i / 24);
        var d = (pt.x - x) * (pt.x - x) + (pt.z - z) * (pt.z - z);
        if (d < best) best = d;
      }
      return Math.sqrt(best);
    },

    setPointer: function (nx, ny) {
      this.pointer.set(nx, ny);
    },

    recordTrail: function (dt) {
      var bp = this.ballRoot.position;
      var onGround = bp.y < terrainHeight(bp.x, bp.z) + 1.7;
      var last = this.trail[0];
      if (onGround && (!last || (bp.x - last.x) * (bp.x - last.x) + (bp.z - last.z) * (bp.z - last.z) > 0.14)) {
        this.trail.unshift({ x: bp.x, z: bp.z, age: 0 });
        if (this.trail.length > 10) this.trail.length = 10;
      }
      for (var i = this.trail.length - 1; i >= 0; i--) {
        this.trail[i].age += dt;
        if (this.trail[i].age > 6.5) this.trail.splice(i, 1);
      }
      for (var j = 0; j < 10; j++) {
        var t = this.trail[j];
        var u = this.trailUniforms[j];
        if (t) {
          var s = 1.0 - t.age / 6.5;
          u.set(t.x, t.z, Math.max(0, s) * 0.95, 1.15);
        } else {
          u.set(0, 0, 0, 1.15);
        }
      }
    },

    updateCamera: function (dt) {
      var cam = this.camera;
      var mob = this.isMobile;

      this.pointerSmooth.x += (this.pointer.x - this.pointerSmooth.x) * (1 - Math.exp(-dt * 2.0));
      this.pointerSmooth.y += (this.pointer.y - this.pointerSmooth.y) * (1 - Math.exp(-dt * 2.0));

      var baseYaw = (mob ? -0.02 : -0.13) + Math.sin(this.time * 0.07) * 0.012;
      var basePitch = (mob ? -0.34 : -0.055) + Math.sin(this.time * 0.052) * 0.008;
      var yaw = baseYaw + this.pointerSmooth.x * 0.032;
      var pitch = basePitch + this.pointerSmooth.y * 0.018;

      this.yaw = this.lerpAngle(this.yaw, yaw, 1 - Math.exp(-dt * 3.0));
      this.pitch += (pitch - this.pitch) * (1 - Math.exp(-dt * 3.0));

      cam.position.set(0, terrainHeight(0, 18) + 1.68, 18);
      cam.rotation.order = 'YXZ';
      cam.rotation.y = this.yaw;
      cam.rotation.x = this.pitch;
    },

    lerpAngle: function (a, b, t) {
      var d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (d < -Math.PI) d += Math.PI * 2;
      return a + d * t;
    },

    /* ---------------- loop ---------------- */
    update: function (dt) {
      // 帧间隔必须是正数且有上限：某些环境下 rAF 的时间戳会回退，
      // 负的 dt 会让指数平滑变成放大，几十帧就把转角算到 1e12 去。
      dt = dt > 0 ? Math.min(dt, 0.05) : 0.016;
      this.time += dt;
      var t = this.time;

      this.updateCamera(dt);
      this.updateBall(dt);
      this.recordTrail(dt);

      this.sky.position.copy(this.camera.position);
      this.sky.material.uniforms.uTime.value = t;
      this.updateClouds(dt);
      this.updateSign(dt);

      var gu = this.grass.material.uniforms;
      gu.uTime.value = t;
      gu.uWind.value = this.reduced ? 0.02 : 0.055 + 0.02 * Math.sin(t * 0.31);

      // dandelion seeds drift
      if (this.seeds) {
        var arr = this.seeds.geometry.attributes.position;
        for (var i = 0; i < this.seedData.length; i++) {
          var s = this.seedData[i];
          var y = arr.getY(i) + s.vy * dt;
          var x = s.baseX + Math.sin(t * s.speed + s.phase) * 0.5;
          var z = s.baseZ + Math.cos(t * s.speed * 0.8 + s.phase) * 0.5;
          if (y > 6.2) {
            y = 0.7;
            // 重生点原来就撒在镜头四周 ±14，兔子和镜头之间那片区域也在里面 ——
            // 一颗种子重生在兔子前面，就是一团糊在它脸上的白光
            var camX = this.camera.position.x, camZ = this.camera.position.z;
            for (var rt = 0; rt < 8; rt++) {
              s.baseX = camX + rand(-14, 14);
              s.baseZ = camZ + rand(-14, 14);
              if (this.seedSafe(s.baseX, s.baseZ)) break;
            }
            if (!this.seedSafe(s.baseX, s.baseZ)) {
              // 8 次都没躲开（不太可能），索性甩到兔子另一边去
              var rgr = this.rabbitGround();
              s.baseX = rgr.x + (s.baseX > rgr.x ? 6.5 : -6.5);
            }
            x = s.baseX; z = s.baseZ;
          }
          arr.setXYZ(i, x, y, z);
        }
        arr.needsUpdate = true;
      }

      // birds
      var cam = this.camera.position;
      for (var b = 0; b < this.birds.length; b++) {
        var bird = this.birds[b];
        var bx = bird.center.x + Math.cos(bird.angle) * bird.radius;
        var bz = bird.center.z + Math.sin(bird.angle) * bird.radius;
        var by = bird.height + Math.sin(t * 0.4 + bird.flap) * 0.7;
        bird.angle += bird.speed * dt;

        var dxp = bx - cam.x, dzp = bz - cam.z;
        var d = Math.max(0.001, Math.hypot(dxp, dzp));
        if (d < 13) {
          // keep a respectful distance; close enough to judge you, not to fill the lens
          var push = (13 - d) / 13;
          bird.scared = Math.min(1, bird.scared + dt * 2.2);
          bx += (dxp / d) * push * 9;
          bz += (dzp / d) * push * 9;
          by += push * 4;
        } else {
          bird.scared = Math.max(0, bird.scared - dt * 0.4);
        }
        bird.group.visible = d > 9;

        bird.group.position.set(bx, by, bz);
        bird.group.rotation.y = -bird.angle + Math.PI / 2;
        bird.group.rotation.z = Math.sin(t * 0.7 + bird.flap) * 0.12;

        var flap = Math.sin(t * bird.flapSpeed + bird.flap);
        bird.left.rotation.z = flap * 0.55;
        bird.right.rotation.z = -flap * 0.55;
      }

      // pollen drift
      if (this.pollen) {
        var pp = this.pollen.geometry.attributes.position;
        for (var k = 0; k < pp.count; k++) {
          var yy = pp.getY(k) + dt * 0.10;
          var xx = pp.getX(k) + Math.sin(t * 0.5 + k) * dt * 0.06;
          if (yy > 8.5) { yy = 0.35; }
          pp.setXYZ(k, xx, yy, pp.getZ(k));
        }
        pp.needsUpdate = true;
      }

      this.renderer.render(this.scene, this.camera);
    },

    resize: function () {
      var w = window.innerWidth, h = window.innerHeight;
      this.isMobile = w < 860 || window.matchMedia('(pointer: coarse)').matches;
      var dpr = Math.min(window.devicePixelRatio || 1, this.isMobile ? 1.5 : 1.75);
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.fov = w < 860 ? 66 : 55;
      this.camera.updateProjectionMatrix();

      var scale = (h * dpr * 0.5) / Math.tan((this.camera.fov * Math.PI) / 360);
      this.scene.traverse(function (obj) {
        if (obj.isPoints && obj.material.uniforms && obj.material.uniforms.uScale) {
          obj.material.uniforms.uScale.value = scale;
        }
      });

      if (this.ballRoot) this.layoutBall();
      // 换到窄屏时兔子会挪位置，木牌得跟着重摆
      // 只摆一次不够：切回来那一刻 .records 还是手机版的宽度、相机也还在往新位置插值，
      // 量出来的 left 和相机位置都是旧的 —— 板子会停在错的半空里，等到下一次
      // resize 才纠正。所以接下来一秒多里每帧重摆一次，等 CSS 和相机都落定。
      if (this.signGroup) {
        this.layoutSign();
        this.signRelayout = 1.4;
      }
      this.syncCloudHeights();
    },

    dispose: function () {
      window.removeEventListener('resize', this.onResize);
      this.renderer.dispose();
    }
  };

export { Meadow, terrainHeight };
