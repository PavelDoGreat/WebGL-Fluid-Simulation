
'use strict';

const canvas = document.getElementsByTagName('canvas')[0];
const gl = canvas.getContext('webgl', { alpha: false });

if (!gl.getExtension("OES_texture_float")) {
   console.log("does not support OES_texture_float");
}

if (!gl.getExtension("OES_texture_float_linear")) {
   console.log("does not support  OES_texture_float_linear");
}

resizeCanvas();

const TEXTURE_WIDTH = gl.drawingBufferWidth;
const TEXTURE_HEIGHT = gl.drawingBufferHeight;
const CELL_SIZE = 1;

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

function createFBO (width, height) {
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.FLOAT, null);

    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    return [texture, fbo];
}

function createDoubleFBO (width, height) {
    let fbo1 = createFBO(width, height);
    let fbo2 = createFBO(width, height);

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

let density = createDoubleFBO(TEXTURE_WIDTH, TEXTURE_HEIGHT);
let velocity = createDoubleFBO(TEXTURE_WIDTH, TEXTURE_HEIGHT);
let divergence = createFBO(TEXTURE_WIDTH, TEXTURE_HEIGHT);
let pressure = createDoubleFBO(TEXTURE_WIDTH, TEXTURE_HEIGHT);
let gradientSubtract = createFBO(TEXTURE_WIDTH, TEXTURE_HEIGHT);

const baseVertexShader = compileShader(gl.VERTEX_SHADER, `
    attribute vec2 aPosition;
    varying vec2 vUv;

    void main () {
        vUv = aPosition * 0.5 + 0.5;
        gl_Position = vec4(aPosition, 0.0, 1.0);
    }
`);

const displayShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uTexture;

    void main () {
        gl_FragColor = texture2D(uTexture, vUv);
    }
`);

const testShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform vec2 uMouse;

    void main () {
        vec4 color = texture2D(uTexture, vUv);
        // gl_FragColor = vec4(vUv.xy, uMouse.x, 1.0);// + color;
        gl_FragColor = color + vec4(0.0, 0.005, 0.0, 0.0);
    }
`);

const initDensityShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;

    varying vec2 vUv;

    void main () {
        float d = mod(floor(vUv.x * 10.0) + floor(vUv.y * 10.0), 2.0);
        gl_FragColor = vec4(vec3(d), 1.0);
    }
`);

const initVelocityShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;

    varying vec2 vUv;

    void main () {
        gl_FragColor = vec4(sin(6.28 * vUv.y), sin(6.28 * vUv.x), 0.0, 1.0);
    }
`);

const advectionShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform vec2 wh_inv;
    uniform float dt;
    uniform float rdx;
    uniform float dissipation;

    void main () {
        vec2 velocity = texture2D(uVelocity, vUv).xy;
        vec2 back_pos = vUv - dt * rdx * velocity * wh_inv;
        gl_FragColor = dissipation * texture2D(uSource, back_pos);
        gl_FragColor.a = 1.0;
    }
`);

const divergenceShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform vec2 wh_inv;
    uniform float halfrdx;

    void main () {
        vec2 T = texture2D(uVelocity, vUv + vec2(0.0, wh_inv.y)).xy;
        vec2 B = texture2D(uVelocity, vUv - vec2(0.0, wh_inv.y)).xy;
        vec2 R = texture2D(uVelocity, vUv + vec2(wh_inv.x, 0.0)).xy;
        vec2 L = texture2D(uVelocity, vUv - vec2(wh_inv.x, 0.0)).xy;
        //vec2 C = texture2D(uVelocity, vUv).xy;
        float div = halfrdx * ((R.x - L.x) + (T.y - B.y));
        gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
    }
`);

const pressureShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uPressure;
    uniform sampler2D uDivergence;
    uniform vec2 wh_inv;
    uniform float alpha;

    void main () {
        float T = texture2D(uPressure, vUv + vec2(0.0, wh_inv.y)).x;
        float B = texture2D(uPressure, vUv - vec2(0.0, wh_inv.y)).x;
        float R = texture2D(uPressure, vUv + vec2(wh_inv.x, 0.0)).x;
        float L = texture2D(uPressure, vUv - vec2(wh_inv.x, 0.0)).x;

        float divergence = texture2D(uDivergence, vUv).x;
        float pressure = (L + R + B + T + alpha * divergence) * .25;

        gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
    }
`);

const gradientSubtractShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uPressure;
    uniform sampler2D uVelocity;
    uniform vec2 wh_inv;
    uniform float halfrdx;

    void main () {
        float T = texture2D(uPressure, vUv + vec2(0.0, wh_inv.y)).x;
        float B = texture2D(uPressure, vUv - vec2(0.0, wh_inv.y)).x;
        float R = texture2D(uPressure, vUv + vec2(wh_inv.x, 0.0)).x;
        float L = texture2D(uPressure, vUv - vec2(wh_inv.x, 0.0)).x;

        vec2 velocity = texture2D(uVelocity, vUv).xy;
        vec2 result = velocity - halfrdx * vec2(R - L, T - B);

        gl_FragColor = vec4(result, 0.0, 1.0);
    }
`);

const displayProgram = new GLProgram(baseVertexShader, displayShader);
const testProgram = new GLProgram(baseVertexShader, testShader);
const initDensityProgram = new GLProgram(baseVertexShader, initDensityShader);
const initVelocityProgram = new GLProgram(baseVertexShader, initVelocityShader);

const advectionProgram = new GLProgram(baseVertexShader, advectionShader);
const divergenceProgram = new GLProgram(baseVertexShader, divergenceShader);
const pressureProgram = new GLProgram(baseVertexShader, pressureShader);
const gradienSubtractProgram = new GLProgram(baseVertexShader, gradientSubtractShader);

let pointer = {
    x: 0,
    y: 0
}

gl.bindTexture(gl.TEXTURE_2D, null);
initDensityProgram.bind();
blit(density.first[1]);
initVelocityProgram.bind();
blit(velocity.first[1]);

Update();

function Update () {
    resizeCanvas();

    gl.viewport(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
    gl.activeTexture(gl.TEXTURE0 + 0);
    gl.bindTexture(gl.TEXTURE_2D, velocity.first[0]);
    gl.activeTexture(gl.TEXTURE0 + 1);
    gl.bindTexture(gl.TEXTURE_2D, density.first[0]);

    // advect density
    advectionProgram.bind();
    gl.uniform1i(advectionProgram.uniforms.uVelocity, 0);
    gl.uniform1i(advectionProgram.uniforms.uSource, 1);
    gl.uniform2f(advectionProgram.uniforms.wh_inv, 1.0 / TEXTURE_WIDTH, 1.0 / TEXTURE_HEIGHT);
    gl.uniform1f(advectionProgram.uniforms.dt, 1.0);
    gl.uniform1f(advectionProgram.uniforms.rdx, 1 / CELL_SIZE);
    gl.uniform1f(advectionProgram.uniforms.dissipation, 1.0);
    blit(density.second[1]);

    // calculate divergence
    gl.activeTexture(gl.TEXTURE0 + 0);
    gl.bindTexture(gl.TEXTURE_2D, velocity.first[0]);
    divergenceProgram.bind();
    gl.uniform1i(divergenceProgram.uniforms.uVelocity, 0);
    gl.uniform2f(divergenceProgram.uniforms.wh_inv, 1.0 / TEXTURE_WIDTH, 1.0 / TEXTURE_HEIGHT);
    gl.uniform1f(divergenceProgram.uniforms.halfrdx, 0.5 * (1 / CELL_SIZE));
    blit(divergence[1]);

    // pressure
    clear(pressure.first[1]);
    clear(pressure.second[1]);
    gl.activeTexture(gl.TEXTURE0 + 0);
    gl.bindTexture(gl.TEXTURE_2D, divergence[0]);
    pressureProgram.bind();
    gl.uniform1i(pressureProgram.uniforms.uPressure, 1);
    gl.uniform1i(pressureProgram.uniforms.uDivergence, 0);
    gl.uniform2f(pressureProgram.uniforms.wh_inv, 1.0 / TEXTURE_WIDTH, 1.0 / TEXTURE_HEIGHT);
    gl.uniform1f(pressureProgram.uniforms.alpha, -CELL_SIZE * CELL_SIZE);
    for (let i = 0; i < 10; i++) {
        gl.activeTexture(gl.TEXTURE0 + 1);
        gl.bindTexture(gl.TEXTURE_2D, pressure.first[0]);
        blit(pressure.second[1]);
        pressure.swap();
    }

    // subtract gradient
    gl.activeTexture(gl.TEXTURE0 + 0);
    gl.bindTexture(gl.TEXTURE_2D, pressure.second[0]);
    gl.activeTexture(gl.TEXTURE0 + 1);
    gl.bindTexture(gl.TEXTURE_2D, velocity.first[0]);
    gradienSubtractProgram.bind();
    gl.uniform1i(gradienSubtractProgram.uniforms.uPressure, 0);
    gl.uniform1i(gradienSubtractProgram.uniforms.uVelocity, 1);
    gl.uniform2f(gradienSubtractProgram.uniforms.wh_inv, 1.0 / TEXTURE_WIDTH, 1.0 / TEXTURE_HEIGHT);
    gl.uniform1f(gradienSubtractProgram.uniforms.halfrdx, 0.5 * (1 / CELL_SIZE));
    blit(velocity.second[1]);

    // advect velocity
    gl.activeTexture(gl.TEXTURE0 + 1);
    gl.bindTexture(gl.TEXTURE_2D, velocity.second[0]);
    blit(velocity.first[1]);

    // display result
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.activeTexture(gl.TEXTURE0 + 0);
    gl.bindTexture(gl.TEXTURE_2D, density.first[0]);
    displayProgram.bind();
    blit(null);

    density.swap();
    velocity.swap();

    requestAnimationFrame(Update);
}

function resizeCanvas () {
    if (canvas.width != canvas.clientWidth || canvas.height != canvas.clientHeight) {
        const displayHeight = canvas.clientHeight;
        canvas.width = canvas.clientWidth;
        canvas.height = displayHeight;
    }
}

window.addEventListener('mousemove', (e) => {
    pointer.x = e.offsetX / canvas.width;
    pointer.y = e.offsetY / canvas.height;
});