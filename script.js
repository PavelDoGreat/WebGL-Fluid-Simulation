
'use strict';

const canvas = document.getElementsByTagName('canvas')[0];
const gl = canvas.getContext('webgl', { alpha: false, preserveDrawingBuffer: false, depth: false, stencil: false });

const halfFloat = gl.getExtension('OES_texture_half_float');
const support_linear_float = gl.getExtension('OES_texture_half_float_linear');

resizeCanvas();

const TEXTURE_DOWNSAMPLE = 2;
const TEXTURE_WIDTH = gl.drawingBufferWidth >> TEXTURE_DOWNSAMPLE;
const TEXTURE_HEIGHT = gl.drawingBufferHeight >> TEXTURE_DOWNSAMPLE;
const DENSITY_DISSIPATION = 0.98;
const VELOCITY_DISSIPATION = 0.99;
const SPLAT_RADIUS = 0.005;
const CURL = 30;
const PRESSURE_ITERATIONS = 20;

class GLProgram {
    constructor (vertexShader, fragmentShader) {
        this.uniforms = {};
        this.program = gl.createProgram();

        gl.attachShader(this.program, vertexShader);
        gl.attachShader(this.program, fragmentShader);
        gl.linkProgram(this.program);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            throw gl.getProgramInfoLog(this.program);
        }

        const uniformCount = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < uniformCount; i++) {
            const uniformName = gl.getActiveUniform(this.program, i).name;
            this.uniforms[uniformName] = gl.getUniformLocation(this.program, uniformName);
        }
    }

    bind () {
        gl.useProgram(this.program);
    }
}

function compileShader (type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw gl.getShaderInfoLog(shader);
    }

    return shader;
};

const baseVertexShader = compileShader(gl.VERTEX_SHADER, `
    precision mediump float;

    attribute vec2 aPosition;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform vec2 texelSize;

    void main () {
        vUv = aPosition * 0.5 + 0.5;
        vL = vUv - vec2(texelSize.x, 0.0);
        vR = vUv + vec2(texelSize.x, 0.0);
        vT = vUv + vec2(0.0, texelSize.y);
        vB = vUv - vec2(0.0, texelSize.y);
        gl_Position = vec4(aPosition, 0.0, 1.0);
    }
`);

const displayShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;

    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;

    void main () {
        gl_FragColor = texture2D(uTexture, vUv);
    }
`);

const initDensityShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;

    varying vec2 vUv;

    void main () {
        float d = mod(floor(vUv.x * 10.0) + floor(vUv.y * 10.0), 2.0);
        gl_FragColor = vec4(vec3(d), 1.0);
    }
`);

const initVelocityShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;

    varying vec2 vUv;

    void main () {
        gl_FragColor = vec4(sin(6.28 * vUv.y), sin(6.28 * vUv.x), 0.0, 1.0);
    }
`);

const splatShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;

    varying vec2 vUv;
    uniform sampler2D uTarget;
    uniform float aspectRatio;
    uniform vec3 color;
    uniform vec2 point;
    uniform float radius;

    void main () {
        vec2 p = vUv - point.xy;
        p.x *= aspectRatio;
        vec3 splat = exp(-dot(p, p) / radius) * color;
        vec3 base = texture2D(uTarget, vUv).xyz;
        gl_FragColor = vec4(base + splat, 1.0);
    }
`);

const advectionManualFilteringShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;

    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform vec2 texelSize;
    uniform float dt;
    uniform float dissipation;

    vec4 bilerp (in sampler2D sam, in vec2 p) {
        vec4 st;
        st.xy = floor(p - 0.5) + 0.5;
        st.zw = st.xy + 1.0;
        vec4 uv = st * texelSize.xyxy;
        vec4 a = texture2D(sam, uv.xy);
        vec4 b = texture2D(sam, uv.zy);
        vec4 c = texture2D(sam, uv.xw);
        vec4 d = texture2D(sam, uv.zw);
        vec2 f = p - st.xy;
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    void main () {
        vec2 coord = gl_FragCoord.xy - dt * texture2D(uVelocity, vUv).xy;
        gl_FragColor = dissipation * bilerp(uSource, coord);
        gl_FragColor.a = 1.0;
    }
`);

const advectionShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;

    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform vec2 texelSize;
    uniform float dt;
    uniform float dissipation;

    void main () {
        vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
        gl_FragColor = dissipation * texture2D(uSource, coord);
    }
`);

const divergenceShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;

    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uVelocity;

    vec2 sampleVelocity (in vec2 uv) {
        vec2 multiplier = vec2(1.0, 1.0);
        if (uv.x < 0.0) { uv.x = 0.0; multiplier.x = -1.0; }
        if (uv.x > 1.0) { uv.x = 1.0; multiplier.x = -1.0; }
        if (uv.y < 0.0) { uv.y = 0.0; multiplier.y = -1.0; }
        if (uv.y > 1.0) { uv.y = 1.0; multiplier.y = -1.0; }
        return multiplier * texture2D(uVelocity, uv).xy;
    }

    void main () {
        float L = sampleVelocity(vL).x;
        float R = sampleVelocity(vR).x;
        float T = sampleVelocity(vT).y;
        float B = sampleVelocity(vB).y;
        float div = 0.5 * (R - L + T - B);
        gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
    }
`);

const curlShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;

    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uVelocity;

    void main () {
        float L = texture2D(uVelocity, vL).y;
        float R = texture2D(uVelocity, vR).y;
        float T = texture2D(uVelocity, vT).x;
        float B = texture2D(uVelocity, vB).x;
        float vorticity = 0.5 * (R - L - T + B);
        gl_FragColor = vec4(vorticity, 0.0, 0.0, 1.0);
    }
`);

const vorticityShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;

    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uVelocity;
    uniform sampler2D uCurl;
    uniform float curl;
    uniform float dt;

    void main () {
        float L = texture2D(uCurl, vL).y;
        float R = texture2D(uCurl, vR).y;
        float T = texture2D(uCurl, vT).x;
        float B = texture2D(uCurl, vB).x;
        float C = texture2D(uCurl, vUv).x;

        vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
        float lengthSquared = max(0.0001, dot(force, force));
        force *= inversesqrt(lengthSquared) * curl * C;
        force.y *= -1.0;

        vec2 vel = texture2D(uVelocity, vUv).xy;
        gl_FragColor = vec4(vel + force * dt, 0.0, 1.0);
    }
`);

const pressureShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;

    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uDivergence;

    vec2 boundary (in vec2 uv) {
        uv = min(max(uv, 0.0), 1.0);
        return uv;
    }

    void main () {
        float L = texture2D(uPressure, boundary(vL)).x;
        float R = texture2D(uPressure, boundary(vR)).x;
        float T = texture2D(uPressure, boundary(vT)).x;
        float B = texture2D(uPressure, boundary(vB)).x;
        float C = texture2D(uPressure, vUv).x;
        float divergence = texture2D(uDivergence, vUv).x;
        float pressure = (L + R + B + T - divergence) * 0.25;
        gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
    }
`);

const gradientSubtractShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;

    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uVelocity;

    vec2 boundary (in vec2 uv) {
        uv = min(max(uv, 0.0), 1.0);
        return uv;
    }

    void main () {
        float L = texture2D(uPressure, boundary(vL)).x;
        float R = texture2D(uPressure, boundary(vR)).x;
        float T = texture2D(uPressure, boundary(vT)).x;
        float B = texture2D(uPressure, boundary(vB)).x;
        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity.xy -= vec2(R - L, T - B);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
    }
`);

const blit = (() => {
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);

    return (destination) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, destination);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }
})();

function clear (target) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
}

let texId = -1;
function createFBO (width, height, format, type, param) {
    texId++;
    gl.activeTexture(gl.TEXTURE0 + texId);
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, format, type, null);

    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    return [texture, fbo, texId];
}

function createDoubleFBO (width, height, format, type, param) {
    let fbo1 = createFBO(width, height, format, type, param);
    let fbo2 = createFBO(width, height, format, type, param);

    return {
        get first () {
            return fbo1;
        },
        get second () {
            return fbo2;
        },
        swap: () => {
            let temp = fbo1;
            fbo1 = fbo2;
            fbo2 = temp;
        }
    }
}

let density    = createDoubleFBO(TEXTURE_WIDTH, TEXTURE_HEIGHT, gl.RGBA, halfFloat.HALF_FLOAT_OES, support_linear_float ? gl.LINEAR : gl.NEAREST);
let velocity   = createDoubleFBO(TEXTURE_WIDTH, TEXTURE_HEIGHT, gl.RGBA, halfFloat.HALF_FLOAT_OES, support_linear_float ? gl.LINEAR : gl.NEAREST);
let divergence = createFBO      (TEXTURE_WIDTH, TEXTURE_HEIGHT, gl.RGBA, halfFloat.HALF_FLOAT_OES, gl.NEAREST);
let curl       = createFBO      (TEXTURE_WIDTH, TEXTURE_HEIGHT, gl.RGBA, halfFloat.HALF_FLOAT_OES, gl.NEAREST);
let pressure   = createDoubleFBO(TEXTURE_WIDTH, TEXTURE_HEIGHT, gl.RGBA, halfFloat.HALF_FLOAT_OES, gl.NEAREST);

const displayProgram = new GLProgram(baseVertexShader, displayShader);
const splatProgram = new GLProgram(baseVertexShader, splatShader);
const initDensityProgram = new GLProgram(baseVertexShader, initDensityShader);
const initVelocityProgram = new GLProgram(baseVertexShader, initVelocityShader);
const advectionProgram = new GLProgram(baseVertexShader, support_linear_float ? advectionShader : advectionManualFilteringShader);
const divergenceProgram = new GLProgram(baseVertexShader, divergenceShader);
const curlProgram = new GLProgram(baseVertexShader, curlShader);
const vorticityProgram = new GLProgram(baseVertexShader, vorticityShader);
const pressureProgram = new GLProgram(baseVertexShader, pressureShader);
const gradienSubtractProgram = new GLProgram(baseVertexShader, gradientSubtractShader);

let pointer = {
    x: 0,
    y: 0,
    deltax: 0,
    deltay: 0,
    down: false,
    moved: false,
    color: [0.4, 0, 1]
}

initDensityProgram.bind();
blit(density.first[1]);
initVelocityProgram.bind();
blit(velocity.first[1]);

Update();

function Update () {
    resizeCanvas();

    gl.viewport(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);

    advectionProgram.bind();
    gl.uniform2f(advectionProgram.uniforms.texelSize, 1.0 / TEXTURE_WIDTH, 1.0 / TEXTURE_HEIGHT);
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.first[2]);
    gl.uniform1i(advectionProgram.uniforms.uSource, velocity.first[2]);
    gl.uniform1f(advectionProgram.uniforms.dt, 0.016);
    gl.uniform1f(advectionProgram.uniforms.dissipation, VELOCITY_DISSIPATION);
    blit(velocity.second[1]);
    velocity.swap();

    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.first[2]);
    gl.uniform1i(advectionProgram.uniforms.uSource, density.first[2]);
    gl.uniform1f(advectionProgram.uniforms.dissipation, DENSITY_DISSIPATION);
    blit(density.second[1]);
    density.swap();

    if (pointer.moved)
    {
        splatProgram.bind();
        gl.uniform1i(splatProgram.uniforms.uTarget, velocity.first[2]);
        gl.uniform1f(splatProgram.uniforms.aspectRatio, TEXTURE_WIDTH / TEXTURE_HEIGHT);
        gl.uniform2f(splatProgram.uniforms.point, pointer.x / canvas.width, 1.0 - pointer.y / canvas.height);
        gl.uniform3f(splatProgram.uniforms.color, pointer.deltax, -pointer.deltay, 1.0);
        gl.uniform1f(splatProgram.uniforms.radius, SPLAT_RADIUS);
        blit(velocity.second[1]);
        velocity.swap();

        gl.uniform1i(splatProgram.uniforms.uTarget, density.first[2]);
        gl.uniform3f(splatProgram.uniforms.color, pointer.color[0] * 0.3, pointer.color[1] * 0.3, pointer.color[2] * 0.3);
        blit(density.second[1]);
        density.swap();
    }

    curlProgram.bind();
    gl.uniform2f(curlProgram.uniforms.texelSize, 1.0 / TEXTURE_WIDTH, 1.0 / TEXTURE_HEIGHT);
    gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.first[2]);
    blit(curl[1]);

    vorticityProgram.bind();
    gl.uniform2f(vorticityProgram.uniforms.texelSize, 1.0 / TEXTURE_WIDTH, 1.0 / TEXTURE_HEIGHT);
    gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.first[2]);
    gl.uniform1i(vorticityProgram.uniforms.uCurl, curl[2]);
    gl.uniform1f(vorticityProgram.uniforms.curl, CURL);
    gl.uniform1f(vorticityProgram.uniforms.dt, 0.016);
    blit(velocity.second[1]);
    velocity.swap();

    divergenceProgram.bind();
    gl.uniform2f(divergenceProgram.uniforms.texelSize, 1.0 / TEXTURE_WIDTH, 1.0 / TEXTURE_HEIGHT);
    gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.first[2]);
    blit(divergence[1]);

    clear(pressure.first[1]);
    pressureProgram.bind();
    gl.uniform2f(pressureProgram.uniforms.texelSize, 1.0 / TEXTURE_WIDTH, 1.0 / TEXTURE_HEIGHT);
    gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence[2]);
    for (let i = 0; i < PRESSURE_ITERATIONS; i++) {
        gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.first[2]);
        blit(pressure.second[1]);
        pressure.swap();
    }

    gradienSubtractProgram.bind();
    gl.uniform2f(gradienSubtractProgram.uniforms.texelSize, 1.0 / TEXTURE_WIDTH, 1.0 / TEXTURE_HEIGHT);
    gl.uniform1i(gradienSubtractProgram.uniforms.uPressure, pressure.first[2]);
    gl.uniform1i(gradienSubtractProgram.uniforms.uVelocity, velocity.first[2]);
    blit(velocity.second[1]);
    velocity.swap();

    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    displayProgram.bind();
    gl.uniform1i(displayProgram.uniforms.uTexture, density.first[2]);
    blit(null);

    pointer.moved = false;

    requestAnimationFrame(Update);
}

function resizeCanvas () {
    if (canvas.width != canvas.clientWidth || canvas.height != canvas.clientHeight) {
        const displayHeight = canvas.clientHeight;
        canvas.width = canvas.clientWidth;
        canvas.height = displayHeight;
    }
}

canvas.addEventListener('mousemove', (e) => {
    pointer.moved = pointer.down;
    pointer.deltax = clampDelta(e.offsetX - pointer.x);
    pointer.deltay = clampDelta(e.offsetY - pointer.y);
    pointer.x = e.offsetX;
    pointer.y = e.offsetY;
});

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    pointer.moved = pointer.down;
    pointer.deltax = clampDelta(touch.offsetX - pointer.x);
    pointer.deltay = clampDelta(touch.offsetY - pointer.y);
    pointer.x = touch.offsetX;
    pointer.y = touch.offsetY;
});

function clampDelta (delta) {
    return delta * 10;//Math.min(Math.max(delta, -CELL_SIZE), CELL_SIZE);
}

canvas.addEventListener('mousedown', onPointerDown);
canvas.addEventListener('touchstart', onPointerDown);
window.addEventListener('mouseup', onPointerUp);
window.addEventListener('touchend', onPointerUp);

function onPointerDown () {
    pointer.down = true;
    pointer.color = [Math.random() + 0.5, Math.random() + 0.5, Math.random()];
}

function onPointerUp () {
    pointer.down = false;
}