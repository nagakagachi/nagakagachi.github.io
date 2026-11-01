struct ScreenParams {
    inverseViewProjection: mat4x4f,
    viewProjection: mat4x4f,
    light: vec4f,
    camera: vec4f,
    forward: vec4f,
    trace: vec4f, // レイ長m、厚みm、始点バイアスm、CSM終端距離。
    dimensions: vec4u, // メイン幅/高さ、Trace幅/高さ。
    options: vec4u, // 有効、ステップ数、診断集計、CSM合成モード。
    display: vec4u, // 可視化、再構成フィルタ、全距離テスト、IGNジッター。
    adaptive: vec4f, // 距離対応有効、基準距離m、最大レイ長m、最大厚みm。
    contact: vec4f, // 固定の初期間隔m、確保するステップ数、区間長による厚み補正、予約。
}
