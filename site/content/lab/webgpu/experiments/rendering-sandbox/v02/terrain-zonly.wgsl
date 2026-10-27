// 不透明物のZOnlyバリエーション。メインと光源はgroup(0)の視点だけを変える。
// Forwardと同じ位置関数を使い、Equal深度比較のため位置出力にinvariantを指定する。
@vertex
fn depthMain(@builtin(vertex_index) id: u32, @builtin(instance_index) instance: u32)
    -> @builtin(position) @invariant vec4f {
    return terrainVertex(id, instance).clip;
}
