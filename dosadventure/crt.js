// CRT look: the 640x400 signal canvas is drawn onto the visible canvas through
// a small WebGL shader (curvature, scanlines, aperture mask, glow, vignette).
// Without WebGL it falls back to a plain scaled copy plus CSS scanlines.

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uOut;
uniform vec3 uView;
uniform float uTime, uStr, uPower, uRoll, uFit;

vec2 curve(vec2 uv) {
  uv = uv * 2.0 - 1.0;
  vec2 off = abs(uv.yx) * vec2(0.22, 0.27) * uStr;
  uv = uv + uv * off * off;
  return uv * 0.5 + 0.5;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 tex(vec2 s) { return texture2D(uTex, s).rgb; }

void main() {
  vec2 c = curve(vUv);
  // glass reflection is visible even when the tube is off
  vec3 refl = vec3(0.10, 0.11, 0.12) * smoothstep(0.75, 0.0, length((vUv - vec2(0.28, 0.18)) * vec2(1.0, 1.6)));
  if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0) {
    gl_FragColor = vec4(vec3(0.015) + refl * 0.4, 1.0);
    return;
  }
  vec2 d = abs(c - 0.5) * 2.0;
  vec2 q = max(d - vec2(0.94), 0.0);
  float corner = 1.0 - smoothstep(0.045, 0.06, length(q));
  vec3 col = vec3(0.0);
  // overscan: the picture sits inside a black border, like a real tube
  vec2 f = (c - 0.5) / uFit + 0.5;
  float inPic = step(0.0, f.x) * step(f.x, 1.0) * step(0.0, f.y) * step(f.y, 1.0);
  if (uPower > 0.0) {
    vec2 s = uView.xy + clamp(f, 0.0, 1.0) * uView.z;
    vec2 px = vec2(1.0 / 640.0, 1.0 / 400.0) * uView.z;
    col = tex(s) * inPic;
    vec3 g = tex(s + vec2(px.x * 1.5, 0.0)) + tex(s - vec2(px.x * 1.5, 0.0))
           + tex(s + vec2(0.0, px.y * 1.5)) + tex(s - vec2(0.0, px.y * 1.5))
           + tex(s + px * 3.0) + tex(s - px * 3.0)
           + tex(s + vec2(px.x * 3.0, -px.y * 3.0)) + tex(s + vec2(-px.x * 3.0, px.y * 3.0));
    g *= inPic / 8.0;
    col = mix(col, max(col, g), 0.45 * uStr) + g * 0.22 * uStr;
    // scanlines follow the source rows; they fade out when the screen is too small to show them
    float rowsOnScreen = 400.0 / uView.z;
    float sl = 0.5 + 0.5 * cos(s.y * 400.0 * 6.2832);
    float slAmt = uStr * 0.38 * clamp(uOut.y / rowsOnScreen - 0.7, 0.0, 1.0);
    col *= 1.0 - slAmt * sl;
    float m = mod(gl_FragCoord.x, 3.0);
    vec3 mask = vec3(m < 1.0 ? 1.0 : 0.78, (m >= 1.0 && m < 2.0) ? 1.0 : 0.78, m >= 2.0 ? 1.0 : 0.78);
    col *= mix(vec3(1.0), mask, uStr * clamp(uOut.x / 1600.0, 0.15, 0.6));
    // a slow, faint brightness band rolling down the tube
    col *= 1.0 + 0.035 * uStr * uRoll * smoothstep(0.0, 0.15, 0.15 - abs(fract(c.y * 0.5 - uTime * 0.07) - 0.5));
    col += (hash(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) * 0.035 * uStr;
    col = col * (1.0 + 0.12 * uStr) + vec3(0.010, 0.014, 0.012);
    // warm-up: the picture opens from a thin horizontal line
    float open = clamp(uPower, 0.0, 1.0);
    col *= step(abs(c.y - 0.5), max(open * 0.5, 0.003)) * (0.55 + 0.45 * open);
  }
  float vig = pow(16.0 * c.x * c.y * (1.0 - c.x) * (1.0 - c.y), 0.22 * uStr);
  col = col * vig + refl * (0.35 + 0.65 * uStr);
  gl_FragColor = vec4(col * corner, 1.0);
}`;

export class CRT {
  constructor(canvas, source) {
    this.canvas = canvas;
    this.source = source;
    this.strength = 1;
    this.power = -1;      // < 0 off, 0..1 warming up, 1 on
    this.roll = 1;
    this.view = { x: 0, y: 0, z: 1 };
    this.gl = null;
    try { this.initGL(); } catch (err) { console.warn("CRT shader unavailable:", err); this.gl = null; }
    if (!this.gl) this.ctx = canvas.getContext("2d");
  }

  get webgl() { return !!this.gl; }

  // Share of the glass the picture fills; the rest is black overscan border.
  get fit() { return 0.95 - 0.04 * this.strength; }

  initGL() {
    const gl = this.canvas.getContext("webgl", { antialias: false, alpha: false, preserveDrawingBuffer: false });
    if (!gl) return;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.u = {};
    for (const n of ["uTex", "uOut", "uView", "uTime", "uStr", "uPower", "uRoll", "uFit"]) this.u[n] = gl.getUniformLocation(prog, n);
    gl.uniform1i(this.u.uTex, 0);
    this.gl = gl;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  // Map a client point to signal coordinates (0..640, 0..400), through the same curvature.
  map(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    let u = (clientX - r.left) / r.width, v = (clientY - r.top) / r.height;
    if (this.gl) {
      let x = u * 2 - 1, y = v * 2 - 1;
      const ox = Math.abs(y) * 0.22 * this.strength, oy = Math.abs(x) * 0.27 * this.strength;
      x += x * ox * ox; y += y * oy * oy;
      u = x * 0.5 + 0.5; v = y * 0.5 + 0.5;
    }
    u = (u - 0.5) / this.fit + 0.5;
    v = (v - 0.5) / this.fit + 0.5;
    const inside = u >= 0 && u <= 1 && v >= 0 && v <= 1;
    const sx = (this.view.x + u * this.view.z) * 640, sy = (this.view.y + v * this.view.z) * 400;
    return { x: sx, y: sy, inside };
  }

  draw(t, sourceChanged) {
    const { canvas } = this;
    if (this.gl) {
      const gl = this.gl;
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (sourceChanged || !this.uploaded) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, this.source);
        this.uploaded = true;
      }
      gl.uniform2f(this.u.uOut, canvas.width, canvas.height);
      gl.uniform3f(this.u.uView, this.view.x, this.view.y, this.view.z);
      gl.uniform1f(this.u.uTime, t);
      gl.uniform1f(this.u.uStr, this.strength);
      gl.uniform1f(this.u.uPower, this.power);
      gl.uniform1f(this.u.uRoll, this.roll);
      gl.uniform1f(this.u.uFit, this.fit);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return;
    }
    const ctx = this.ctx;
    ctx.fillStyle = "#050605";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (this.power <= 0) return;
    ctx.imageSmoothingEnabled = this.strength > 0;
    const open = Math.min(1, this.power);
    const h = Math.max(2, canvas.height * open);
    const { x, y, z } = this.view;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, (canvas.height - h) / 2, canvas.width, h);
    ctx.clip();
    const fw = canvas.width * this.fit, fh = canvas.height * this.fit;
    ctx.drawImage(this.source, x * 640, y * 400, z * 640, z * 400, (canvas.width - fw) / 2, (canvas.height - fh) / 2, fw, fh);
    ctx.restore();
  }
}
