/*
MIT License

Copyright (c) 2017 Pavel Dobryakov

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

'use strict';

// Simulation section

const canvas = document.getElementsByTagName('canvas')[0];
resizeCanvas();

let config = {
    SIM_RESOLUTION: 128,
    DYE_RESOLUTION: 128,
    CAPTURE_RESOLUTION: 128,
    DENSITY_DISSIPATION: 0.1,
    VELOCITY_DISSIPATION: 0.1,
    PRESSURE: 0.0,
    PRESSURE_ITERATIONS: 10, //20
    CURL: 0,//2
    SPLAT_RADIUS: 0.25,
    SPLAT_FORCE: 6000,
    SHADING: false,
    COLORFUL: false,
    COLOR_UPDATE_SPEED: 10,
    PAUSED: false,
    BACK_COLOR: { r: 0, g: 0, b: 255 },
    TRANSPARENT: false,
    BLOOM: false,
    BLOOM_ITERATIONS: 8,
    BLOOM_RESOLUTION: 256,
    BLOOM_INTENSITY: 0.2, //0.8
    BLOOM_THRESHOLD: 0.8,
    BLOOM_SOFT_KNEE: 0.05, //0.7
    SUNRAYS: false,
    SUNRAYS_RESOLUTION: 196,
    SUNRAYS_WEIGHT: 0.05,
    COLLECT_DATA: false,
    AUTO_SCREEN_CAP_TIME: 5.0,
    AUTO_SPLAT_TIME: 3.0,
    DATA_TITLE: "capture"
}

function pointerPrototype () {
    this.id = -1;
    this.texcoordX = 0;
    this.texcoordY = 0;
    this.prevTexcoordX = 0;
    this.prevTexcoordY = 0;
    this.deltaX = 0;
    this.deltaY = 0;
    this.down = false;
    this.moved = false;
    this.color = [30, 0, 300];
}

let pointers = [];
let splatStack = [];
pointers.push(new pointerPrototype());

const { gl, ext } = getWebGLContext(canvas);

if (isMobile()) {
    config.DYE_RESOLUTION = 512;
}
if (!ext.supportLinearFiltering) {
    config.DYE_RESOLUTION = 512;
    config.SHADING = false;
    config.BLOOM = false;
    config.SUNRAYS = false;
}

startGUI();

function getWebGLContext (canvas) {
    const params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false };

    let gl = canvas.getContext('webgl2', params);
    const isWebGL2 = !!gl;
    if (!isWebGL2)
        gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params);

    let halfFloat;
    let supportLinearFiltering;
    if (isWebGL2) {
        gl.getExtension('EXT_color_buffer_float');
        supportLinearFiltering = gl.getExtension('OES_texture_float_linear');
    } else {
        halfFloat = gl.getExtension('OES_texture_half_float');
        supportLinearFiltering = gl.getExtension('OES_texture_half_float_linear');
    }

    gl.clearColor(0.0, 0.0, 0.0, 1.0);

    const halfFloatTexType = isWebGL2 ? gl.HALF_FLOAT : halfFloat.HALF_FLOAT_OES;
    let formatRGBA;
    let formatRG;
    let formatR;

    if (isWebGL2)
    {
        formatRGBA = getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, halfFloatTexType);
        formatRG = getSupportedFormat(gl, gl.RG16F, gl.RG, halfFloatTexType);
        formatR = getSupportedFormat(gl, gl.R16F, gl.RED, halfFloatTexType);
    }
    else
    {
        formatRGBA = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
        formatRG = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
        formatR = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
    }

    return {
        gl,
        ext: {
            formatRGBA,
            formatRG,
            formatR,
            halfFloatTexType,
            supportLinearFiltering
        }
    };
}

function getSupportedFormat (gl, internalFormat, format, type)
{
    if (!supportRenderTextureFormat(gl, internalFormat, format, type))
    {
        switch (internalFormat)
        {
            case gl.R16F:
                return getSupportedFormat(gl, gl.RG16F, gl.RG, type);
            case gl.RG16F:
                return getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type);
            default:
                return null;
        }
    }

    return {
        internalFormat,
        format
    }
}

function supportRenderTextureFormat (gl, internalFormat, format, type) {
    let texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);

    let fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    let status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    return status == gl.FRAMEBUFFER_COMPLETE;
}

function startGUI () {
    var gui = new dat.GUI({ width: 300 });
    gui.add(config, 'DYE_RESOLUTION', { 'high': 1024, 'medium': 512, 'low': 256, 'very low': 128 }).name('quality').onFinishChange(initFramebuffers);
    gui.add(config, 'SIM_RESOLUTION', { '32': 32, '64': 64, '128': 128, '256': 256, '512': 512 }).name('sim resolution').onFinishChange(initFramebuffers);
    gui.add(config, 'DENSITY_DISSIPATION', 0, 4.0).name('density diffusion');
    gui.add(config, 'VELOCITY_DISSIPATION', 0, 4.0).name('velocity diffusion');
    gui.add(config, 'PRESSURE', 0.0, 1.0).name('pressure');
    gui.add(config, 'CURL', 0, 50).name('vorticity').step(1);
    gui.add(config, 'SPLAT_RADIUS', 0.01, 1.0).name('splat radius');
    gui.add(config, 'SHADING').name('shading').onFinishChange(updateKeywords);
    gui.add(config, 'COLORFUL').name('colorful');
    gui.add(config, 'PAUSED').name('paused').listen();

    gui.add({ fun: () => {
        splatStack.push(parseInt(Math.random() * 20) + 5);
    } }, 'fun').name('Random splats');

    //let bloomFolder = gui.addFolder('Bloom');
    //bloomFolder.add(config, 'BLOOM').name('enabled').onFinishChange(updateKeywords);
    //bloomFolder.add(config, 'BLOOM_INTENSITY', 0.1, 2.0).name('intensity');
    //bloomFolder.add(config, 'BLOOM_THRESHOLD', 0.0, 1.0).name('threshold');

    let sunraysFolder = gui.addFolder('Sunrays');
    sunraysFolder.add(config, 'SUNRAYS').name('enabled').onFinishChange(updateKeywords);
    sunraysFolder.add(config, 'SUNRAYS_WEIGHT', 0.001, 1.0).name('weight');

    let captureFolder = gui.addFolder('Capture');
    captureFolder.addColor(config, 'BACK_COLOR').name('background color');
    captureFolder.add(config, 'TRANSPARENT').name('transparent');
    captureFolder.add({ fun: captureScreenshot }, 'fun').name('take screenshot');
    captureFolder.add(config, 'CAPTURE_RESOLUTION', { 'high': 1024, 'medium': 512, 'low': 256, 'very low': 128 }).name('quality').onFinishChange(initFramebuffers);
    captureFolder.add(config, 'COLLECT_DATA').name('collect data').onFinishChange(updateKeywords);
    captureFolder.add(config, 'AUTO_SCREEN_CAP_TIME', 1.0, 10.0).name('screenshot time (s)').step(0.5);
    captureFolder.add(config, 'AUTO_SPLAT_TIME', 1.0, 10.0).name('splat time (s)').step(0.5);
    captureFolder.add(config, 'DATA_TITLE').name('save name');

    let github = gui.add({ fun : () => {
        window.open('https://github.com/eacoleman/little-earth-sandbox');
        ga('send', 'event', 'link button', 'github');
    } }, 'fun').name('Github');
    github.__li.className = 'cr function bigFont';
    github.__li.style.borderLeft = '3px solid #8C8C8C';
    let githubIcon = document.createElement('span');
    github.domElement.parentElement.appendChild(githubIcon);
    githubIcon.className = 'icon github';

    if (isMobile())
        gui.close();
}

function isMobile () {
    return /Mobi|Android/i.test(navigator.userAgent);
}

function captureScreenshot () {
    let res = getResolution(config.CAPTURE_RESOLUTION);
    let target = createFBO(res.width, res.height, ext.formatRGBA.internalFormat, ext.formatRGBA.format, ext.halfFloatTexType, gl.NEAREST);
    render(target);

    let texture = framebufferToTexture(target);
    texture = normalizeTexture(texture, target.width, target.height);

    let captureCanvas = textureToCanvas(texture, target.width, target.height);
    let datauri = captureCanvas.toDataURL();
    downloadURI(config.DATA_TITLE+'.png', datauri);
    URL.revokeObjectURL(datauri);
}


function framebufferToTexture (target) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    let length = target.width * target.height * 4;
    let texture = new Float32Array(length);
    gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.FLOAT, texture);
    return texture;
}

function normalizeTexture (texture, width, height) {
    let result = new Uint8Array(texture.length);
    let id = 0;
    for (let i = height - 1; i >= 0; i--) {
        for (let j = 0; j < width; j++) {
            let nid = i * width * 4 + j * 4;
            result[nid + 0] = clamp01(texture[id + 0]) * 255;
            result[nid + 1] = clamp01(texture[id + 1]) * 255;
            result[nid + 2] = clamp01(texture[id + 2]) * 255;
            result[nid + 3] = clamp01(texture[id + 3]) * 255;
            id += 4;
        }
    }
    return result;
}

function normalizeTexture1000 (texture, width, height) {
    let result = new Uint8Array(texture.length);
    let id = 0;
    for (let i = height - 1; i >= 0; i--) {
        for (let j = 0; j < width; j++) {
            let nid = i * width * 4 + j * 4;
            result[nid + 0] = clampAround0p5(texture[id + 0]) * 255;
            result[nid + 1] = clampAround0p5(texture[id + 1]) * 255;
            result[nid + 2] = clampAround0p5(texture[id + 2]) * 255;
            result[nid + 3] = clampAround0p5(texture[id + 3]) * 255;
            id += 4;
        }
    }
    return result;
}

function clamp01 (input) {
    return Math.min(Math.max(input, 0), 1);
}

function clampAround0p5 (input) {
    return clamp01(input/100.0 + 0.5);
}

function textureToCanvas (texture, width, height) {
    let captureCanvas = document.createElement('canvas');
    let ctx = captureCanvas.getContext('2d');
    captureCanvas.width = width;
    captureCanvas.height = height;

    let imageData = ctx.createImageData(width, height);
    imageData.data.set(texture);
    ctx.putImageData(imageData, 0, 0);

    return captureCanvas;
}

function downloadURI (filename, uri) {
    let link = document.createElement('a');
    link.download = filename;
    link.href = uri;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

class Material {
    constructor (vertexShader, fragmentShaderSource) {
        this.vertexShader = vertexShader;
        this.fragmentShaderSource = fragmentShaderSource;
        this.programs = [];
        this.activeProgram = null;
        this.uniforms = [];
    }

    setKeywords (keywords) {
        let hash = 0;
        for (let i = 0; i < keywords.length; i++)
            hash += hashCode(keywords[i]);

        let program = this.programs[hash];
        if (program == null)
        {
            let fragmentShader = compileShader(gl.FRAGMENT_SHADER, this.fragmentShaderSource, keywords);
            program = createProgram(this.vertexShader, fragmentShader);
            this.programs[hash] = program;
        }

        if (program == this.activeProgram) return;

        this.uniforms = getUniforms(program);
        this.activeProgram = program;
    }

    bind () {
        gl.useProgram(this.activeProgram);
    }
}

class Program {
    constructor (vertexShader, fragmentShader) {
        this.uniforms = {};
        this.program = createProgram(vertexShader, fragmentShader);
        this.uniforms = getUniforms(this.program);
    }

    bind () {
        gl.useProgram(this.program);
    }
}

function createProgram (vertexShader, fragmentShader) {
    let program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        console.trace(gl.getProgramInfoLog(program));

    return program;
}

function getUniforms (program) {
    let uniforms = [];
    let uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < uniformCount; i++) {
        let uniformName = gl.getActiveUniform(program, i).name;
        uniforms[uniformName] = gl.getUniformLocation(program, uniformName);
    }
    return uniforms;
}

function compileShader (type, source, keywords) {
    source = addKeywords(source, keywords);

    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        console.trace(gl.getShaderInfoLog(shader));

    return shader;
};

function addKeywords (source, keywords) {
    if (keywords == null) return source;
    let keywordsString = '';
    keywords.forEach(keyword => {
        keywordsString += '#define ' + keyword + '\n';
    });
    return keywordsString + source;
}

const baseVertexShader = compileShader(gl.VERTEX_SHADER, `
    precision highp float;

    attribute vec2 aPosition;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform vec2 texelSize;

    vec2 pbv (vec2 ttV, vec2 velo) {
        if(ttV.y >= 1.0 || ttV.y <  0.0) { 
            return vec2(-velo.x,-velo.y);
        }
        else { return velo; }
    }

    vec2 pbc (vec2 ttV) {
             if(ttV.x >= 1.0) { return vec2(0.0,ttV.y); }
        else if(ttV.x <  0.0) { return vec2(1.0,ttV.y); }
        else if(ttV.y >= 1.0) { return vec2(1.0 - ttV.x,1.0); }
        else if(ttV.y <  0.0) { return vec2(1.0 - ttV.x,0.0); }
        else { return ttV; }
    }

    void main () {
        vUv = aPosition * 0.5 + 0.5;

        vL = vec2(vUv.x - texelSize.x, vUv.y);
        vR = vec2(vUv.x + texelSize.x, vUv.y);
        vT = vec2(vUv.x, vUv.y + texelSize.y);
        vB = vec2(vUv.x, vUv.y - texelSize.y);

        gl_Position = vec4(aPosition, 0.0, 1.0);
    }
`);

const blurVertexShader = compileShader(gl.VERTEX_SHADER, `
    precision highp float;

    attribute vec2 aPosition;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    uniform vec2 texelSize;

    vec2 pbv (vec2 ttV, vec2 velo) {
        if(ttV.y >= 1.0 || ttV.y <  0.0) { 
            return vec2(-velo.x,-velo.y);
        }
        else { return velo; }
    }

    vec2 pbc (vec2 ttV) {
             if(ttV.x >= 1.0) { return vec2(0.0,ttV.y); }
        else if(ttV.x <  0.0) { return vec2(1.0,ttV.y); }
        else if(ttV.y >= 1.0) { return vec2(1.0 - ttV.x,1.0); }
        else if(ttV.y <  0.0) { return vec2(1.0 - ttV.x,0.0); }
        else { return ttV; }
    }

    void main () {
        vUv = aPosition * 0.5 + 0.5;
        float offset = 1.33333333;
        vL = vUv - texelSize * offset;
        vR = vUv + texelSize * offset;

        gl_Position = vec4(aPosition, 0.0, 1.0);
    }
`);

const blurShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;

    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    uniform sampler2D uTexture;

    vec2 pbv (vec2 ttV, vec2 velo) {
        if(ttV.y >= 1.0 || ttV.y <  0.0) { 
            return vec2(-velo.x,-velo.y);
        }
        else { return velo; }
    }

    vec2 pbc (vec2 ttV) {
             if(ttV.x >= 1.0) { return vec2(0.0,ttV.y); }
        else if(ttV.x <  0.0) { return vec2(1.0,ttV.y); }
        else if(ttV.y >= 1.0) { return vec2(1.0 - ttV.x,1.0); }
        else if(ttV.y <  0.0) { return vec2(1.0 - ttV.x,0.0); }
        else { return ttV; }
    }

    void main () {
        vec4 sum = texture2D(uTexture, pbc(vUv)) * 0.29411764;
        sum += texture2D(uTexture, pbc(vL)) * 0.35294117;
        sum += texture2D(uTexture, pbc(vR)) * 0.35294117;
        gl_FragColor = sum;
    }
`);

const copyShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    uniform sampler2D uTexture;

    vec2 pbv (vec2 ttV, vec2 velo) {
        if(ttV.y >= 1.0 || ttV.y <  0.0) { 
            return vec2(-velo.x,-velo.y);
        }
        else { return velo; }
    }

    vec2 pbc (vec2 ttV) {
             if(ttV.x >= 1.0) { return vec2(0.0,ttV.y); }
        else if(ttV.x <  0.0) { return vec2(1.0,ttV.y); }
        else if(ttV.y >= 1.0) { return vec2(1.0 - ttV.x,1.0); }
        else if(ttV.y <  0.0) { return vec2(1.0 - ttV.x,0.0); }
        else { return ttV; }
    }

    void main () {
        gl_FragColor = texture2D(uTexture, pbc(vUv));
    }
`);

const clearShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    uniform sampler2D uTexture;
    uniform float value;

    vec2 pbv (vec2 ttV, vec2 velo) {
        if(ttV.y >= 1.0 || ttV.y <  0.0) { 
            return vec2(-velo.x,-velo.y);
        }
        else { return velo; }
    }

    vec2 pbc (vec2 ttV) {
             if(ttV.x >= 1.0) { return vec2(0.0,ttV.y); }
        else if(ttV.x <  0.0) { return vec2(1.0,ttV.y); }
        else if(ttV.y >= 1.0) { return vec2(1.0 - ttV.x,1.0); }
        else if(ttV.y <  0.0) { return vec2(1.0 - ttV.x,0.0); }
        else { return ttV; }
    }

    void main () {
        gl_FragColor = value * texture2D(uTexture, pbc(vUv));
    }
`);

const colorShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;

    uniform vec4 color;

    void main () {
        gl_FragColor = color;
    }
`);

const checkerboardShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform float aspectRatio;

    #define SCALE 25.0

    void main () {
        vec2 uv = floor(vUv * SCALE * vec2(aspectRatio, 1.0));
        float v = mod(uv.x + uv.y, 2.0);
        v = v * 0.1 + 0.8;
        gl_FragColor = vec4(vec3(v), 1.0);
    }
`);

const displayShaderSource = `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;
    uniform sampler2D uBloom;
    uniform sampler2D uSunrays;
    uniform sampler2D uDithering;
    uniform vec2 ditherScale;
    uniform vec2 texelSize;

    vec2 pbv (vec2 ttV, vec2 velo) {
        if(ttV.y >= 1.0 || ttV.y <  0.0) { 
            return vec2(-velo.x,-velo.y);
        }
        else { return velo; }
    }

    vec2 pbc (vec2 ttV) {
             if(ttV.x >= 1.0) { return vec2(0.0,ttV.y); }
        else if(ttV.x <  0.0) { return vec2(1.0,ttV.y); }
        else if(ttV.y >= 1.0) { return vec2(1.0 - ttV.x,1.0); }
        else if(ttV.y <  0.0) { return vec2(1.0 - ttV.x,0.0); }
        else { return ttV; }
    }

    vec3 linearToGamma (vec3 color) {
        color = max(color, vec3(0));
        return max(1.055 * pow(color, vec3(0.416666667)) - 0.055, vec3(0));
    }

    void main () {
        vec3 c = texture2D(uTexture, pbc(vUv)).rgb;

    #ifdef SHADING
        vec3 lc = texture2D(uTexture, pbc(vL)).rgb;
        vec3 rc = texture2D(uTexture, pbc(vR)).rgb;
        vec3 tc = texture2D(uTexture, pbc(vT)).rgb;
        vec3 bc = texture2D(uTexture, pbc(vB)).rgb;

        float dx = length(rc) - length(lc);
        float dy = length(tc) - length(bc);

        vec3 n = normalize(vec3(dx, dy, length(texelSize)));
        vec3 l = vec3(0.0, 0.0, 1.0);

        float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
        c *= diffuse;
    #endif

    #ifdef BLOOM
        vec3 bloom = texture2D(uBloom, pbc(vUv)).rgb;
    #endif

    #ifdef SUNRAYS
        float sunrays = texture2D(uSunrays, pbc(vUv)).r;
        c *= sunrays;
    #ifdef BLOOM
        bloom *= sunrays;
    #endif
    #endif

    #ifdef BLOOM
        float noise = texture2D(uDithering, pbc(vUv * ditherScale)).r;
        noise = noise * 2.0 - 1.0;
        bloom += noise / 255.0;
        bloom = linearToGamma(bloom);
        c += bloom;
    #endif

        float a = max(c.r, max(c.g, c.b));
        gl_FragColor = vec4(c, a);
    }
`;

const bloomPrefilterShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform vec3 curve;
    uniform float threshold;

    vec2 pbv (vec2 ttV, vec2 velo) {
        if(ttV.y >= 1.0 || ttV.y <  0.0) { 
            return vec2(-velo.x,-velo.y);
        }
        else { return velo; }
    }

    vec2 pbc (vec2 ttV) {
             if(ttV.x >= 1.0) { return vec2(0.0,ttV.y); }
        else if(ttV.x <  0.0) { return vec2(1.0,ttV.y); }
        else if(ttV.y >= 1.0) { return vec2(1.0 - ttV.x,1.0); }
        else if(ttV.y <  0.0) { return vec2(1.0 - ttV.x,0.0); }
        else { return ttV; }
    }

    void main () {
        vec3 c = texture2D(uTexture, pbc(vUv)).rgb;
        float br = max(c.r, max(c.g, c.b));
        float rq = clamp(br - curve.x, 0.0, curve.y);
        rq = curve.z * rq * rq;
        c *= max(rq, br - threshold) / max(br, 0.0001);
        gl_FragColor = vec4(c, 0.0);
    }
`);

const bloomBlurShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;

    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;

    vec2 pbv (vec2 ttV, vec2 velo) {
        if(ttV.y >= 1.0 || ttV.y <  0.0) { 
            return vec2(-velo.x,-velo.y);
        }
        else { return velo; }
    }

    vec2 pbc (vec2 ttV) {
             if(ttV.x >= 1.0) { return vec2(0.0,ttV.y); }
        else if(ttV.x <  0.0) { return vec2(1.0,ttV.y); }
        else if(ttV.y >= 1.0) { return vec2(1.0 - ttV.x,1.0); }
        else if(ttV.y <  0.0) { return vec2(1.0 - ttV.x,0.0); }
        else { return ttV; }
    }

    void main () {
        vec4 sum = vec4(0.0);
        sum += texture2D(uTexture, pbc(vL));
        sum += texture2D(uTexture, pbc(vR));
        sum += texture2D(uTexture, pbc(vT));
        sum += texture2D(uTexture, pbc(vB));
        sum *= 0.25;
        gl_FragColor = sum;
    }
`);

const bloomFinalShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;

    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;
    uniform float intensity;

    vec2 pbv (vec2 ttV, vec2 velo) {
        if(ttV.y >= 1.0 || ttV.y <  0.0) { 
            return vec2(-velo.x,-velo.y);
        }
        else { return velo; }
    }

    vec2 pbc (vec2 ttV) {
             if(ttV.x >= 1.0) { return vec2(0.0,ttV.y); }
        else if(ttV.x <  0.0) { return vec2(1.0,ttV.y); }
        else if(ttV.y >= 1.0) { return vec2(1.0 - ttV.x,1.0); }
        else if(ttV.y <  0.0) { return vec2(1.0 - ttV.x,0.0); }
        else { return ttV; }
    }

    void main () {
        vec4 sum = vec4(0.0);
        sum += texture2D(uTexture, pbc(vL));
        sum += texture2D(uTexture, pbc(vR));
        sum += texture2D(uTexture, pbc(vT));
        sum += texture2D(uTexture, pbc(vB));
        sum *= 0.25;
        gl_FragColor = sum * intensity;
    }
`);

const sunraysMaskShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTexture;

    vec2 pbv (vec2 ttV, vec2 velo) {
        if(ttV.y >= 1.0 || ttV.y <  0.0) { 
            return vec2(-velo.x,-velo.y);
        }
        else { return velo; }
    }

    vec2 pbc (vec2 ttV) {
             if(ttV.x >= 1.0) { return vec2(0.0,ttV.y); }
        else if(ttV.x <  0.0) { return vec2(1.0,ttV.y); }
        else if(ttV.y >= 1.0) { return vec2(1.0 - ttV.x,1.0); }
        else if(ttV.y <  0.0) { return vec2(1.0 - ttV.x,0.0); }
        else { return ttV; }
    }

    void main () {
        vec4 c = texture2D(uTexture, pbc(vUv));
        float br = max(c.r, max(c.g, c.b));
        c.a = 1.0 - min(max(br * 20.0, 0.0), 0.8);
        gl_FragColor = c;
    }
`);

const sunraysShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform float weight;

    vec2 pbv (vec2 ttV, vec2 velo) {
        if(ttV.y >= 1.0 || ttV.y <  0.0) { 
            return vec2(-velo.x,-velo.y);
        }
        else { return velo; }
    }

    vec2 pbc (vec2 ttV) {
             if(ttV.x >= 1.0) { return vec2(0.0,ttV.y); }
        else if(ttV.x <  0.0) { return vec2(1.0,ttV.y); }
        else if(ttV.y >= 1.0) { return vec2(1.0 - ttV.x,1.0); }
        else if(ttV.y <  0.0) { return vec2(1.0 - ttV.x,0.0); }
        else { return ttV; }
    }

    #define ITERATIONS 16

    void main () {
        float Density = 0.3;
        float Decay = 0.95;
        float Exposure = 0.7;

        vec2 coord = pbc(vUv);
        vec2 dir = pbc(vUv) - 0.5; // TODO: ISSUE?

        dir *= 1.0 / float(ITERATIONS) * Density;
        float illuminationDecay = 1.0;

        float color = texture2D(uTexture, pbc(vUv)).a;

        for (int i = 0; i < ITERATIONS; i++)
        {
            coord -= dir;
            float col = texture2D(uTexture, pbc(coord)).a;
            color += col * illuminationDecay * weight;
            illuminationDecay *= Decay;
        }

        gl_FragColor = vec4(color * Exposure, 0.0, 0.0, 1.0);
    }
`);

const splatShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTarget;
    uniform float aspectRatio;
    uniform vec3 color;
    uniform vec2 point;
    uniform float radius;

    vec2 pbv (vec2 ttV, vec2 velo) {
        if(ttV.y >= 1.0 || ttV.y <  0.0) { 
            return vec2(-velo.x,-velo.y);
        }
        else { return velo; }
    }

    vec2 pbc (vec2 ttV) {
             if(ttV.x >= 1.0) { return vec2(0.0,ttV.y); }
        else if(ttV.x <  0.0) { return vec2(1.0,ttV.y); }
        else if(ttV.y >= 1.0) { return vec2(1.0 - ttV.x,1.0); }
        else if(ttV.y <  0.0) { return vec2(1.0 - ttV.x,0.0); }
        else { return ttV; }
    }

    void main () {
        vec2 p = vUv - point.xy;
        p.x *= aspectRatio;
        vec3 splat = exp(-dot(p, p) / radius) * color;
        vec3 base = texture2D(uTarget, pbc(vUv)).xyz;
        gl_FragColor = vec4(base + splat, 1.0);
    }
`);

const advectionShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform vec2 texelSize;
    uniform vec2 dyeTexelSize;
    uniform float dt;
    uniform float dissipation;

    vec2 pbv (vec2 ttV, vec2 velo) {
        if(ttV.y >= 1.0 || ttV.y <  0.0) { 
            return vec2(-velo.x,-velo.y);
        }
        else { return velo; }
    }

    vec2 pbc (vec2 ttV) {
             if(ttV.x >= 1.0) { return vec2(0.0,ttV.y); }
        else if(ttV.x <  0.0) { return vec2(1.0,ttV.y); }
        else if(ttV.y >= 1.0) { return vec2(1.0 - ttV.x,1.0); }
        else if(ttV.y <  0.0) { return vec2(1.0 - ttV.x,0.0); }
        else { return ttV; }
    }

    vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
        vec2 st = uv / tsize - 0.5;

        vec2 iuv = floor(st);
        vec2 fuv = fract(st);

        vec2 vBL = (iuv + vec2(0.5, 0.5)) * tsize;
        vec2 vBR = (iuv + vec2(1.5, 0.5)) * tsize;
        vec2 vTR = (iuv + vec2(0.5, 1.5)) * tsize;
        vec2 vTL = (iuv + vec2(1.5, 1.5)) * tsize;

        vec4 a = texture2D(sam, vBL);
        vec4 b = texture2D(sam, vBR);
        vec4 c = texture2D(sam, vTR);
        vec4 d = texture2D(sam, vTL);

        return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
    }

    void main () {
    #ifdef MANUAL_FILTERING
        return;
        vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
        vec4 result = bilerp(uSource, coord, dyeTexelSize);
    #else
        vec2 coord = vUv - dt * pbv(vUv,texture2D(uVelocity, vUv).xy) * texelSize;
        vec4 result = texture2D(uSource, pbc(coord));
    #endif
        float decay = 1.0 + dissipation * dt;
        gl_FragColor = result / decay;
    }`,
    ext.supportLinearFiltering ? null : ['MANUAL_FILTERING']
);

const divergenceShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uVelocity;

    vec2 pbv (vec2 ttV, vec2 velo) {
        if(ttV.y >= 1.0 || ttV.y <  0.0) { 
            return vec2(-velo.x,-velo.y);
        }
        else { return velo; }
    }

    vec2 pbc (vec2 ttV) {
             if(ttV.x >= 1.0) { return vec2(0.0,ttV.y); }
        else if(ttV.x <  0.0) { return vec2(1.0,ttV.y); }
        else if(ttV.y >= 1.0) { return vec2(1.0 - ttV.x,1.0); }
        else if(ttV.y <  0.0) { return vec2(1.0 - ttV.x,0.0); }
        else { return ttV; }
    }

    void main () {
        float L = texture2D(uVelocity, pbc(vL)).x;
        float R = texture2D(uVelocity, pbc(vR)).x;
        float T = texture2D(uVelocity, pbc(vT)).y;
        float B = texture2D(uVelocity, pbc(vB)).y;

        if (vT.y >= 1.0) { 
            T = -T; 
            L = -texture2D(uVelocity, pbc(vR + vT - vUv)).x; 
            R = -texture2D(uVelocity, pbc(vL + vT - vUv)).x;
        }
        if (vB.y < 0.0) { 
            B = -B;
            L = -texture2D(uVelocity, pbc(vR + vB - vUv)).x; 
            R = -texture2D(uVelocity, pbc(vL + vB - vUv)).x; 
        }

        float div = 0.5 * (R - L + T - B);
        gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
    }
`);

const curlShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uVelocity;

    vec2 pbv (vec2 ttV, vec2 velo) {
        if(ttV.y >= 1.0 || ttV.y <  0.0) { 
            return vec2(-velo.x,-velo.y);
        }
        else { return velo; }
    }

    vec2 pbc (vec2 ttV) {
             if(ttV.x >= 1.0) { return vec2(0.0,ttV.y); }
        else if(ttV.x <  0.0) { return vec2(1.0,ttV.y); }
        else if(ttV.y >= 1.0) { return vec2(1.0 - ttV.x,1.0); }
        else if(ttV.y <  0.0) { return vec2(1.0 - ttV.x,0.0); }
        else { return ttV; }
    }

    void main () {
        float L = texture2D(uVelocity, pbc(vL)).y;
        float R = texture2D(uVelocity, pbc(vR)).y;
        float T = texture2D(uVelocity, pbc(vT)).x;
        float B = texture2D(uVelocity, pbc(vB)).x;
        
        if (vT.y >= 1.0) { 
            T = -T; 
            L = -texture2D(uVelocity, pbc(vR + vT - vUv)).y; 
            R = -texture2D(uVelocity, pbc(vL + vT - vUv)).y;
        }
        if (vB.y < 0.0) { 
            B = -B;
            L = -texture2D(uVelocity, pbc(vR + vB - vUv)).y; 
            R = -texture2D(uVelocity, pbc(vL + vB - vUv)).y; 
        }

        float vorticity = R - L - T + B;

        gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
    }
`);

const vorticityShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    precision highp sampler2D;

    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uVelocity;
    uniform sampler2D uCurl;
    uniform float curl;
    uniform float dt;

    vec2 pbv (vec2 ttV, vec2 velo) {
        if(ttV.y >= 1.0 || ttV.y <  0.0) { 
            return vec2(-velo.x,-velo.y);
        }
        else { return velo; }
    }

    vec2 pbc (vec2 ttV) {
             if(ttV.x >= 1.0) { return vec2(0.0,ttV.y); }
        else if(ttV.x <  0.0) { return vec2(1.0,ttV.y); }
        else if(ttV.y >= 1.0) { return vec2(1.0 - ttV.x,1.0); }
        else if(ttV.y <  0.0) { return vec2(1.0 - ttV.x,0.0); }
        else { return ttV; }
    }

    void main () {
        float L = texture2D(uCurl, pbc(vL)).x;
        float R = texture2D(uCurl, pbc(vR)).x;
        float T = texture2D(uCurl, pbc(vT)).x;
        float B = texture2D(uCurl, pbc(vB)).x;
        float C = texture2D(uCurl, pbc(vUv)).x;

        vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
        force /= length(force) + 0.0001;
        force *= curl * C;
        force.y *= -1.0;

        vec2 velocity = texture2D(uVelocity, pbc(vUv)).xy;
        velocity += force * dt;
        velocity = min(max(velocity, -1000.0), 1000.0);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
    }
`);

const pressureShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uDivergence;

    vec2 pbv (vec2 ttV, vec2 velo) {
        if(ttV.y >= 1.0 || ttV.y <  0.0) { 
            return vec2(-velo.x,-velo.y);
        }
        else { return velo; }
    }

    vec2 pbc (vec2 ttV) {
             if(ttV.x >= 1.0) { return vec2(0.0,ttV.y); }
        else if(ttV.x <  0.0) { return vec2(1.0,ttV.y); }
        else if(ttV.y >= 1.0) { return vec2(1.0 - ttV.x,1.0); }
        else if(ttV.y <  0.0) { return vec2(1.0 - ttV.x,0.0); }
        else { return ttV; }
    }

    void main () {
        float L = texture2D(uPressure, pbc(vL)).x;
        float R = texture2D(uPressure, pbc(vR)).x;
        float T = texture2D(uPressure, pbc(vT)).x;
        float B = texture2D(uPressure, pbc(vB)).x;

        if (vT.y >= 1.0) { 
            L = texture2D(uPressure, pbc(vR + vT - vUv)).x; 
            R = texture2D(uPressure, pbc(vL + vT - vUv)).x;
        }
        if (vB.y < 0.0) { 
            L = texture2D(uPressure, pbc(vR + vB - vUv)).x; 
            R = texture2D(uPressure, pbc(vL + vB - vUv)).x; 
        }


        float divergence = texture2D(uDivergence, pbc(vUv)).x;
        float pressure = (L + R + B + T - divergence) * 0.25;
        gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
    }
`);

const gradientSubtractShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uVelocity;

    vec2 pbv (vec2 ttV, vec2 velo) {
        if(ttV.y >= 1.0 || ttV.y <  0.0) { 
            return vec2(-velo.x,-velo.y);
        }
        else { return velo; }
    }

    vec2 pbc (vec2 ttV) {
             if(ttV.x >= 1.0) { return vec2(0.0,ttV.y); }
        else if(ttV.x <  0.0) { return vec2(1.0,ttV.y); }
        else if(ttV.y >= 1.0) { return vec2(1.0 - ttV.x,1.0); }
        else if(ttV.y <  0.0) { return vec2(1.0 - ttV.x,0.0); }
        else { return ttV; }
    }

    void main () {
        float L = texture2D(uPressure, pbc(vL)).x;
        float R = texture2D(uPressure, pbc(vR)).x;
        float T = texture2D(uPressure, pbc(vT)).x;
        float B = texture2D(uPressure, pbc(vB)).x;
        vec2 velocity = pbv(vUv,texture2D(uVelocity, pbc(vUv)).xy);

        if (vT.y >= 1.0) { 
            L = texture2D(uPressure, pbc(vR + vT - vUv)).x; 
            R = texture2D(uPressure, pbc(vL + vT - vUv)).x;
        }
        if (vB.y < 0.0) { 
            L = texture2D(uPressure, pbc(vR + vB - vUv)).x; 
            R = texture2D(uPressure, pbc(vL + vB - vUv)).x; 
        }

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

    return (target, clear = false) => {
        if (target == null)
        {
            gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }
        else
        {
            gl.viewport(0, 0, target.width, target.height);
            gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        }
        if (clear)
        {
            gl.clearColor(0.0, 0.0, 0.0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }
        // CHECK_FRAMEBUFFER_STATUS();
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }
})();

function CHECK_FRAMEBUFFER_STATUS () {
    let status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status != gl.FRAMEBUFFER_COMPLETE)
        console.trace("Framebuffer error: " + status);
}

let dye;
let velocity;
let divergence;
let curl;
let pressure;
let bloom;
let bloomFramebuffers = [];
let sunrays;
let sunraysTemp;

let ditheringTexture = createTextureAsync('scripts/LDR_LLL1_0.png');

const blurProgram            = new Program(blurVertexShader, blurShader);
const copyProgram            = new Program(baseVertexShader, copyShader);
const clearProgram           = new Program(baseVertexShader, clearShader);
const colorProgram           = new Program(baseVertexShader, colorShader);
const checkerboardProgram    = new Program(baseVertexShader, checkerboardShader);
const bloomPrefilterProgram  = new Program(baseVertexShader, bloomPrefilterShader);
const bloomBlurProgram       = new Program(baseVertexShader, bloomBlurShader);
const bloomFinalProgram      = new Program(baseVertexShader, bloomFinalShader);
const sunraysMaskProgram     = new Program(baseVertexShader, sunraysMaskShader);
const sunraysProgram         = new Program(baseVertexShader, sunraysShader);
const splatProgram           = new Program(baseVertexShader, splatShader);
const advectionProgram       = new Program(baseVertexShader, advectionShader);
const divergenceProgram      = new Program(baseVertexShader, divergenceShader);
const curlProgram            = new Program(baseVertexShader, curlShader);
const vorticityProgram       = new Program(baseVertexShader, vorticityShader);
const pressureProgram        = new Program(baseVertexShader, pressureShader);
const gradienSubtractProgram = new Program(baseVertexShader, gradientSubtractShader);

const displayMaterial = new Material(baseVertexShader, displayShaderSource);

function initFramebuffers () {
    let simRes = getResolution(config.SIM_RESOLUTION);
    let dyeRes = getResolution(config.DYE_RESOLUTION);

    const texType = ext.halfFloatTexType;
    const rgba    = ext.formatRGBA;
    const rg      = ext.formatRG;
    const r       = ext.formatR;
    const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

    gl.disable(gl.BLEND);

    if (dye == null)
        dye = createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);
    else
        dye = resizeDoubleFBO(dye, dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);

    if (velocity == null)
        velocity = createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);
    else
        velocity = resizeDoubleFBO(velocity, simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);

    divergence = createFBO      (simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
    curl       = createFBO      (simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
    pressure   = createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);

    initBloomFramebuffers();
    initSunraysFramebuffers();
}

function initBloomFramebuffers () {
    let res = getResolution(config.BLOOM_RESOLUTION);

    const texType = ext.halfFloatTexType;
    const rgba = ext.formatRGBA;
    const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

    bloom = createFBO(res.width, res.height, rgba.internalFormat, rgba.format, texType, filtering);

    bloomFramebuffers.length = 0;
    for (let i = 0; i < config.BLOOM_ITERATIONS; i++)
    {
        let width = res.width >> (i + 1);
        let height = res.height >> (i + 1);

        if (width < 2 || height < 2) break;

        let fbo = createFBO(width, height, rgba.internalFormat, rgba.format, texType, filtering);
        bloomFramebuffers.push(fbo);
    }
}

function initSunraysFramebuffers () {
    let res = getResolution(config.SUNRAYS_RESOLUTION);

    const texType = ext.halfFloatTexType;
    const r = ext.formatR;
    const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

    sunrays     = createFBO(res.width, res.height, r.internalFormat, r.format, texType, filtering);
    sunraysTemp = createFBO(res.width, res.height, r.internalFormat, r.format, texType, filtering);
}

function createFBO (w, h, internalFormat, format, type, param) {
    gl.activeTexture(gl.TEXTURE0);
    let texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

    let fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);

    let texelSizeX = 1.0 / w;
    let texelSizeY = 1.0 / h;

    return {
        texture,
        fbo,
        width: w,
        height: h,
        texelSizeX,
        texelSizeY,
        attach (id) {
            gl.activeTexture(gl.TEXTURE0 + id);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            return id;
        }
    };
}

function createDoubleFBO (w, h, internalFormat, format, type, param) {
    let fbo1 = createFBO(w, h, internalFormat, format, type, param);
    let fbo2 = createFBO(w, h, internalFormat, format, type, param);

    return {
        width: w,
        height: h,
        texelSizeX: fbo1.texelSizeX,
        texelSizeY: fbo1.texelSizeY,
        get read () {
            return fbo1;
        },
        set read (value) {
            fbo1 = value;
        },
        get write () {
            return fbo2;
        },
        set write (value) {
            fbo2 = value;
        },
        swap () {
            let temp = fbo1;
            fbo1 = fbo2;
            fbo2 = temp;
        }
    }
}

function resizeFBO (target, w, h, internalFormat, format, type, param) {
    let newFBO = createFBO(w, h, internalFormat, format, type, param);
    copyProgram.bind();
    gl.uniform1i(copyProgram.uniforms.uTexture, target.attach(0));
    blit(newFBO);
    return newFBO;
}

function resizeDoubleFBO (target, w, h, internalFormat, format, type, param) {
    if (target.width == w && target.height == h)
        return target;
    target.read = resizeFBO(target.read, w, h, internalFormat, format, type, param);
    target.write = createFBO(w, h, internalFormat, format, type, param);
    target.width = w;
    target.height = h;
    target.texelSizeX = 1.0 / w;
    target.texelSizeY = 1.0 / h;
    return target;
}

function createTextureAsync (url) {
    let texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255]));

    let obj = {
        texture,
        width: 1,
        height: 1,
        attach (id) {
            gl.activeTexture(gl.TEXTURE0 + id);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            return id;
        }
    };

    let image = new Image();
    image.onload = () => {
        obj.width = image.width;
        obj.height = image.height;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
    };
    image.src = url;

    return obj;
}

function updateKeywords () {
    let displayKeywords = [];
    if (config.SHADING) displayKeywords.push("SHADING");
    if (config.BLOOM) displayKeywords.push("BLOOM");
    if (config.SUNRAYS) displayKeywords.push("SUNRAYS");
    displayMaterial.setKeywords(displayKeywords);
}

updateKeywords();
initFramebuffers();
multipleSplats(parseInt(Math.random() * 20) + 5);

let lastUpdateTime = Date.now();
let colorUpdateTimer = 0.0;
let autoSplatTime = 0.0;
let autoScreenCaptureTime = 0.0;
let autoScreenCapNum = 1;
update();

function update () {
    const dt = calcDeltaTime();
    if (resizeCanvas())
        initFramebuffers();

    if (config.COLLECT_DATA)
        collectData(dt);

    updateColors(dt);
    applyInputs();
    if (!config.PAUSED)
        step(dt);
    render(null);
    requestAnimationFrame(update);
}

function calcDeltaTime () {
    let now = Date.now();
    let dt = (now - lastUpdateTime) / 1000;
    dt = Math.min(dt, 0.016666);
    lastUpdateTime = now;
    return dt;
}

function resizeCanvas () {
    let width = scaleByPixelRatio(canvas.clientWidth);
    let height = scaleByPixelRatio(canvas.clientHeight);
    if (canvas.width != width || canvas.height != height) {
        canvas.width = width;
        canvas.height = height;
        return true;
    }
    return false;
}

function updateColors (dt) {
    if (!config.COLORFUL) {
        pointers.forEach(p => {
            let c = HSVtoRGB(Math.random(), 1.0, 1.0);
            c.r = 1;
            c.g = 1;
            c.b = 1;
            p.color = c;
        });
        return;
    } 

    colorUpdateTimer += dt * config.COLOR_UPDATE_SPEED;
    if (colorUpdateTimer >= 1) {
        colorUpdateTimer = wrap(colorUpdateTimer, 0, 1);
        pointers.forEach(p => {
            p.color = generateColor();
        });
    }
}


let screenCapPaused = false;
function collectData (dt) {
    autoSplatTime += dt;
    autoScreenCaptureTime += dt*!screenCapPaused;

    //every XX seconds, inject energy
    if(autoSplatTime > config.AUTO_SPLAT_TIME) {
        multipleSplats(parseInt(Math.random() * 20) + 5);
        autoSplatTime = 0.0;
    }

    //every XX seconds, capture screenshot
    if(autoScreenCaptureTime > config.AUTO_SCREEN_CAP_TIME && !screenCapPaused) {
        //pause simulation
        config.PAUSED = true;
        screenCapPaused = true;

        let tExt = autoScreenCapNum+".png";

        //save image 
        let res = getResolution(config.CAPTURE_RESOLUTION);
        let target = createFBO(res.width, res.height, ext.formatRGBA.internalFormat, ext.formatRGBA.format, ext.halfFloatTexType, gl.NEAREST);
        render(target);
    
        let texture = framebufferToTexture(target);
        texture = normalizeTexture(texture, target.width, target.height);
    
        let captureCanvas = textureToCanvas(texture, target.width, target.height);
        captureCanvas.toBlob(function(blob) {
            saveAs(blob, config.DATA_TITLE+"_"+tExt);
        });

        //same for velocity;
        saveDoubleFBOCapture(velocity,config.DATA_TITLE+"_v_"+tExt)

        //same for pressure;
        saveDoubleFBOCapture(pressure,config.DATA_TITLE+"_p_"+tExt)

        //different for divergence, which is a single FBO;
        saveSingleFBOCapture(divergence,config.DATA_TITLE+"_d_"+tExt)

        //different for curl, which is a single FBO;
        saveSingleFBOCapture(curl,config.DATA_TITLE+"_c_"+tExt)

        config.PAUSED = false;
        screenCapPaused = false;
        autoScreenCaptureTime = 0.0;
        autoScreenCapNum++;
    }

}

function saveDoubleFBOCapture(dubFBO, saveName) {
    let target = dubFBO.write
    render(target,dubFBO.read)
    let texture = framebufferToTexture(target);
    texture = normalizeTexture1000(texture, target.width, target.height);

    let captureCanvas = textureToCanvas(texture, target.width, target.height);
    captureCanvas.toBlob(function(blob) {
        saveAs(blob, saveName);
    });
}

function saveSingleFBOCapture(sinFBO, saveName) {
    let texture = framebufferToTexture(sinFBO);
    texture = normalizeTexture1000(texture, sinFBO.width, sinFBO.height);
    
    let captureCanvas = textureToCanvas(texture, sinFBO.width, sinFBO.height);
    captureCanvas.toBlob(function(blob) {
        saveAs(blob, saveName);
    });
}

function applyInputs () {
    if (splatStack.length > 0)
        multipleSplats(splatStack.pop());

    pointers.forEach(p => {
        if (p.moved) {
            p.moved = false;
            splatPointer(p);
        }
    });
}

function step (dt) {
    gl.disable(gl.BLEND);

    curlProgram.bind();
    gl.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(curl);

    vorticityProgram.bind();
    gl.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(vorticityProgram.uniforms.uCurl, curl.attach(1));
    gl.uniform1f(vorticityProgram.uniforms.curl, config.CURL);
    gl.uniform1f(vorticityProgram.uniforms.dt, dt);
    blit(velocity.write);
    velocity.swap();

    divergenceProgram.bind();
    gl.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(divergence);

    clearProgram.bind();
    gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0));
    gl.uniform1f(clearProgram.uniforms.value, config.PRESSURE);
    blit(pressure.write);
    pressure.swap();

    pressureProgram.bind();
    gl.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0));
    for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
        gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1));
        blit(pressure.write);
        pressure.swap();
    }

    gradienSubtractProgram.bind();
    gl.uniform2f(gradienSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(gradienSubtractProgram.uniforms.uPressure, pressure.read.attach(0));
    gl.uniform1i(gradienSubtractProgram.uniforms.uVelocity, velocity.read.attach(1));
    blit(velocity.write);
    velocity.swap();

    advectionProgram.bind();
    gl.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    if (!ext.supportLinearFiltering)
        gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    let velocityId = velocity.read.attach(0);
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocityId);
    gl.uniform1i(advectionProgram.uniforms.uSource, velocityId);
    gl.uniform1f(advectionProgram.uniforms.dt, dt);
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.VELOCITY_DISSIPATION);
    blit(velocity.write);
    velocity.swap();

    if (!ext.supportLinearFiltering)
        gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1));
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.DENSITY_DISSIPATION);
    blit(dye.write);
    dye.swap();
}

function render (target, vecs=dye.read) {
    if(vecs == dye.read) {
        if (config.BLOOM)
            applyBloom(dye.read, bloom);
        if (config.SUNRAYS) {
            applySunrays(dye.read, dye.write, sunrays);
            blur(sunrays, sunraysTemp, 1);
        }
    }

    if (target == null || !config.TRANSPARENT) {
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.enable(gl.BLEND);
    }
    else {
        gl.disable(gl.BLEND);
    }

    if (!config.TRANSPARENT)
        if(vecs == dye.read) { drawColor(target, normalizeColor(config.BACK_COLOR)); }
        else                 { drawColor(target, normalizeColor({r: 0, g: 0, b: 0})); }
    if (target == null && config.TRANSPARENT)
        drawCheckerboard(target);
        //EAC drawImage
    drawDisplay(target, vecs);
}

function drawImage (target,color) {
    colorProgram.bind();
    gl.uniform4f(colorProgram.uniforms.color, color.r, color.g, color.b, 1);
    blit(target);
}

function drawColor (target, color) {
    colorProgram.bind();
    gl.uniform4f(colorProgram.uniforms.color, color.r, color.g, color.b, 1);
    blit(target);
}

function drawCheckerboard (target) {
    checkerboardProgram.bind();
    gl.uniform1f(checkerboardProgram.uniforms.aspectRatio, canvas.width / canvas.height);
    blit(target);
}

function drawDisplay (target, vecs=dye.read) {
    let width = target == null ? gl.drawingBufferWidth : target.width;
    let height = target == null ? gl.drawingBufferHeight : target.height;

    displayMaterial.bind();
    if (config.SHADING && vecs == dye.read)
        gl.uniform2f(displayMaterial.uniforms.texelSize, 1.0 / width, 1.0 / height);

    gl.uniform1i(displayMaterial.uniforms.uTexture, vecs.attach(0));
    
    if (config.BLOOM && vecs == dye.read) {
        gl.uniform1i(displayMaterial.uniforms.uBloom, bloom.attach(1));
        gl.uniform1i(displayMaterial.uniforms.uDithering, ditheringTexture.attach(2));
        let scale = getTextureScale(ditheringTexture, width, height);
        gl.uniform2f(displayMaterial.uniforms.ditherScale, scale.x, scale.y);
    }
    
    if (config.SUNRAYS && vecs == dye.read)
        gl.uniform1i(displayMaterial.uniforms.uSunrays, sunrays.attach(3));
    
    blit(target);
}

function applyBloom (source, destination) {
    if (bloomFramebuffers.length < 2)
        return;

    let last = destination;

    gl.disable(gl.BLEND);
    bloomPrefilterProgram.bind();
    let knee = config.BLOOM_THRESHOLD * config.BLOOM_SOFT_KNEE + 0.0001;
    let curve0 = config.BLOOM_THRESHOLD - knee;
    let curve1 = knee * 2;
    let curve2 = 0.25 / knee;
    gl.uniform3f(bloomPrefilterProgram.uniforms.curve, curve0, curve1, curve2);
    gl.uniform1f(bloomPrefilterProgram.uniforms.threshold, config.BLOOM_THRESHOLD);
    gl.uniform1i(bloomPrefilterProgram.uniforms.uTexture, source.attach(0));
    blit(last);

    bloomBlurProgram.bind();
    for (let i = 0; i < bloomFramebuffers.length; i++) {
        let dest = bloomFramebuffers[i];
        gl.uniform2f(bloomBlurProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
        gl.uniform1i(bloomBlurProgram.uniforms.uTexture, last.attach(0));
        blit(dest);
        last = dest;
    }

    gl.blendFunc(gl.ONE, gl.ONE);
    gl.enable(gl.BLEND);

    for (let i = bloomFramebuffers.length - 2; i >= 0; i--) {
        let baseTex = bloomFramebuffers[i];
        gl.uniform2f(bloomBlurProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
        gl.uniform1i(bloomBlurProgram.uniforms.uTexture, last.attach(0));
        gl.viewport(0, 0, baseTex.width, baseTex.height);
        blit(baseTex);
        last = baseTex;
    }

    gl.disable(gl.BLEND);
    bloomFinalProgram.bind();
    gl.uniform2f(bloomFinalProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
    gl.uniform1i(bloomFinalProgram.uniforms.uTexture, last.attach(0));
    gl.uniform1f(bloomFinalProgram.uniforms.intensity, config.BLOOM_INTENSITY);
    blit(destination);
}

function applySunrays (source, mask, destination) {
    gl.disable(gl.BLEND);
    sunraysMaskProgram.bind();
    gl.uniform1i(sunraysMaskProgram.uniforms.uTexture, source.attach(0));
    blit(mask);

    sunraysProgram.bind();
    gl.uniform1f(sunraysProgram.uniforms.weight, config.SUNRAYS_WEIGHT);
    gl.uniform1i(sunraysProgram.uniforms.uTexture, mask.attach(0));
    blit(destination);
}

function blur (target, temp, iterations) {
    blurProgram.bind();
    for (let i = 0; i < iterations; i++) {
        gl.uniform2f(blurProgram.uniforms.texelSize, target.texelSizeX, 0.0);
        gl.uniform1i(blurProgram.uniforms.uTexture, target.attach(0));
        blit(temp);

        gl.uniform2f(blurProgram.uniforms.texelSize, 0.0, target.texelSizeY);
        gl.uniform1i(blurProgram.uniforms.uTexture, temp.attach(0));
        blit(target);
    }
}

function splatPointer (pointer) {
    let dx = pointer.deltaX * config.SPLAT_FORCE;
    let dy = pointer.deltaY * config.SPLAT_FORCE;
    splat(pointer.texcoordX, pointer.texcoordY, dx, dy, pointer.color);
}

function multipleSplats (amount) {
    for (let i = 0; i < amount; i++) {
        const color = generateColor();
        color.r *= 10.0;
        color.g *= 10.0;
        color.b *= 10.0;
        const x = Math.random();
        const y = Math.random();
        const dx = 1000 * (Math.random() - 0.5);
        const dy = 1000 * (Math.random() - 0.5);
        if(!config.COLORFUL) { color.r = 1; color.g = 1; color.b=1;}
        splat(x, y, dx, dy, color);
    }
}

function splat (x, y, dx, dy, color) {
    splatProgram.bind();
    gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
    gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height);
    gl.uniform2f(splatProgram.uniforms.point, x, y);
    gl.uniform3f(splatProgram.uniforms.color, dx, dy, 0.0);
    gl.uniform1f(splatProgram.uniforms.radius, correctRadius(config.SPLAT_RADIUS / 100.0));
    blit(velocity.write);
    velocity.swap();

    gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0));
    gl.uniform3f(splatProgram.uniforms.color, color.r, color.g, color.b);
    blit(dye.write);
    dye.swap();
}

function correctRadius (radius) {
    let aspectRatio = canvas.width / canvas.height;
    if (aspectRatio > 1)
        radius *= aspectRatio;
    return radius;
}

canvas.addEventListener('mousedown', e => {
    let posX = scaleByPixelRatio(e.offsetX);
    let posY = scaleByPixelRatio(e.offsetY);
    let pointer = pointers.find(p => p.id == -1);
    if (pointer == null)
        pointer = new pointerPrototype();
    updatePointerDownData(pointer, -1, posX, posY);
});

canvas.addEventListener('mousemove', e => {
    let pointer = pointers[0];
    if (!pointer.down) return;
    let posX = scaleByPixelRatio(e.offsetX);
    let posY = scaleByPixelRatio(e.offsetY);
    updatePointerMoveData(pointer, posX, posY);
});

window.addEventListener('mouseup', () => {
    updatePointerUpData(pointers[0]);
});

canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    const touches = e.targetTouches;
    while (touches.length >= pointers.length)
        pointers.push(new pointerPrototype());
    for (let i = 0; i < touches.length; i++) {
        let posX = scaleByPixelRatio(touches[i].pageX);
        let posY = scaleByPixelRatio(touches[i].pageY);
        updatePointerDownData(pointers[i + 1], touches[i].identifier, posX, posY);
    }
});

canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    const touches = e.targetTouches;
    for (let i = 0; i < touches.length; i++) {
        let pointer = pointers[i + 1];
        if (!pointer.down) continue;
        let posX = scaleByPixelRatio(touches[i].pageX);
        let posY = scaleByPixelRatio(touches[i].pageY);
        updatePointerMoveData(pointer, posX, posY);
    }
}, false);

window.addEventListener('touchend', e => {
    const touches = e.changedTouches;
    for (let i = 0; i < touches.length; i++)
    {
        let pointer = pointers.find(p => p.id == touches[i].identifier);
        if (pointer == null) continue;
        updatePointerUpData(pointer);
    }
});

window.addEventListener('keydown', e => {
    if (e.code === 'KeyP')
        config.PAUSED = !config.PAUSED;
    if (e.key === ' ')
        splatStack.push(parseInt(Math.random() * 20) + 5);
});

function updatePointerDownData (pointer, id, posX, posY) {
    pointer.id = id;
    pointer.down = true;
    pointer.moved = false;
    pointer.texcoordX = posX / canvas.width;
    pointer.texcoordY = 1.0 - posY / canvas.height;
    pointer.prevTexcoordX = pointer.texcoordX;
    pointer.prevTexcoordY = pointer.texcoordY;
    pointer.deltaX = 0;
    pointer.deltaY = 0;
    pointer.color = generateColor();
}

function updatePointerMoveData (pointer, posX, posY) {
    pointer.prevTexcoordX = pointer.texcoordX;
    pointer.prevTexcoordY = pointer.texcoordY;
    pointer.texcoordX = posX / canvas.width;
    pointer.texcoordY = 1.0 - posY / canvas.height;
    pointer.deltaX = correctDeltaX(pointer.texcoordX - pointer.prevTexcoordX);
    pointer.deltaY = correctDeltaY(pointer.texcoordY - pointer.prevTexcoordY);
    pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0;
}

function updatePointerUpData (pointer) {
    pointer.down = false;
}

function correctDeltaX (delta) {
    let aspectRatio = canvas.width / canvas.height;
    if (aspectRatio < 1) delta *= aspectRatio;
    return delta;
}

function correctDeltaY (delta) {
    let aspectRatio = canvas.width / canvas.height;
    if (aspectRatio > 1) delta /= aspectRatio;
    return delta;
}

function generateColor () {
    let c = HSVtoRGB(Math.random(), 1.0, 1.0);
    c.r *= 0.15;
    c.g *= 0.15;
    c.b *= 0.15;
    return c;
}

function HSVtoRGB (h, s, v) {
    let r, g, b, i, f, p, q, t;
    i = Math.floor(h * 6);
    f = h * 6 - i;
    p = v * (1 - s);
    q = v * (1 - f * s);
    t = v * (1 - (1 - f) * s);

    switch (i % 6) {
        case 0: r = v, g = t, b = p; break;
        case 1: r = q, g = v, b = p; break;
        case 2: r = p, g = v, b = t; break;
        case 3: r = p, g = q, b = v; break;
        case 4: r = t, g = p, b = v; break;
        case 5: r = v, g = p, b = q; break;
    }

    return {
        r,
        g,
        b
    };
}

function normalizeColor (input) {
    let output = {
        r: input.r / 255,
        g: input.g / 255,
        b: input.b / 255
    };
    return output;
}

function wrap (value, min, max) {
    let range = max - min;
    if (range == 0) return min;
    return (value - min) % range + min;
}

function getResolution (resolution) {
    let aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
    if (aspectRatio < 1)
        aspectRatio = 1.0 / aspectRatio;

    let min = Math.round(resolution);
    let max = Math.round(resolution * aspectRatio);

    if (gl.drawingBufferWidth > gl.drawingBufferHeight)
        return { width: max, height: min };
    else
        return { width: min, height: max };
}

function getTextureScale (texture, width, height) {
    return {
        x: width / texture.width,
        y: height / texture.height
    };
}

function scaleByPixelRatio (input) {
    let pixelRatio = window.devicePixelRatio || 1;
    return Math.floor(input * pixelRatio);
}

function hashCode (s) {
    if (s.length == 0) return 0;
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
        hash = (hash << 5) - hash + s.charCodeAt(i);
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
};