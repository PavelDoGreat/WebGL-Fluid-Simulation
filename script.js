
'use strict';

const canvas = document.getElementsByTagName('canvas')[0];
const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

if (!gl.getExtension("OES_texture_float")) {
   console.log("does not support OES_texture_float");
}

if (!gl.getExtension("OES_texture_float_linear")) {
   console.log("does not support  OES_texture_float_linear");
}

resizeCanvas();

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

    const texData = new Uint8Array([
    	238, 95, 64, 255,
    	85, 74, 32, 255,
    	86, 39, 95, 255,
    	75, 37, 37, 255
    ]);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.FLOAT, null);

    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    return [texture, fbo];
}

const blit = ((source, destination) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);

    return (destination) => {
        // gl.bindTexture(gl.TEXTURE_2D, source === null ? null : source[0]);
        gl.bindFramebuffer(gl.FRAMEBUFFER, destination);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }
})();

let source = createFBO(gl.drawingBufferWidth, gl.drawingBufferHeight);
let source2 = createFBO(gl.drawingBufferWidth, gl.drawingBufferHeight);
let velocity = createFBO(gl.drawingBufferWidth, gl.drawingBufferHeight);
let velocity2 = createFBO(gl.drawingBufferWidth, gl.drawingBufferHeight);
let divergence = createFBO(gl.drawingBufferWidth, gl.drawingBufferHeight);

const vertexShader = compileShader(gl.VERTEX_SHADER, `
	attribute vec2 aPosition;
	varying vec2 vUv;

	void main () {
		vUv = aPosition * 0.5 + 0.5;
		gl_Position = vec4(aPosition, 0.0, 1.0);
	}
`);

const simpleFragmentShader = compileShader(gl.FRAGMENT_SHADER, `
	precision highp float;

	varying vec2 vUv;
    uniform sampler2D uTexture;

	void main () {
        gl_FragColor = texture2D(uTexture, vUv);
	}
`);

const simulationFragmentShader = compileShader(gl.FRAGMENT_SHADER, `
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

const initSourceShader = compileShader(gl.FRAGMENT_SHADER, `
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

const simpleProgram = new GLProgram(vertexShader, simpleFragmentShader);
const simulationProgram = new GLProgram(vertexShader, simulationFragmentShader);
const initSourceProgram = new GLProgram(vertexShader, initSourceShader);
const initVelocityProgram = new GLProgram(vertexShader, initVelocityShader);
const advectionProgram = new GLProgram(vertexShader, advectionShader);
const divergenceProgram = new GLProgram(vertexShader, divergenceShader);

let pointer = {
    x: 0,
    y: 0
}

gl.bindTexture(gl.TEXTURE_2D, null);
initSourceProgram.bind();
blit(source[1]);
initVelocityProgram.bind();
blit(velocity[1]);

Update();

function advect (target, dt) {
    gl.activeTexture(gl.TEXTURE0 + 0);
    gl.bindTexture(gl.TEXTURE_2D, velocity[0]);
    gl.activeTexture(gl.TEXTURE0 + 1);
    gl.bindTexture(gl.TEXTURE_2D, source[0]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target[1]);

    advectionProgram.bind();
    gl.uniform1i(advectionProgram.uniforms.uVelocity, 0);
    gl.uniform1i(advectionProgram.uniforms.uSource, 1);
    gl.uniform2f(advectionProgram.uniforms.wh_inv, 1.0 / canvas.clientWidth, 1.0 / canvas.clientHeight);
    gl.uniform1f(advectionProgram.uniforms.dt, dt);
    gl.uniform1f(advectionProgram.uniforms.rdx, 1.0);
    gl.uniform1f(advectionProgram.uniforms.dissipation, 1.0);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
}

function Update () {
    resizeCanvas();

    // advect(source, 1.0);

    gl.activeTexture(gl.TEXTURE0 + 0);
    gl.bindTexture(gl.TEXTURE_2D, velocity[0]);
    gl.activeTexture(gl.TEXTURE0 + 1);
    gl.bindTexture(gl.TEXTURE_2D, source[0]);
        
    advectionProgram.bind();
    gl.uniform1i(advectionProgram.uniforms.uVelocity, 0);
    gl.uniform1i(advectionProgram.uniforms.uSource, 1);
    gl.uniform2f(advectionProgram.uniforms.wh_inv, 1.0 / canvas.clientWidth, 1.0 / canvas.clientHeight);
    gl.uniform1f(advectionProgram.uniforms.dt, 1.0);
    gl.uniform1f(advectionProgram.uniforms.rdx, 1.0);
    gl.uniform1f(advectionProgram.uniforms.dissipation, 1.0);
    blit(source2[1]);
    
    // gl.activeTexture(gl.TEXTURE0 + 1);
    // gl.bindTexture(gl.TEXTURE_2D, velocity[0]);
    // blit(velocity2[1]);

    gl.activeTexture(gl.TEXTURE0 + 0);
    gl.bindTexture(gl.TEXTURE_2D, velocity2[0]);
    divergenceProgram.bind();
    gl.uniform1i(divergenceProgram.uniforms.uVelocity, 0);
    gl.uniform2f(divergenceProgram.uniforms.wh_inv, 1.0 / canvas.clientWidth, 1.0 / canvas.clientHeight);
    gl.uniform1f(divergenceProgram.uniforms.halfrdx, 0.5);
    blit(divergence[1]);

    gl.activeTexture(gl.TEXTURE0 + 0);
    gl.bindTexture(gl.TEXTURE_2D, source[0]);
    simpleProgram.bind();
    blit(null);

    let temp = source2;
    source2 = source;
    source = temp;

    temp = velocity2;
    velocity2 = velocity;
    velocity = temp;

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