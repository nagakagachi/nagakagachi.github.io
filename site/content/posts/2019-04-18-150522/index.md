---
title: "UE4 翻訳メモ Mesh Drawing Pipeline Conversion Guide for Unreal Engine 4.22"
date: "2019-04-18T15:05:22+09:00"
draft: false
url: "/entry/2019/04/18/150522/"
categories: ["UE4", "C++", "UnrealC++", "シェーダ", "マテリアル"]
hatena_author: "nagakagachi"
hatena_original_url: "https://nagakagachi.hatenablog.com/entry/2019/04/18/150522"
hatena_basename: "2019/04/18/150522"
math: false
---

<p>4.22で大幅に変更されたらしいメッシュ描画パイプラインのドキュメントを<a class="keyword" href="http://d.hatena.ne.jp/keyword/Google%CB%DD%CC%F5">Google翻訳</a>先生の力を借りて翻訳しつつメモ</p><p><iframe src="https://hatenablog-parts.com/embed?url=https%3A%2F%2Fdocs.unrealengine.com%2Fen-us%2FProgramming%2FRendering%2FMeshDrawingPipeline%2F4_22_ConversionGuide" title="Mesh Drawing Pipeline Conversion Guide for Unreal Engine 4.22" class="embed-card embed-webcard" scrolling="no" frameborder="0" style="display: block; width: 100%; height: 155px; max-width: 500px; margin: 10px 0px;"></iframe><cite class="hatena-citation"><a href="https://docs.unrealengine.com/en-us/Programming/Rendering/MeshDrawingPipeline/4_22_ConversionGuide">docs.unrealengine.com</a></cite></p><p>より詳細は<br />
<iframe src="https://hatenablog-parts.com/embed?url=https%3A%2F%2Fdocs.unrealengine.com%2Fen-us%2FProgramming%2FRendering%2FMeshDrawingPipeline" title="Mesh Drawing Pipeline" class="embed-card embed-webcard" scrolling="no" frameborder="0" style="display: block; width: 100%; height: 155px; max-width: 500px; margin: 10px 0px;"></iframe><cite class="hatena-citation"><a href="https://docs.unrealengine.com/en-us/Programming/Rendering/MeshDrawingPipeline">docs.unrealengine.com</a></cite><br />
や<br />
<iframe width="480" height="270" src="https://www.youtube.com/embed/qx1c190aGhs?feature=oembed" frameborder="0" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe><cite class="hatena-citation"><a href="https://www.youtube.com/watch?time_continue=526&v=qx1c190aGhs">www.youtube.com</a></cite><br />
を参照<br />
<br />
<br />
</p>

<div class="section">
    

### Introduction


<p><a class="keyword" href="http://d.hatena.ne.jp/keyword/Unreal%20Engine">Unreal Engine</a>（<a class="keyword" href="http://d.hatena.ne.jp/keyword/UE4">UE4</a>）4.22リリースでは、Mesh Drawing Pipelineは完全に書き直されました。主な変更点は、フレーム毎に描画の準備をするImmediate Mode からすべてのシーン描画が事前に準備される Retained Mode に移行したことです。これは、シーン全体のシェーダ<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%D0%A5%A4%A5%F3%A5%C7%A5%A3%A5%F3%A5%B0">バインディング</a>テーブルを必要とする<a class="keyword" href="http://d.hatena.ne.jp/keyword/DirectX">DirectX</a> Raytracing（DXR）や、CPUが可視性の情報無しに描画の準備をする必要がある <a class="keyword" href="http://d.hatena.ne.jp/keyword/GPU">GPU</a>-Driven-Rendering など、今後のテク<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%CE%A5%ED">ノロ</a>ジをサポートできるようになるための重要な変更です。</p>

<blockquote>
<p><a class="keyword" href="http://d.hatena.ne.jp/keyword/UE4">UE4</a> 4.22でのMesh Drawing Pipelineの変更についての詳細は、Mesh Drawing PipelineのドキュメントおよびGame Developer's Conference（<a class="keyword" href="http://d.hatena.ne.jp/keyword/GDC">GDC</a>）のプレゼンテーション<a class="keyword" href="http://d.hatena.ne.jp/keyword/Unreal%20Engine">Unreal Engine</a> 4.22用Mesh Drawing Pipelineの<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%EA%A5%D5%A5%A1%A5%AF%A5%BF%A5%EA%A5%F3%A5%B0">リファクタリング</a>を参照してください。</p>

</blockquote>

</div>
<div class="section">
    

### Mesh Draw Commands


<p>古いパイプラインでは、mesh pass draw policiesはFMeshBatchに基づいてRendering Hardware Interface（RHI）コマンドを直接実行していました。新しいパイプラインでは、メッシュ描画コマンドFMeshDrawCommandの概念が導入されています。これは、FMeshBatchとRHIの間のインタフェースとして機能します。 Mesh drawコマンドは完全な<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%B9%A5%BF%A5%F3%A5%C9%A5%A2%A5%ED%A5%F3">スタンドアロン</a>の描画記述です。FMeshDrawCommandはRHIが描画について知る必要があるすべての情報を格納します。これにより、描画ステート全体をそれらのシェーダ<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%D0%A5%A4%A5%F3%A5%C7%A5%A3%A5%F3%A5%B0">バインディング</a>と一緒にキャッシュして再利用することができます。</p>

</div>
<div class="section">
    

### Static Draw Lists and Primitive Sets


<p>4.22メッシュ<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%EC%A5%F3%A5%C0%A5%EA%A5%F3%A5%B0">レンダリング</a>パイプラインでは、静的描画リスト（TStaticMeshDrawList）とプリミティブセット（たとえば、FTranslucentPrimSet、FCustomDepthPrimSet）はFParallelMeshDrawCommandPassによって置き換えられました。 FParallelMeshDrawCommandPassはパスごとの可視メッシュ描画コマンドリストを<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%AB%A5%D7%A5%BB%A5%EB%B2%BD">カプセル化</a>します。</p>

新しいデザインには2つの重要な変更があります。まず、シーンごとのMesh ListsがVisible Mesh Listsに置き換えられました。以前のStatic Mesh Passではシーン内のパス毎のStatic Mesh List(TStaticMeshDrawList)をトラバースして個々のStatic MeshについてFViewInfo :: StaticMeshVisibilityMapをチェックすることで表示可能なMeshを選択していました。新しいデザインでは、描画は可視メッシュの描画コマンド配列（FMeshDrawCommandPassSetupTaskContext :: MeshDrawCommands）の単なるトラバースです。新しいアプローチは、シーンの複雑さに応じてスケールします。 2つ目の重要な変更は、静的および動的メッシュ描画リストをマージすることです。これにより、メッシュ描画パイプライン全体が簡素化され、レンダラーは静的描画と動的描画を並べ替えることもできます。

<p>このパイプラインには、DrawDynamicMeshPass関数によるImmediate Modeのメッシュ<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%EC%A5%F3%A5%C0%A5%EA%A5%F3%A5%B0">レンダリング</a>エミュレーションもあります。これは非常に柔軟な<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%EC%A5%F3%A5%C0%A5%EA%A5%F3%A5%B0">レンダリング</a>パスですが、キャッシング、自動<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%A4%A5%F3%A5%B9%A5%BF%A5%F3%A5%B9">インスタンス</a>化、および複数の動的メモリ割り当てをサポートしていないため、パフォーマンスが重要でないメッシュパスにのみ使用してください。たとえばこの機能はエディタ専用ヘルパーメッシュの<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%EC%A5%F3%A5%C0%A5%EA%A5%F3%A5%B0">レンダリング</a>を担当していたDrawViewElementsの置き換えとなります。</p>

</div>
<div class="section">
    

### Drawing Policies


<p>FDepthDrawingPolicyやFBasePassDrawingPolicyなどのdraw policiesは、FDepthPassMeshProcessorおよびFBasePassMeshProcessorに置き換えられました。特定のパスメッシュプロセッサはFMeshProcessor基本クラスから派生し、各FMeshBatchをパス用の一連のメッシュ描画コマンドに変換します。ここが最終的な描画フィルタリングが行われる場所です。シェーダの組み合わせ(Permutation)が選択され、シェーダ<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%D0%A5%A4%A5%F3%A5%C7%A5%A3%A5%F3%A5%B0">バインディング</a>が揃えられます。</p>

</div>
<div class="section">
    

### Shader Bindings


<p>以前はすべてのシェーダーパラメーターは適切なDrawing PoliciesによってRHICmdListに直接設定されていました。新たな仕組みではすべてのパラメータがFMeshDrawSingleShaderBindingsに集められ、後で描画中にSetOnCommandListを呼び出すことでRHICmdListに設定されます。これはシェーダ<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%D0%A5%A4%A5%F3%A5%C7%A5%A3%A5%F3%A5%B0">バインディング</a>を使用してすべての描画ステートをキャッシュできるようにするために必要な仕組みです。</p>

古いパイプラインは、FDrawingPolicyRenderStateを使用して、common high-level mesh pass render stateを渡します(例えばuniform bufferを渡すのと同じように)。新しいパイプラインは、機能を大幅に変更することなくFDrawingPolicyRenderStateをFMeshPassProcessorRenderStateにリネームします。

<p>シェーダ<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%D0%A5%A4%A5%F3%A5%C7%A5%A3%A5%F3%A5%B0">バインディング</a>の他の部分は、シェーダのSetParametersとSetMesh関数に埋め込まれました。これらはGetShaderBindingsとGetElementShaderBindingsに置き換えられました。上記の関数はカスタマイズ可能なShaderElementDataTypeに描画単位のパラメータを渡します。</p><p><a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%EA%A5%D5%A5%A1%A5%AF%A5%BF%A5%EA%A5%F3%A5%B0">リファクタリング</a>により多くのLooseパラメータがパス毎、または他のuniform buffersに移動しました。Looseパラメータを使用すると自動<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%A4%A5%F3%A5%B9%A5%BF%A5%F3%A5%B9">インスタンス</a>化が無効になるだけでなく、各描画の間で定数バッファ更新を実行する必要があるため、処理速度の低下の原因となります。</p>

ViewUniformBufferやDepthPassUniformBufferのような以前の標準的なuniform buffersは、新しいデータで毎フレームを作り直されていました。新しいパイプラインではこれらは永続的かつグローバルです(FScene :: FPersistentUniformBuffers内に保持されます)。これによってメッシュ描画コマンドがキャッシュされていてもシェーダはフレームごとに適切なデータを受信できます。



</div>
<div class="section">
    

### FPrimitiveViewRelevance


    

FPrimitiveViewRelevanceは、2つの追加の関連性フラグで拡張されました。



<ul>
<li>Separate Velocity Pass にはbVelocityRelevanceフラグが必要です。</li>
<li>Translucency Self Shadow にはbTranslucentSelfShadowフラグが必要です。</li>
</ul><p>さらに、すべての動的描画はview relevanceに依存するようになり、view relevanceで特定のパスを無効にすることで<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%EC%A5%F3%A5%C0%A5%EA%A5%F3%A5%B0">レンダリング</a>も無効になります。</p>

</div>
<div class="section">
    

### Shaders


<p>新しいパイプラインではGPUSceneが導入されました。これはシーン内のすべてのプリミティブのprimitive uniform bufferデータを含む構造化バッファです。現在、local vertex factory（Static Mesh Component）とSM5 feature levelのみがこの<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%EC%A5%F3%A5%C0%A5%EA%A5%F3%A5%B0">レンダリング</a>パスを利用できます。シェーダは、GPUSceneを有効にして<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%B3%A5%F3%A5%D1%A5%A4%A5%EB">コンパイル</a>するためにPrimitiveのuniform bufferに直接アクセスする代わりに、GetPrimitiveData（PrimitiveId）を使用する必要があります。</p><p>プリミティブデータアクセスは、[Custom Expression Material ]ノード内で度々使用されます。たとえば、プリミティブの<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%D0%A5%A6%A5%F3%A5%C7%A5%A3">バウンディ</a>ングボックスにアクセスするためです。それらを変換するためには、Primitive.MemberをGetPrimitiveData（Parameters.PrimitiveId）.Memberに置き換える必要があります。</p>

</div>

---

[元のはてなブログ記事](https://nagakagachi.hatenablog.com/entry/2019/04/18/150522)
