// @flow

import DepthMode from '../gl/depth_mode.js';
import StencilMode from '../gl/stencil_mode.js';
import CullFaceMode from '../gl/cull_face_mode.js';
import {debugUniformValues} from './program/debug_program.js';
import Color from '../style-spec/util/color.js';
import ColorMode from '../gl/color_mode.js';
import browser from '../util/browser.js';
import window from '../util/window.js';
import {globeDenormalizeECEF, transitionTileAABBinECEF, globeToMercatorTransition, aabbForTileOnGlobe} from '../geo/projection/globe_util.js';
import {mat4, vec3} from 'gl-matrix';

import type Painter from './painter.js';
import type SourceCache from '../source/source_cache.js';
import type {OverscaledTileID} from '../source/tile_id.js';
import type {Vec2, Vec3} from 'gl-matrix';
import type Transform from '../geo/transform.js';

import assert from 'assert';

const topColor = new Color(1, 0, 0, 1);
const btmColor = new Color(0, 1, 0, 1);
const leftColor = new Color(0, 0, 1, 1);
const rightColor = new Color(1, 0, 1, 1);
const centerColor = new Color(0, 1, 1, 1);

export default function drawDebug(painter: Painter, sourceCache: SourceCache, coords: Array<OverscaledTileID>) {
    for (let i = 0; i < coords.length; i++) {
        drawDebugTile(painter, sourceCache, coords[i]);
    }
}

export function drawDebugPadding(painter: Painter) {
    const padding = painter.transform.padding;
    const lineWidth = 3;
    // Top
    drawHorizontalLine(painter, painter.transform.height - (padding.top || 0), lineWidth, topColor);
    // Bottom
    drawHorizontalLine(painter, padding.bottom || 0, lineWidth, btmColor);
    // Left
    drawVerticalLine(painter, padding.left || 0, lineWidth, leftColor);
    // Right
    drawVerticalLine(painter, painter.transform.width - (padding.right || 0), lineWidth, rightColor);
    // Center
    const center = painter.transform.centerPoint;
    drawCrosshair(painter, center.x, painter.transform.height - center.y, centerColor);
}

export function drawDebugQueryGeometry(painter: Painter, sourceCache: SourceCache, coords: Array<OverscaledTileID>) {
    for (let i = 0; i < coords.length; i++) {
        drawTileQueryGeometry(painter, sourceCache, coords[i]);
    }
}

function drawDebugTile(painter: Painter, sourceCache: SourceCache, coord: OverscaledTileID) {
    const context = painter.context;
    const tr = painter.transform;
    const gl = context.gl;

    const isGlobeProjection = tr.projection.name === 'globe';
    const definesValues = isGlobeProjection ? ['PROJECTION_GLOBE_VIEW'] : null;

    let posMatrix = coord.projMatrix;

    if (isGlobeProjection && globeToMercatorTransition(tr.zoom) > 0) {
        // We use a custom tile matrix here in order to handle the globe-to-mercator transition
        // the following is equivalent to transform.calculatePosMatrix,
        // except we use transitionTileAABBinECEF instead of globeTileBounds to account for the transition.
        const bounds = transitionTileAABBinECEF(coord.canonical, tr);
        const decode = globeDenormalizeECEF(bounds);
        posMatrix = mat4.multiply(new Float32Array(16), tr.globeMatrix, decode);
        mat4.multiply(posMatrix, tr.projMatrix, posMatrix);
    }

    const program = painter.useProgram('debug', null, definesValues);
    const tile = sourceCache.getTileByID(coord.key);
    if (painter.terrain) painter.terrain.setupElevationDraw(tile, program);

    const depthMode = DepthMode.disabled;
    const stencilMode = StencilMode.disabled;
    const colorMode = painter.colorModeForRenderPass();
    const id = '$debug';

    context.activeTexture.set(gl.TEXTURE0);
    // Bind the empty texture for drawing outlines
    painter.emptyTexture.bind(gl.LINEAR, gl.CLAMP_TO_EDGE);

    if (isGlobeProjection) {
        tile._makeGlobeTileDebugBuffers(painter.context, tr);
    } else {
        tile._makeDebugTileBoundsBuffers(painter.context, tr.projection);
    }

    const debugBuffer = tile._tileDebugBuffer || painter.debugBuffer;
    const debugIndexBuffer = tile._tileDebugIndexBuffer || painter.debugIndexBuffer;
    const debugSegments = tile._tileDebugSegments || painter.debugSegments;

    program.draw(context, gl.LINE_STRIP, depthMode, stencilMode, colorMode, CullFaceMode.disabled,
        debugUniformValues(posMatrix, Color.red), id,
        debugBuffer, debugIndexBuffer, debugSegments,
        null, null, null, [tile._globeTileDebugBorderBuffer]);

    const tileRawData = tile.latestRawTileData;
    const tileByteLength = (tileRawData && tileRawData.byteLength) || 0;
    const tileSizeKb = Math.floor(tileByteLength / 1024);
    const tileSize = sourceCache.getTile(coord).tileSize;
    const scaleRatio = (512 / Math.min(tileSize, 512) * (coord.overscaledZ / tr.zoom)) * 0.5;
    let tileLabel = coord.canonical.toString();
    if (coord.overscaledZ !== coord.canonical.z) {
        tileLabel += ` => ${coord.overscaledZ}`;
    }
    tileLabel += ` ${tileSizeKb}kb`;
    drawTextToOverlay(painter, tileLabel);

    const debugTextBuffer = tile._tileDebugTextBuffer || painter.debugBuffer;
    const debugTextIndexBuffer = tile._tileDebugTextIndexBuffer || painter.quadTriangleIndexBuffer;
    const debugTextSegments = tile._tileDebugTextSegments || painter.debugSegments;

    program.draw(context, gl.TRIANGLES, depthMode, stencilMode, ColorMode.alphaBlended, CullFaceMode.disabled,
        debugUniformValues(posMatrix, Color.transparent, scaleRatio), id,
        debugTextBuffer, debugTextIndexBuffer, debugTextSegments,
        null, null, null, [tile._globeTileDebugTextBuffer]);
}

function drawCrosshair(painter: Painter, x: number, y: number, color: Color) {
    const size = 20;
    const lineWidth = 2;
    //Vertical line
    drawDebugSSRect(painter, x - lineWidth / 2, y - size / 2, lineWidth, size, color);
    //Horizontal line
    drawDebugSSRect(painter, x - size / 2, y - lineWidth / 2, size, lineWidth, color);
}

function drawHorizontalLine(painter: Painter, y: number, lineWidth: number, color: Color) {
    drawDebugSSRect(painter, 0, y  + lineWidth / 2, painter.transform.width,  lineWidth, color);
}

function drawVerticalLine(painter: Painter, x: number, lineWidth: number, color: Color) {
    drawDebugSSRect(painter, x - lineWidth / 2, 0, lineWidth,  painter.transform.height, color);
}

function drawDebugSSRect(painter: Painter, x: number, y: number, width: number, height: number, color: Color) {
    const context = painter.context;
    const gl = context.gl;

    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x * browser.devicePixelRatio, y * browser.devicePixelRatio, width * browser.devicePixelRatio, height * browser.devicePixelRatio);
    context.clear({color});
    gl.disable(gl.SCISSOR_TEST);
}

function drawTileQueryGeometry(painter, sourceCache, coord: OverscaledTileID) {
    const context = painter.context;
    const gl = context.gl;

    const posMatrix = coord.projMatrix;
    const program = painter.useProgram('debug');
    const tile = sourceCache.getTileByID(coord.key);
    if (painter.terrain) painter.terrain.setupElevationDraw(tile, program);

    const depthMode = DepthMode.disabled;
    const stencilMode = StencilMode.disabled;
    const colorMode = painter.colorModeForRenderPass();
    const id = '$debug';

    context.activeTexture.set(gl.TEXTURE0);
    // Bind the empty texture for drawing outlines
    painter.emptyTexture.bind(gl.LINEAR, gl.CLAMP_TO_EDGE);

    const queryViz = tile.queryGeometryDebugViz;
    const boundsViz = tile.queryBoundsDebugViz;

    if (queryViz && queryViz.vertices.length > 0) {
        queryViz.lazyUpload(context);
        const vertexBuffer = queryViz.vertexBuffer;
        const indexBuffer = queryViz.indexBuffer;
        const segments = queryViz.segments;
        if (vertexBuffer != null && indexBuffer != null && segments != null) {
            program.draw(context, gl.LINE_STRIP, depthMode, stencilMode, colorMode, CullFaceMode.disabled,
                debugUniformValues(posMatrix, queryViz.color), id,
                vertexBuffer, indexBuffer, segments);
        }
    }

    if (boundsViz && boundsViz.vertices.length > 0) {
        boundsViz.lazyUpload(context);
        const vertexBuffer = boundsViz.vertexBuffer;
        const indexBuffer = boundsViz.indexBuffer;
        const segments = boundsViz.segments;
        if (vertexBuffer != null && indexBuffer != null && segments != null) {
            program.draw(context, gl.LINE_STRIP, depthMode, stencilMode, colorMode, CullFaceMode.disabled,
                debugUniformValues(posMatrix, boundsViz.color), id,
                vertexBuffer, indexBuffer, segments);
        }
    }
}

function drawTextToOverlay(painter: Painter, text: string) {
    painter.initDebugOverlayCanvas();
    const canvas = painter.debugOverlayCanvas;
    const gl = painter.context.gl;
    const ctx2d = painter.debugOverlayCanvas.getContext('2d');
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);

    ctx2d.shadowColor = 'white';
    ctx2d.shadowBlur = 2;
    ctx2d.lineWidth = 1.5;
    ctx2d.strokeStyle = 'white';
    ctx2d.textBaseline = 'top';
    ctx2d.font = `bold ${36}px Open Sans, sans-serif`;
    ctx2d.fillText(text, 5, 5);
    ctx2d.strokeText(text, 5, 5);

    painter.debugOverlayTexture.update(canvas);
    painter.debugOverlayTexture.bind(gl.LINEAR, gl.CLAMP_TO_EDGE);
}

let debugCanvas: ?HTMLCanvasElement;
let aabbCorners = [];

function initializeCanvas(tr: Transform) {
    if (!debugCanvas) {
        debugCanvas = window.document.createElement('canvas');
        window.document.body.appendChild(debugCanvas);
        debugCanvas.style.position = 'absolute';
        debugCanvas.style.left = 0;
        debugCanvas.style.top = 0;
        debugCanvas.style.pointerEvents = 'none';

        const resize = () => {
            if (!debugCanvas) { return; }
            debugCanvas.width = tr.width;
            debugCanvas.height = tr.height;
        };
        resize();

        window.addEventListener("resize", resize);
    }
    return debugCanvas;
}

function drawLine(ctx: CanvasRenderingContext2D, start: Vec2, end: Vec2) {
    ctx.beginPath();
    ctx.moveTo(...start);
    ctx.lineTo(...end);
    ctx.stroke();
}

function drawPolygon(ctx: CanvasRenderingContext2D, corners: Array<Vec2>) {
    ctx.beginPath();
    ctx.moveTo(...corners[corners.length - 1]);
    for (const corner of corners) {
        ctx.lineTo(...corner);
    }
    ctx.stroke();
}

function drawBox(ctx: CanvasRenderingContext2D, corners: Array<Vec3>) {
    assert(corners.length === 8, `AABB needs 8 corners, found ${corners.length}`);
    drawPolygon(ctx, corners.slice(0, 4));
    drawPolygon(ctx, corners.slice(4));
    drawLine(ctx, corners[0], corners[4]);
    drawLine(ctx, corners[1], corners[5]);
    drawLine(ctx, corners[2], corners[6]);
    drawLine(ctx, corners[3], corners[7]);
}

export function drawAabbs(painter: Painter, sourceCache: SourceCache, coords: Array<OverscaledTileID>) {
    const tr = painter.transform;

    const worldToECEFMatrix = mat4.invert(new Float64Array(16), tr.globeMatrix);
    const ecefToPixelMatrix = mat4.multiply(mat4.identity(new Float64Array(16)), tr.pixelMatrix, tr.globeMatrix);
    const numTiles =  1 << tr.coveringZoomLevel({tileSize: tr.tileSize});

    if (!tr.freezeTileCoverage) {
        aabbCorners = coords.map(coord => {
            const aabb = aabbForTileOnGlobe(tr, numTiles, coord.canonical);
            const corners = aabb.getCorners();
            // Store AABBs to rectangular prisms in ECEF, this allows viewing them from other angles
            // when transform.freezeTileCoverage is enabled.
            for (const pos of corners) {
                vec3.scale(pos, pos, tr.worldSize / numTiles);
                vec3.transformMat4(pos, pos, worldToECEFMatrix);
            }
            return corners;
        });
    }

    const canvas = initializeCanvas(tr);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const tileCount = aabbCorners.length;
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 2;
    ctx.lineWidth = 1.5;

    for (let i = 0; i <  tileCount; i++) {
        const pixelCorners = aabbCorners[i].map(ecef => vec3.transformMat4([], ecef, ecefToPixelMatrix));
        ctx.strokeStyle = `hsl(${360 * i / tileCount}, 100%, 50%)`;
        drawBox(ctx, pixelCorners);
    }
}

export function clearAabbs() {
    if (!debugCanvas) { return; }
    debugCanvas.getContext('2d').clearRect(0, 0, debugCanvas.width, debugCanvas.height);
    aabbCorners = [];
}
