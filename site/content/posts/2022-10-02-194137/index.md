---
title: "UE5 Geometry Script を利用した頂点単位リアルタイムアニメーション"
date: "2022-10-02T19:41:37+09:00"
draft: false
url: "/entry/2022/10/02/194137/"
categories: ["Animation", "GPGPU", "Graphics", "Material", "Physics", "Shader", "Tech", "UE5", "UE4", "シェーダ", "マテリアル"]
hatena_author: "nagakagachi"
hatena_original_url: "https://nagakagachi.hatenablog.com/entry/2022/10/02/194137"
hatena_basename: "2022/10/02/194137"
math: false
image: "images/6180d11068fdae02c349a7e467eed72ac958f509a59859185abd883f9cd767a9.png"
---

Geometry Scriptの利用の一環で



<ul>
<li>入力メッシュの頂点インデックスをUV1に埋め込み、外部テクスチャに頂点座標をベイク</li>
<li>上記で生成したメッシュとテクスチャを利用してマテリアルで頂点単位バネアニメーション</li>
</ul>

というものを試してみました

<p><blockquote data-conversation="none" class="twitter-tweet" data-lang="ja"><p lang="ja" dir="ltr">realtime fake secondary motion (WIP.<br>position, rotation, and scale operations in editor mode.<br><br>Editorモードでの位置とスケールの操作プレビュー対応まで.<br><br>あとプルプルしすぎていたので更に調整.<a href="https://twitter.com/hashtag/UE5?src=hash&amp;ref_src=twsrc%5Etfw">#UE5</a> <a href="https://t.co/xgzYPtIGpw">pic.twitter.com/xgzYPtIGpw</a></p>&mdash; なが (@nagakagachi) <a href="https://twitter.com/nagakagachi/status/1561311962805719040?ref_src=twsrc%5Etfw">2022年8月21日</a></blockquote> <script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script> </p>

<div class="section">
    

<h3 id="サンプル">サンプル</h3>


<p>レベルに配置されている BP_ControllerInEditorTick を動かすとプルプルします.<br />
Playを実行すると物理で動くモデルがプルプルします.<br />
<iframe src="https://hatenablog-parts.com/embed?url=https%3A%2F%2Fgithub.com%2Fnagakagachi%2Fue4%2Ftree%2Fmaster%2Fproject%2Fsample%2FPerVtxAnimSample" title="ue4/project/sample/PerVtxAnimSample at master · nagakagachi/ue4" class="embed-card embed-webcard" scrolling="no" frameborder="0" style="display: block; width: 100%; height: 155px; max-width: 500px; margin: 10px 0px;" loading="lazy"></iframe><cite class="hatena-citation"><a href="https://github.com/nagakagachi/ue4/tree/master/project/sample/PerVtxAnimSample">github.com</a></cite></p>





</div>
<div class="section">
    

<h3 id="構成">構成</h3>


    
<ul>
<li>BP_GenerateMeshForPerVertexAnim
<ul>
<li>入力StaticMeshアセットから以下のようなアセットを生成する
<ul>
<li>UV1に頂点インデックスを埋め込んだStaticMesh</li>
<li>頂点インデックスに対応したテクセルにローカル頂点座標をベイクしたテクスチャ</li>
</ul></li>
</ul></li>
<li>BP_PerVertexAnimationTest
<ul>
<li>上記で生成したMeshとテクスチャを利用して頂点単位バネシミュレーションをマテリアル(<a class="keyword" href="http://d.hatena.ne.jp/keyword/GPU">GPU</a>)で計算する</li>
</ul></li>
<li>BP_ControllerInEditorTick
<ul>
<li>Editorモードのマニピュレータ操作でバネシミュをプレビューするためのコントローラ</li>
</ul></li>
</ul>
</div>
<div class="section">
    

<h3 id="導入">導入</h3>


    
<div class="section">
<h4 id="プロジェクトで-Geometry-Script-プラグインを有効化">プロジェクトで Geometry Script <a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%D7%A5%E9%A5%B0%A5%A4%A5%F3">プラグイン</a>を有効化</h4>
<p>編集/<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%D7%A5%E9%A5%B0%A5%A4%A5%F3">プラグイン</a>エディタから Geometry Script の<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%C1%A5%A7%A5%C3%A5%AF%A5%DC%A5%C3%A5%AF%A5%B9">チェックボックス</a>をONにする<br />
必要ならEditorの再起動をする<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/6180d11068fdae02c349a7e467eed72ac958f509a59859185abd883f9cd767a9.png" width="1200" height="297" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><br />
</p>

</div>
<div class="section">
    

<h4 id="PerVtxAnimWithGeometryScriptを取り込み">PerVtxAnimWithGeometryScriptを取り込み</h4>


<p>Window<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%A8%A5%AF%A5%B9%A5%D7%A5%ED%A1%BC%A5%E9">エクスプローラ</a>上などからプロジェクトのContentフォルダにサンプルの<br />
PerVtxAnimWithGeometryScriptフォルダ<br />
をコピー</p>

</div>
<div class="section">
    

<h4 id="生成用サンプルアクター-をレベルに配置">生成用サンプルアクター をレベルに配置</h4>


<p>BP_GenerateMeshForPerVertexAnim をレベルに配置<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/30f9d9a8b24a648be093b5061ca7a42e20b81b7b61e41ca6d7e617866b48fbdc.png" width="1200" height="843" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><br />
</p>

</div>
<div class="section">
    

<h4 id="生成用サンプルアクターにアセットを設定">生成用サンプルアクターにアセットを設定</h4>


<p>BP_GenerateMeshForPerVertexAnimアクターに変換元Mesh, 出力先Mesh & RenderTargetを設定<br />
Sm Src Mesh に変換元のStaticMeshを設定, 図は同梱しているウシモデル(Spot)を設定している様子<br />
<a class="keyword" href="http://d.hatena.ne.jp/keyword/Tex">Tex</a> Bake Position Target にベイク情報を出力するRenderTargetを設定<br />
Sm Bake Target に変換結果のMeshを出力するStaticMeshを設定<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/a199ba136831e36a6a91fb45f179cc246799957a3bf072481fc714f27b8f6212.png" width="1200" height="671" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span></p>





</div>
<div class="section">
    

<h4 id="アセット生成">アセット生成</h4>


<p>Geometry Scritpが駆動して Sm Bake Target と <a class="keyword" href="http://d.hatena.ne.jp/keyword/Tex">Tex</a> Bake Position Target のアセットに生成物が保存される<br />
Geometry Scritpはアクターのパラメータ変更等で駆動するため, 位置の変更や Enable Regenerate Mesh のONOFF等でトリガーされる</p><p>Sm Bake Target にはUV1に頂点インデックスを埋め込んだStaticMeshが出力される<br />
<a class="keyword" href="http://d.hatena.ne.jp/keyword/Tex">Tex</a> Bake Position Target には頂点インデックスに対応するテクセルに頂点座標がベイクされたテクスチャが出力される<br />
これらのアセットを利用してリアルタイムに頂点単位アニメーションを実現する<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/1ba5eec862176e4d55fcef6e798612f79ba89b294c3feb723d08cebe0540e1f8.png" width="448" height="326" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/438e48343ffd19bd28e794c25208bb01781560b964ac51fb8e019b669698fcc4.png" width="794" height="672" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span></p>





</div>
<div class="section">
    

<h4 id="ランタイムサンプルアクターをレベルに配置">ランタイムサンプルアクターをレベルに配置</h4>


<p>BP_PerVertexAnimationTest は 上記アクターで生成されたメッシュとテクスチャを利用するサンプル<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/fc8bde70344bbc575f4f192547e6b9ddd8181b2cd78f0636d8a0dc0e82c46944.png" width="1200" height="864" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><br />
</p>

</div>
<div class="section">
    

<h4 id="ランタイムサンプルアクターにアセットを設定">ランタイムサンプルアクターにアセットを設定</h4>


<p>BP_PerVertexAnimationTest で生成されたメッシュとテクスチャをそれぞれ<br />
Mesh Vtx Attr Baked と <a class="keyword" href="http://d.hatena.ne.jp/keyword/Tex">Tex</a> Vtx Attr 0 に設定<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/740c759d4da7216bb8b008e247a4e476ea1a58c0e17efb105f46bf7273ba15ae.png" width="1200" height="663" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span></p>





</div>
</div>
<div class="section">
    

<h3 id="概要">概要</h3>


<p>頂点単位のバネシミュレーションを<a class="keyword" href="http://d.hatena.ne.jp/keyword/GPU">GPU</a>で実行するためにGeometry Scriptを利用している</p><p>Draw Material To RenderTarget で頂点単位計算を<a class="keyword" href="http://d.hatena.ne.jp/keyword/GPU">GPU</a>実行する<br />
そのためにメッシュのローカル頂点座標をテクスチャにベイク<br />
(Geometry ScriptでのアクセスとCanvasDrawでのテクスチャ書き込み)<br />
更にサーフェイスマテリアルで頂点毎の情報を上記テクスチャから取得するために<br />
Geometry ScriptでUV1に頂点インデックスを埋め込んでいる</p><br />


Draw Material To RenderTarget でローカル頂点座標テクスチャを利用してバネ計算した結果を変位テクスチャに出力



サーフェイスマテリアルでUV1から頂点インデックスをデコードし, そのインデックスからテクセル座標を計算,  
  
テクセル座標で変位テクスチャから変位ベクトルを取得してWorldPositionOffsetで頂点を動かしている



</div>

---

[元のはてなブログ記事](https://nagakagachi.hatenablog.com/entry/2022/10/02/194137)
