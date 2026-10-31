struct Camera { viewProjection: mat4x4f, display: vec4u }
@group(0) @binding(0) var<uniform> camera: Camera;
struct Vertex {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
    @location(2) color: vec3f,
}
struct Surface {
    @builtin(position) @invariant position: vec4f,
    @location(0) normal: vec3f,
    @location(1) color: vec3f,
}
// ZOnlyとForwardで位置計算を共有し、Equal比較で同じ面を描く。
fn project(position: vec3f) -> vec4f {
    return camera.viewProjection * vec4f(position, 1.0);
}
@vertex fn depthVertex(v: Vertex) -> @builtin(position) @invariant vec4f {
    return project(v.position);
}
@vertex fn surfaceVertex(v: Vertex) -> Surface {
    return Surface(project(v.position), v.normal, v.color);
}
struct Placement { positionScale: vec4f, rotation: vec4f, variation: vec4u }
struct LeafClass { verticesPerVariation: u32, reserved0: u32, reserved1: u32, reserved2: u32 }
@group(1) @binding(0) var<storage, read> leafVertices: array<f32>;
@group(1) @binding(1) var<storage, read> placements: array<Placement>;
@group(1) @binding(2) var<uniform> leafClass: LeafClass;

fn leafAddress(vertexIndex: u32, placement: Placement) -> u32 {
    // vertexIndexは固定機能の共有IBの値。個体のバリエーションだけをオフセットに足す。
    return (placement.variation.x * leafClass.verticesPerVariation + vertexIndex) * 9u;
}
fn readLeaf3(at: u32) -> vec3f {
    return vec3f(leafVertices[at], leafVertices[at + 1u], leafVertices[at + 2u]);
}
fn rotateVector(v: vec3f, q: vec4f) -> vec3f {
    return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}
fn leafPosition(at: u32, placement: Placement) -> vec4f {
    return project(rotateVector(readLeaf3(at), placement.rotation) * placement.positionScale.w + placement.positionScale.xyz);
}
@vertex fn leafDepthVertex(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32)
    -> @builtin(position) @invariant vec4f {
    let placement = placements[instanceIndex];
    return leafPosition(leafAddress(vertexIndex, placement), placement);
}
@vertex fn leafSurfaceVertex(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> Surface {
    let placement = placements[instanceIndex];
    let at = leafAddress(vertexIndex, placement);
    return Surface(leafPosition(at, placement), rotateVector(readLeaf3(at + 3u), placement.rotation), readLeaf3(at + 6u));
}
@fragment fn shade(v: Surface, @builtin(front_facing) front: bool) -> @location(0) vec4f {
    // 輪郭の確認では照明・頂点カラーを使わず白一色で描く。
    if (camera.display.x != 0u) { return vec4f(4.0,4.0,4.0,1.0); }
    // 葉カードは両面を描く。裏面の法線を反転し、discardは使わない。
    let normal = normalize(v.normal) * select(-1.0, 1.0, front);
    let light = normalize(vec3f(0.6, 0.8, 0.5));
    // 初版の形状確認用の照明。環境光は天空IBLではなく簡易な上下グラデーション。
    let ambient = mix(vec3f(0.13, 0.12, 0.10), vec3f(0.5, 0.65, 0.8), normal.y * 0.5 + 0.5);
    let diffuse = vec3f(5.0) * max(dot(normal, light), 0.0) / 3.14159265;
    return vec4f(v.color * (diffuse + ambient), 1.0);
}

// モデリング用の骨格中心線。幹メッシュとは独立して表示する。
@vertex fn lineVertex(@location(0) position: vec3f) -> @builtin(position) vec4f {
    return project(position);
}
@fragment fn lineColor() -> @location(0) vec4f {
    return vec4f(1.0, 0.35, 0.04, 1.0);
}
