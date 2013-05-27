var canvas;
var messageBox;

var gl;

// Objects holding data for individual shader programs
var splashProgram = {};      // Renders an initial splash to the previous and current texture
var simulationProgram = {};  // Renders the texture for the next time step based on the last two
var screenProgram = {};      // Displays the current texture on screen

// Textures
// We will use three textures, whose roles will be shifted circularly every frame
// One texture is the one we are currently rendering to (and subsequently displaying)
// One texture is the one that is currently displayed and was rendered last frame
// One texture is the one that was displayed last frame and rendered two frames ago
// (We need to remember two previous frames in order to apply our finite difference scheme, as the wave equation is of second order in time)
var textures = [];
var rttFramebuffers = []; // Render to texture memory (this will store 3 framebuffers corresponding to the three textures)
var resolution = 512;

var previousTexture; // Points to the texture from two frames ago, so that we only ever need to add to this value (makes module maths simpler)

// Timing
// We need these to fix the framerate
var fps = 60;
var interval = 1000/fps;
var lastTime;

// Simulation parameters
var dT = 1/fps; // Time step, in seconds
var c = 40;     // Wave propagation speed, in texels per second

// Splash parameters
var width = 40;
var r = 40;

window.onload = init;

function CheckError(msg)
{
    var error = gl.getError();
    if (error != 0)
    {
        var errMsg = "OpenGL error: " + error.toString(16);
        if (msg) { errMsg = msg + "</br>" + errMsg; }
        messageBox.innerHTML = errMsg;
    }
}

function InitTextureFramebuffers()
{
    for(var i = 0; i <= 2; i++)
    {
        rttFramebuffers[i] = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, rttFramebuffers[i]);
        rttFramebuffers[i].width = resolution;  // these is not actually a property used by WebGL, but we'll store it here for later convenience
        rttFramebuffers[i].height = resolution; // ...
        
        textures[i] = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, textures[i]);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, rttFramebuffers[i].width, rttFramebuffers[i].height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        
        gl.generateMipmap(gl.TEXTURE_2D);
        
        var renderbuffer = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, rttFramebuffers[i].width, rttFramebuffers[i].height);
        
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textures[i], 0);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, renderbuffer);
        
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindRenderbuffer(gl.RENDERBUFFER, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
}

function InitShaders(gl, vertexShaderId, fragmentShaderId)
{
    var vertexShader;
    var fragmentShader;
    
    var vertexElement = document.getElementById(vertexShaderId);
    if(!vertexElement)
    {
        messageBox.innerHTML = "Unable to load vertex shader '" + vertexShaderId;
        return -1;
    }
    else
    {
        vertexShader = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vertexShader, vertexElement.text);
        gl.compileShader(vertexShader);
        if(!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS))
        {
            messageBox.innerHTML = "Vertex shader failed to compile. The error log is:</br>" + gl.getShaderInfoLog(vertexShader);
            return -1;
        }
    }
    
    var fragmentElement = document.getElementById(fragmentShaderId);
    if(!fragmentElement)
    {
        messageBox.innerHTML = "Unable to load fragment shader '" + fragmenthaderId;
        return -1;
    }
    else
    {
        fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fragmentShader, fragmentElement.text);
        gl.compileShader(fragmentShader);
        if(!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS))
        {
            messageBox.innerHTML = "Fragment shader failed to compile. The error log is:</br>" + gl.getShaderInfoLog(fragmentShader);
            return -1;
        }
    }
    
    var program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    
    if(!gl.getProgramParameter(program, gl.LINK_STATUS))
    {
        messageBox.innerHTML = "Shader program failed to link. The error log is:</br>" + gl.getProgramInfoLog(program);
        return -1;
    }
    
    return program;
}

function init()
{
    canvas = document.getElementById("gl-canvas");
    var computedWidth = window.getComputedStyle(canvas, null).getPropertyValue("width");
    // This is the actual extent of the canvas on the page
    canvas.style.height = computedWidth;
    canvas.style.width = computedWidth;
    // This is the resolution of the canvas (which will be scaled to the extent, using some rather primitive anti-aliasing techniques)
    canvas.height = parseInt(computedWidth);
    canvas.width = parseInt(computedWidth);
    
    messageBox = document.getElementById("message");
    
    gl = WebGLUtils.setupWebGL(canvas);
    if (!gl) {
        messageBox.innerHTML = "WebGL is not available!";
    } else {
        messageBox.innerHTML = "WebGL up and running!";
    }
    messageBox.style.visibility = "visible";
    
    gl.clearColor(1.0, 1.0, 0.0, 1.0);
    
    // Load shaders and get uniform locations
    splashProgram.program = InitShaders(gl, "splash-vertex-shader", "splash-fragment-shader");
    splashProgram.uCenter = gl.getUniformLocation(splashProgram.program, "uCenter");
    splashProgram.uR = gl.getUniformLocation(splashProgram.program, "uR");
    splashProgram.uWidth = gl.getUniformLocation(splashProgram.program, "uWidth");
    splashProgram.uResolution = gl.getUniformLocation(splashProgram.program, "uResolution");
    splashProgram.aPos = gl.getAttribLocation(splashProgram.program, "aPos");
    splashProgram.aTexCoord = gl.getAttribLocation(splashProgram.program, "aTexCoord");
    
    gl.useProgram(splashProgram.program);
    gl.uniform1f(splashProgram.uWidth, width);
    gl.uniform1i(splashProgram.uResolution, resolution);
    
    simulationProgram.program = InitShaders(gl, "simulation-vertex-shader", "simulation-fragment-shader");    
    simulationProgram.uPreviousTexture = gl.getUniformLocation(simulationProgram.program, "uPreviousTexture");
    simulationProgram.uCurrentTexture = gl.getUniformLocation(simulationProgram.program, "uCurrentTexture");
    simulationProgram.uDT = gl.getUniformLocation(simulationProgram.program, "uDT");
    simulationProgram.uDS = gl.getUniformLocation(simulationProgram.program, "uDS");
    simulationProgram.uC = gl.getUniformLocation(simulationProgram.program, "uC");
    simulationProgram.uResolution = gl.getUniformLocation(simulationProgram.program, "uResolution");
    simulationProgram.aPos = gl.getAttribLocation(simulationProgram.program, "aPos");
    simulationProgram.aTexCoord = gl.getAttribLocation(simulationProgram.program, "aTexCoord");
    
    gl.useProgram(simulationProgram.program);
    gl.uniform1i(simulationProgram.uPreviousTexture, 0);
    gl.uniform1i(simulationProgram.uCurrentTexture, 1);
    gl.uniform1f(simulationProgram.uDT, dT);
    gl.uniform1i(simulationProgram.uC, c);
    gl.uniform1i(simulationProgram.uResolution, resolution);
    
    screenProgram.program = InitShaders(gl, "screen-vertex-shader", "screen-fragment-shader");    
    screenProgram.uTexture = gl.getUniformLocation(screenProgram.program, "uTexture");
    screenProgram.aPos = gl.getAttribLocation(screenProgram.program, "aPos");
    screenProgram.aTexCoord = gl.getAttribLocation(screenProgram.program, "aTexCoord");
    
    gl.useProgram(screenProgram.program);
    gl.uniform1i(screenProgram.uTexture, 0);
    
    gl.useProgram(null);
    
    // Initialize attribute buffers
    var vertices = {};
    vertices.data = new Float32Array(
        [
            -1.0, -1.0,
             1.0, -1.0,
             1.0,  1.0,
            -1.0,  1.0
        ]);
        
    vertices.bufferId = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices.bufferId);
    gl.bufferData(gl.ARRAY_BUFFER, vertices.data, gl.STATIC_DRAW);
    gl.vertexAttribPointer(splashProgram.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(splashProgram.aPos);
    gl.vertexAttribPointer(simulationProgram.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(simulationProgram.aPos);
    gl.vertexAttribPointer(screenProgram.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(screenProgram.aPos);
    
    var texCoords = {};
    texCoords.data = new Float32Array(
        [
            0.0, 0.0,
            1.0, 0.0,
            1.0, 1.0,
            0.0, 1.0
        ]);
        
    texCoords.bufferId = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoords.bufferId);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords.data, gl.STATIC_DRAW);
    gl.vertexAttribPointer(splashProgram.aTexCoord, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(splashProgram.aTexCoord);
    gl.vertexAttribPointer(simulationProgram.aTexCoord, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(simulationProgram.aTexCoord);
    gl.vertexAttribPointer(screenProgram.aTexCoord, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(screenProgram.aTexCoord);
    
    // Initialize texture
    /*var previousImage = new Image();
    var currentImage = new Image();
    var imagesLoaded = 0;
    var imageCallback = function() {
        imagesLoaded++;
        if (imagesLoaded == 2)
        {
        }
    }
    
    previousImage.onload = imageCallback;
    previousImage.src = "baseTexture-1.png";
    currentImage.onload = imageCallback;
    currentImage.src = "baseTexture-2.png";*/
    
    InitTextureFramebuffers();
    previousTexture = 0;
    prepareScene();
    lastTime = Date.now();
    render();
}

function prepareScene()
{
    gl.viewport(0, 0, resolution, resolution);
    gl.useProgram(splashProgram.program);
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, rttFramebuffers[previousTexture]);
    
    gl.uniform1f(splashProgram.uR, r);
    gl.uniform2f(splashProgram.uCenter, 0.5, 0.5);
    
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, rttFramebuffers[(previousTexture + 1) % 3]);
    
    gl.uniform1f(splashProgram.uR, r + c*dT);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    
    gl.bindTexture(gl.TEXTURE_2D, textures[previousTexture]);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, textures[(previousTexture + 1) % 3]);
    gl.generateMipmap(gl.TEXTURE_2D);
}

function drawNewTexture()
{
    gl.useProgram(simulationProgram.program);
    
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, textures[previousTexture]);
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, textures[(previousTexture + 1) % 3]);
    
    gl.viewport(0, 0, resolution, resolution);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
}

function drawScreen()
{
    gl.useProgram(screenProgram.program);

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, textures[(previousTexture + 2) % 3]);
    gl.generateMipmap(gl.TEXTURE_2D);
    
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
}

function render()
{
    window.requestAnimFrame(render, canvas);
    
    currentTime = Date.now();
    var dTime = currentTime - lastTime;
    
    if (dTime > interval)
    {
        lastTime = currentTime - (dTime % interval);
        
        gl.bindFramebuffer(gl.FRAMEBUFFER, rttFramebuffers[(previousTexture + 2) % 3]);
        drawNewTexture();
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        
        drawScreen();
        
        previousTexture = (previousTexture + 1) % 3;
    }
}