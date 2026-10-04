---
title: "UE4 ComputeShaderでMeshの頂点バッファをリアルタイム書き換えする (GPGPU)"
date: "2019-09-22T22:26:04+09:00"
draft: false
url: "/entry/2019/09/22/222604/"
categories: ["UE4", "C++", "UnrealC++", "シェーダ", "ComputeShader", "GPGPU"]
hatena_author: "nagakagachi"
hatena_original_url: "https://nagakagachi.hatenablog.com/entry/2019/09/22/222604"
hatena_basename: "2019/09/22/222604"
math: false
image: "images/a7e0ed1dbb7467ca02ad9f19db3cd9c2f5042317917e76eeb0a6fe5fa284007d.png"
---

エンジンバージョン:4.22, 4.23  
  
諸事情によりサンプルプロジェクト無し

<p><a class="keyword" href="http://d.hatena.ne.jp/keyword/UE4">UE4</a>のProceduralMeshのようなことをComputeShaderでできたら、大量の頂点をリアルタイムに操作できて面白いのではないかという思い付き。<br />
今回はたくさんの草をリアルタイムに生成する目的で実装してある程度うまくいったのでメモ。<br />
この方法を応用すれば頂点カラーとかに<b>InstanceID的なものやそのほか特殊な情報を埋め込んでおいてマテリアルBPで利用</b>するといったこともできる。</p><p>この記事は<a class="keyword" href="http://d.hatena.ne.jp/keyword/C%2B%2B">C++</a>とGlobalShaderを利用したもので、且つエンジン改造はしない。<br />
また、自前で用意した頂点バッファをComputeShaderで書き換えて<a class="keyword" href="http://d.hatena.ne.jp/keyword/UE4">UE4</a>のメッシュ描画に流す方法がメインであるため、実装したComputeShader自体については深く説明しない。</p><p><iframe width="560" height="315" src="https://www.youtube.com/embed/vYK3n3544V4?feature=oembed" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe><cite class="hatena-citation"><a href="https://www.youtube.com/watch?v=vYK3n3544V4">www.youtube.com</a></cite><br />
↑プレイヤーからの影響を草一本一本が受ける例。<br />
草の位置や基準方向などを構造化バッファで保持しているのでそれらをComputeShaderで更新すればこのようなことも可能。<br />
<iframe width="560" height="315" src="https://www.youtube.com/embed/KTw7eWUym6k?feature=oembed" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe><cite class="hatena-citation"><a href="https://www.youtube.com/watch?v=KTw7eWUym6k">www.youtube.com</a></cite><br />
↑さらにマテリアルBP側で頂点オフセットによる風揺れをつけた例。<br />
描画自体は<a class="keyword" href="http://d.hatena.ne.jp/keyword/UE4">UE4</a>のメッシュ描画に乗っかっているのでStaticMesh等と同じようにマテリアルが使えるのが強みの一つ。</p>

<div class="section">
    

### 基本の考え


<p>自分で作成した頂点バッファやインデックスバッファを<a class="keyword" href="http://d.hatena.ne.jp/keyword/UE4">UE4</a>のメッシュ描画に流し込む方法は意外と簡単で、FPrimitiveSceneProxy派生クラスでGetDynamicMeshElements()関数をoverrideして適切にバッファ情報を渡せば可能になる。<br />
そこでこれらのバッファをUnorderedAccess可能な設定で作成しておき、毎フレームComputeShaderで書き換えるようにすることで、形状をリアルタイムに変更しつつマテリアル等を含めた描画部分は<a class="keyword" href="http://d.hatena.ne.jp/keyword/UE4">UE4</a>の仕組みをそのまま利用できると考えた。<figure class="figure-image figure-image-fotolife" title="フローのイメージ"><span itemscope itemtype="http://schema.org/Photograph"><img src="images/a7e0ed1dbb7467ca02ad9f19db3cd9c2f5042317917e76eeb0a6fe5fa284007d.png" alt="f:id:nagakagachi:20190922201851p:plain" title="" class="hatena-fotolife" itemprop="image"></span><figcaption>フローのイメージ</figcaption></figure></p>

<div class="section">
    

#### 必要な要素の概要


    
<ul>
<li>自作ComputeShader用GlobalShader
<ul>
<li>自作MeshProxyが生成した頂点バッファUAVやインデックスバッファUAVへ読み書きして草メッシュを作る</li>
<li>草メッシュの位置や向きは別途StructuredBufferで与える</li>
</ul></li>
<li>自作MeshComponentクラス
<ul>
<li>対になる自作MeshProxyを生成してシステムに登録し、ゲーム側からの情報を通知する役割</li>
</ul></li>
<li>自作MeshProxyクラス
<ul>
<li>自作MeshComponentの描画スレッド側における分身のような存在</li>
<li>UnorderedAccess可能な各種頂点バッファとインデックスバッファおよびそれらのUAVを作成する</li>
<li><a class="keyword" href="http://d.hatena.ne.jp/keyword/UE4">UE4</a>メッシュ描画システムのメッシュ情報収集に適切に頂点バッファなどを設定する</li>
<li>ComputeShaderのDispatchコマンド発行もする</li>
</ul></li>
</ul>
</div>
</div>
<div class="section">
    

### 自作ComputeShader用GlobalShader


<p>自作MeshProxyの各バッファのUAVを設定して書き換えるComputeShaderのGlobalShader。<br />
GlobalShader自体については公式のドキュメントを参考。<br />
<a href="https://docs.unrealengine.com/ja/Programming/Rendering/ShaderInPlugin/QuickStart/index.html">https://docs.unrealengine.com/ja/Programming/Rendering/ShaderInPlugin/QuickStart/index.html</a><br />
ComputeShaderをGlobalShaderとして作成してUAV他パラメータを設定する流れについては以下のブログが参考になる。<br />
<a href="http://www.sciement.com/tech-blog/c/structured_buffer_compute_shader_ue4_part2/">[UE4][ComputeShader][HLSL][C++]Unreal Engine 4&#x3067;(RW)StructuredBuffer&#x3092;&#x7528;&#x3044;&#x305F;ComputeShader&#x3092;&#x5229;&#x7528;&#x3059;&#x308B;&#xFF08;&#x305D;&#x306E;&#xFF12;&#xFF1A;C++&#x5074;&#x30B7;&#x30A7;&#x30FC;&#x30C0;&#x30AF;&#x30E9;&#x30B9;&#xFF09; &ndash; &#x30B5;&#x30A4;&#x30A2;&#x30E1;&#x30F3;&#x30C8;&#x6280;&#x8853;&#x30E1;&#x30E2;</a></p><p>今回はComputeShaderのスレッド一つが草一本を担当することとし、スレッドIDと草一つに割り当てられた頂点数からスレッドが書き込む頂点バッファ内の位置を決めている。あまり特殊なことはしていないが、接線法線頂点バッファ等がPackedフォーマットになっている場合はUAVから読み取った値をUnpackしたり書き戻す際に再度Packしたりといった処理が必要な点に注意。<figure class="figure-image figure-image-fotolife" title="ComputeShaderの処理イメージ"><span itemscope itemtype="http://schema.org/Photograph"><img src="images/fc508a3445d4aa4c0034f49351815345ab6d54a45970a5e6adf04e1739dbab1b.png" alt="f:id:nagakagachi:20190922220711p:plain" title="" class="hatena-fotolife" itemprop="image"></span><figcaption>ComputeShaderの処理イメージ</figcaption></figure></p>

</div>
<div class="section">
    

### 自作MeshComponentクラス


<p>UPrimitiveComponentを継承<br />
<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%B3%A5%F3%A5%DD%A1%BC%A5%CD%A5%F3%A5%C8">コンポーネント</a>としてゲームスレッド側の情報を管理する。UProceduralMeshComponentを参考にした。<br />
<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%B3%A5%F3%A5%DD%A1%BC%A5%CD%A5%F3%A5%C8">コンポーネント</a>の描画スレッド側の情報を管理するカスタムMeshProxyクラスを生成して保持し、適切に情報を渡したりするのが主な役目。<br />
適切なタイミングで自作MeshProxyへComputeShaderのDispatchコマンド生成をリク<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%A8%A5%B9">エス</a>トをする。</p>
<pre class="code lang-cpp" data-lang="cpp" data-unlink><span class="synType">virtual</span> <span class="synType">void</span> UComputeMeshComponent::TickComponent(<span class="synType">float</span> DeltaTime, <span class="synType">enum</span> ELevelTick TickType, FActorComponentTickFunction *ThisTickFunction) <span class="synType">override</span>
{
    <span class="synComment">// SendRenderDynamicData_Concurrent の呼び出しをリクエスト</span>
    MarkRenderDynamicDataDirty();
}
<span class="synType">virtual</span> <span class="synType">void</span> UComputeMeshComponent::SendRenderDynamicData_Concurrent() <span class="synType">override</span>
{
    <span class="synComment">// カスタムMeshProxyにComputeShaderのDispatchコマンド生成を要求</span>
    カスタムMeshProxy-&gt;EnqueueDispatchComputeShader();
}
</pre>
</div>
<div class="section">
    

### 自作MeshProxyクラス


    

FPrimitiveSceneProxyを継承  
  
今回の主役。FProceduralMeshSceneProxyを参考にした。



<div class="section">
    

#### バッファ生成時の設定


    

ComputeShaderで読み書きをするバッファはUnorderedAccessView(UAV)として使用可能な設定で生成する必要がある。  
  
そのため各種頂点バッファおよびインデックスバッファの生成時のusageフラグに BUF\_UnorderedAccess を追加する。


<pre class="code lang-cpp" data-lang="cpp" data-unlink>FRHIResourceCreateInfo CreateInfo;
uint32 usage = BUF_Static | BUF_ShaderResource;
    <span class="synStatement">if</span> (need_uav_)
        usage |= BUF_UnorderedAccess;
VertexBufferRHI = RHICreateVertexBuffer( 頂点要素サイズ * 頂点数, usage, CreateInfo);
</pre>

そのうえで RHICreateUnorderedAccessView() 関数でUAVを生成する。このUAVに対してComputeShaderで読み書きすることで頂点位置などを書き換えることができる。


<pre class="code lang-cpp" data-lang="cpp" data-unlink><span class="synStatement">if</span> (need_uav_)
    uav_ = RHICreateUnorderedAccessView(VertexBufferRHI, PF_R32_FLOAT);
</pre><p>今回の草は<span style="color: #d32f2f"><b>1本につき6頂点、4トライアングル</b></span>で構成されるものとして生成時に最大草数分のサイズを確保している。<br />
各種頂点バッファの生成とVertexFactoryへのBindは以下の<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%BD%A1%BC%A5%B9%A5%B3%A1%BC%A5%C9">ソースコード</a>を参考に。<br />
Engine/Source/Runtime/Engine/Public/Rendering/PositionVertexBuffer.h<br />
Engine/Source/Runtime/Engine/Public/Rendering/ColorVertexBuffer.h<br />
Engine/Source/Runtime/Engine/Public/Rendering/StaticMeshVertexBuffer.h<br />
インデックスバッファについては以下を参考に。<br />
Engine/Source/Runtime/Engine/Public/DynamicMeshBuilder.h</p>

今回は頂点バッファのフォーマットとして



<blockquote>
        

Position : Float3  
  
Color : FColor  
  
TangentNormal :PackedNormal ( R8G8B8A8\_SNORMにパックしたフォーマット )  
  
Texcoord : Float2



</blockquote>


を採用した。TangentNormalとTexcoordをHalfFloatとすることもできたが、うまくComputeShaderで読み書きができなかったので要調査。



</div>
<div class="section">
    

#### 描画メッシュとして登録


<p>上記のように作成した頂点バッファやインデックスバッファを実際にメッシュ描画に登録するために GetDynamicMeshElements() 関数をoverrideする。<br />
具体的な設定はProceduralMeshComponent等のエンジン側の<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%BD%A1%BC%A5%B9%A5%B3%A1%BC%A5%C9">ソースコード</a>が参考になる。</p>
<pre class="code lang-cpp" data-lang="cpp" data-unlink><span class="synComment">// 描画メッシュ収集時に呼ばれる関数</span>
<span class="synType">virtual</span> <span class="synType">void</span> FComputeMeshProxy::GetDynamicMeshElements(<span class="synType">const</span> TArray&lt;<span class="synType">const</span> FSceneView*&gt;&amp; Views, <span class="synType">const</span> FSceneViewFamily&amp; ViewFamily, uint32 VisibilityMap, FMeshElementCollector&amp; Collector) <span class="synType">const</span> <span class="synType">override</span>
{
    <span class="synComment">// </span><span class="synTodo">TODO</span>
    <span class="synComment">// Collector に描画したい頂点バッファ群を設定したVertexFactoryやインデックスバッファを登録する</span>
    <span class="synComment">// ProceduralMeshComponent.cpp 等を参考</span>
}
</pre><p>最後にComputeShaderをDispatchして頂点バッファを書き換える処理をRHICmdListに積み込む必要がある。RHICmdListへの操作はRenderThread側で実行する必要があるので、ENQUEUE_RENDER_COMMANDマクロを使って描画スレッドで実行されるようにリク<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%A8%A5%B9">エス</a>トする。</p>
<pre class="code lang-cpp" data-lang="cpp" data-unlink><span class="synType">void</span> FComputeMeshProxy::EnqueueDispatchComputeShader()
{
    <span class="synComment">// RenderThreadで実行してほしい処理をマクロで登録</span>
    ERHIFeatureLevel::Type FeatureLevel = component_-&gt;GetWorld()-&gt;Scene-&gt;GetFeatureLevel();
    ENQUEUE_RENDER_COMMAND(CaptureCommand)(
        [<span class="synStatement">this</span>, FeatureLevel](FRHICommandListImmediate&amp; RHICmdList)
    {
        <span class="synComment">// -- この中がRenderThreadで実行される --</span>
        <span class="synComment">// ComputeShaderのDispatch処理をRHICmdListに積み込む関数</span>
        DispatchComputeShader_RenderThread(
            RHICmdList,
            <span class="synStatement">this</span>,
            FeatureLevel);
    }
    );
}
</pre><p>DispatchComputeShader_RenderThread()ではComputeShaderのGlobalShaderに対して書き込み対象の頂点バッファUAVを設定してDispatchコマンドを発行する。頂点バッファはComputeShaderで読み書きされた後にメッシュ描画で頂点バッファとして利用されるので、TransitionResourceによる<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%C8%A5%E9%A5%F3%A5%B8%A5%B7%A5%E7%A5%F3">トランジション</a>コマンドも発行する必要があると思われる。</p>
<pre class="code lang-cpp" data-lang="cpp" data-unlink>
<span class="synType">static</span> <span class="synType">void</span> DispatchComputeShader_RenderThread(FRHICommandListImmediate&amp; RHICmdList,FNglComputeMeshProxy* proxy,ERHIFeatureLevel::Type FeatureLevel)
{
    <span class="synComment">// 頂点バッファを書き換える自作ComputeShaderのGlobalShaderを取得</span>
    TShaderMap&lt;FGlobalShaderType&gt;* GlobalShaderMap = GetGlobalShaderMap(FeatureLevel);
    TShaderMapRef&lt;FComputeMeshShaderCS&gt; cs(GlobalShaderMap);
    
    <span class="synComment">// Position頂点バッファリソースをGfxからComputeへトランジション</span>
    RHICmdList.TransitionResource(EResourceTransitionAccess::ERWBarrier, EResourceTransitionPipeline::EGfxToCompute, Position頂点バッファUAV);
    <span class="synComment">// </span><span class="synTodo">TODO</span><span class="synComment"> ほかのバッファも同様に</span>

    {
        <span class="synComment">// Position頂点バッファUAVをRWリソースとして設定</span>
        SetUAVParameter(RHICmdList, cs-&gt;GetComputeShader(), cs-&gt;vtx_pos_buffer_, Position頂点バッファUAV);
        <span class="synComment">// </span><span class="synTodo">TODO</span><span class="synComment"> ほかのバッファも同様に</span>

        <span class="synComment">// ComputeShaderのDispatch</span>
        DispatchComputeShader(RHICmdList, *cs, ディスパッチグループ数, <span class="synConstant">1</span>, <span class="synConstant">1</span>);

        <span class="synComment">// Position頂点バッファUAVをRWリソースから外す</span>
        SetUAVParameter(RHICmdList, cs-&gt;GetComputeShader(), cs-&gt;vtx_pos_buffer_, <span class="synConstant">nullptr</span>);
        <span class="synComment">// </span><span class="synTodo">TODO</span><span class="synComment"> ほかのバッファも同様に</span>
    }

    <span class="synComment">// Position頂点バッファリソースをComputeからGfxへトランジション</span>
    RHICmdList.TransitionResource(EResourceTransitionAccess::EReadable, EResourceTransitionPipeline::EComputeToGfx, Position頂点バッファUAV);
    <span class="synComment">// </span><span class="synTodo">TODO</span><span class="synComment"> ほかのバッファも同様に</span>
}
</pre>

ここでの注意点としては、RWリソースとして設定したバッファを使用後に外しておかないと、メッシュ描画時のバッファ利用方法と競合して正常に描画されなくなる点。



</div>
</div>
<div class="section">
    

### future work


<p>インデックスバッファに同一インデックスを書き込むことでトライアングルを潰すことができるので、最大限のバッファサイズを確保しておいて必要に応じてトライアングルを増減させてTessellationのようなことができるかもしれない。<br />
以下はプレイヤーの近く以外の草を単純にスケールで縮退させてみた例.<blockquote data-conversation="none" class="twitter-tweet" data-lang="ja"><p lang="ja" dir="ltr"><a href="https://twitter.com/hashtag/UE4?src=hash&amp;ref_src=twsrc%5Etfw">#UE4</a> Addaptiveってかんじ <a href="https://t.co/hLbyMFlHKi">pic.twitter.com/hLbyMFlHKi</a></p>&mdash; なが (@nagakagachi) <a href="https://twitter.com/nagakagachi/status/1172011056048140288?ref_src=twsrc%5Etfw">2019年9月12日</a></blockquote> <script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script> <br />
Shell方式の毛皮表現のように多数のポリゴンを重ねる表現などでも、カメラからの距離時応じて重ねる数を動的に変更したりすることでパフォーマンスを稼ぐことができるかもしれない。<br />
メッシュを作っているだけなので<a class="keyword" href="http://d.hatena.ne.jp/keyword/GPU">GPU</a>パーティクル的なこともできそう。<br />
最初にも書いたがカラーやUVなどの独自の情報を埋め込んでマテリアルBPで利用することでもいろいろなことができる気がする。<br />
そのほかア<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%A4%A5%C7%A5%A2">イデア</a>募集中。</p>

</div>

---

[元のはてなブログ記事](https://nagakagachi.hatenablog.com/entry/2019/09/22/222604)
