export type Vec3 = [number, number, number];
export const SHADOW_RESOLUTION = 2048;

export function dot(a: Vec3, b: Vec3): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: Vec3, b: Vec3): Vec3 {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function lightDirection(azimuthDegrees: number, elevationDegrees: number): Vec3 {
    const azimuth = azimuthDegrees * Math.PI / 180;
    const elevation = elevationDegrees * Math.PI / 180;
    // 地表から光源へ向かう単位ベクトル。方位角0度は+Z、仰角0度は水平。
    return [Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation)];
}
export function shadowMatrix(center: Vec3, light: Vec3, halfWidth: number, depthHalfRange: number, resolution: number): Float32Array<ArrayBuffer> {
    const raw = cross([0, 1, 0], light);
    const length = Math.hypot(...raw);
    if (length < 1e-6 || halfWidth <= 0 || depthHalfRange <= 0 || resolution < 1) {
        throw new Error('シャドウ投影の条件が不正です');
    }
    const right: Vec3 = [raw[0] / length, raw[1] / length, raw[2] / length];
    const up = cross(light, right);
    const texel = 2 * halfWidth / resolution;
    // 光源平面のXYをテクセルに合わせ、カメラ追従時のサブテクセル移動を抑える。
    const cx = Math.floor(dot(right, center) / texel) * texel;
    const cy = Math.floor(dot(up, center) / texel) * texel;
    const cz = dot(light, center);
    const zScale = 1 / (2 * depthHalfRange);
    // 正射影のNDC Zは0〜1。光源に近い点ほど大きくなるReversed Z。
    return new Float32Array([
        right[0] / halfWidth, up[0] / halfWidth, light[0] * zScale, 0,
        right[1] / halfWidth, up[1] / halfWidth, light[1] * zScale, 0,
        right[2] / halfWidth, up[2] / halfWidth, light[2] * zScale, 0,
        -cx / halfWidth, -cy / halfWidth, 0.5 - cz * zScale, 1
    ]);
}
export function frustumPlanes(matrix: Float32Array): Float32Array<ArrayBuffer> {
    const out = new Float32Array(24);
    // 左右・上下・Z=0/1。無限遠Perspectiveの定数平面も正規化せず扱う。
    for (let p = 0; p < 6; p++) {
        for (let j = 0; j < 4; j++) {
            const w = matrix[j * 4 + 3];
            out[p * 4 + j] = p < 4 ? w + (p % 2 === 0 ? 1 : -1) * matrix[j * 4 + Math.floor(p / 2)]
                : p === 4 ? matrix[j * 4 + 2] : w - matrix[j * 4 + 2];
        }
    }
    return out;
}

// メインカメラと同じ右・上・前方向をピクセルレイへ渡す。平行移動は空に影響しない。
export function skyRayFrame(yaw: number, pitch: number, aspect: number, verticalFov = Math.PI / 3): Float32Array<ArrayBuffer> {
    const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
    const tangent = Math.tan(verticalFov / 2);
    return new Float32Array([
        -sy * cp, -sp, -cy * cp, 0,
        cy * tangent * aspect, 0, -sy * tangent * aspect, 0,
        -sy * sp * tangent, cp * tangent, -cy * sp * tangent, 0
    ]);
}

// 右手系、near=1m、far=無限遠。NDC深度は視点空間の前方距離dに対して1/dとなる。
export function mainViewProjection(eye: Vec3, yaw: number, pitch: number, fov: number, aspect: number): Float32Array<ArrayBuffer> {
    const z: Vec3 = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
    const raw = cross([0, 1, 0], z), length = Math.hypot(...raw);
    const x: Vec3 = [raw[0] / length, raw[1] / length, raw[2] / length], y = cross(z, x);
    const f = 1 / Math.tan(fov / 2), sx = f / aspect;
    return new Float32Array([x[0] * sx, y[0] * f, 0, -z[0], x[1] * sx, y[1] * f, 0, -z[1],
        x[2] * sx, y[2] * f, 0, -z[2], -dot(x, eye) * sx, -dot(y, eye) * f, 1, dot(z, eye)]);
}
