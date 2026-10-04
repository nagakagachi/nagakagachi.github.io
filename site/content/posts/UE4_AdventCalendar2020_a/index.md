---
title: " InstancedStaticMeshとCustomDataとTextureで大量オブジェクト (UE4 Advent Calendar 2020)"
date: "2020-12-15T00:05:00+09:00"
draft: false
url: "/entry/UE4_AdventCalendar2020_a/"
categories: ["UE4", "UE4", "マテリアル", "シェーダ", "Graphics", "GPGPU"]
hatena_author: "nagakagachi"
hatena_original_url: "https://nagakagachi.hatenablog.com/entry/UE4_AdventCalendar2020_a"
hatena_basename: "UE4_AdventCalendar2020_a"
math: true
image: "images/4401bfee4e759fc09d24cd21a2dd0b8cdf2963e461c7c4440ddd204f49232b0a.png"
---

<p><a class="keyword" href="http://d.hatena.ne.jp/keyword/UE4">UE4</a> AdventCalendar2020 15日目の記事となります<br />
<a href="https://qiita.com/advent-calendar/2020/ue4">Unreal Engine 4 (UE4) Advent Calendar 2020 - Qiita</a></p><p>サンプルプロジェクトは以下(<a class="keyword" href="http://d.hatena.ne.jp/keyword/UE4">UE4</a>.26)<br />
<iframe src="https://hatenablog-parts.com/embed?url=https%3A%2F%2Fgithub.com%2Fnagakagachi%2Fue4%2Ftree%2Fmaster%2Fproject%2Fsample%2FStatefulInstancedMesh" title="ue4/project/sample/StatefulInstancedMesh at master · nagakagachi/ue4" class="embed-card embed-webcard" scrolling="no" frameborder="0" style="display: block; width: 100%; height: 155px; max-width: 500px; margin: 10px 0px;"></iframe><cite class="hatena-citation"><a href="https://github.com/nagakagachi/ue4/tree/master/project/sample/StatefulInstancedMesh">github.com</a></cite></p>




<ul class="table-of-contents">
<li><a href="#やりたいこと">やりたいこと</a></li>
<li><a href="#仕組みの概要">仕組みの概要</a></li>
<li><a href="#事前情報">事前情報</a><ul>
<li><a href="#CustomData">CustomData</a></li>
<li><a href="#CanvasObject">CanvasObject</a></li>
</ul>
</li>
<li><a href="#TextureRenderTarget2Dの準備">TextureRenderTarget2Dの準備</a></li>
<li><a href="#InstancedStaticMeshComponentの設定">InstancedStaticMeshComponentの設定</a></li>
<li><a href="#Instance番号をCustomDataに設定">Instance番号をCustomDataに設定</a></li>
<li><a href="#Instanceの基準位置をテクスチャに書き込み">Instanceの基準位置をテクスチャに書き込み</a></li>
<li><a href="#変位テクスチャによってメッシュを動かすマテリアル">変位テクスチャによってメッシュを動かすマテリアル</a></li>
<li><a href="#変位テクスチャ更新マテリアル">変位テクスチャ更新マテリアル</a></li>
<li><a href="#速度テクスチャ更新マテリアル">速度テクスチャ更新マテリアル</a></li>
<li><a href="#まとめ">まとめ</a></li>
</ul>
<div class="section">
    

<h3 id="やりたいこと">やりたいこと</h3>


    
<ul>
<li>大量の<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%A4%A5%F3%A5%B9%A5%BF%A5%F3%A5%B9">インスタンス</a>メッシュについて個別のパラメータをBPからマテリアルへ渡す</li>
<li>大量の<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%A4%A5%F3%A5%B9%A5%BF%A5%F3%A5%B9">インスタンス</a>メッシュのパラメータ更新を<a class="keyword" href="http://d.hatena.ne.jp/keyword/GPGPU">GPGPU</a>(マテリアル)で高速に実行する</li>
<li>BPのみでつくる (<a class="keyword" href="http://d.hatena.ne.jp/keyword/C%2B%2B">C++</a>つかわない)</li>
</ul>

このような要素を含んだデモとして以下のようなサンプルを作成しました。



<ul>
<li>基準位置とバネで接続された物体のシミュレーション
<ul>
<li>バネによる速度の変化</li>
<li>速度による位置の変化</li>
<li>プレイヤーとのインタ<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%E9%A5%AF">ラク</a>ション</li>
</ul></li>
</ul><p><iframe width="560" height="315" src="https://www.youtube.com/embed/2CmtMvd89KA?feature=oembed" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe><cite class="hatena-citation"><a href="https://youtu.be/2CmtMvd89KA">youtu.be</a></cite> <br />
<iframe width="560" height="315" src="https://www.youtube.com/embed/2dWGmIMSwSg?feature=oembed" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe><cite class="hatena-citation"><a href="https://youtu.be/2dWGmIMSwSg">youtu.be</a></cite><br />
以降の説明は基本的にこのデモをベースにしていきます。</p>

</div>
<div class="section">
    

<h3 id="仕組みの概要">仕組みの概要</h3>


    

今回紹介する方法は大まかに以下のような流れになります。



<ul>
<li>InstancedStaticMeshのCustomDataにInstance番号を設定する</li>
<li>テクスチャを配列データに見立ててInstanceパラメータを格納する</li>
<li>Instanceパラメータテクスチャをマテリアルで更新する</li>
<li>マテリアルでInstance番号に対応したパラメータをテクスチャから取得して使う</li>
</ul>
</div>
<div class="section">
    

<h3 id="事前情報">事前情報</h3>


<p>大量のメッシュを描画する場合にInstancedStaticMeshを使うことが多いと思います。<br />
ただし、<a class="keyword" href="http://d.hatena.ne.jp/keyword/UE4">UE4</a>のマテリアルではSV_InstanceID的な情報は取れないので、そのままではInstance毎にマテリアルで色を変えるといったことはできません。<br />
（格子状にInstanceを配置して頂点座標からInstance番号を計算するという技もありますが...）</p>

<div class="section">
    

<h4 id="CustomData">CustomData</h4>


<p>InstancedStaticMeshComponentのCustomDataを利用すると、Instance毎の個別情報を設定してマテリアルから参照できます。<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/ca7a8f4880625bc3a29b3bbf356a58d9e12d3fc1cc5803a5559f701007fd799d.png" alt="f:id:nagakagachi:20201202234548p:plain" width="363" height="285" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><br />
今回はここにInstanceの番号を設定し、テクスチャに格納したInstanceの速度情報等を取り出す際に利用します。</p>

</div>
<div class="section">
    

<h4 id="CanvasObject">CanvasObject</h4>


<p>CanvasObjectのDrawLine等によってBPからRenderTargetの任意の場所に色を書き込むことができます。<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/f517971f5216eb429a2fc764093d797049e761abba533a5eaf321c47b79f9ef7.png" alt="f:id:nagakagachi:20201203185207p:plain" width="236" height="254" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><br />
これを利用して、マテリアルパラメータでは難しい大量の情報をテクスチャ経由でマテリアルに渡します。<br />
<br />
</p>

</div>
</div>
<div class="section">
    

<h3 id="TextureRenderTarget2Dの準備">TextureRenderTarget2Dの準備</h3>


<p>バネのシミュレーションをするにあたって、Instanceの情報を格納する4つの<b>TextureRenderTarget2D</b>を用意しておきます。</p>

<ul>
<li>基準位置</li>
<li>基準位置からの変位(前フレーム)</li>
<li>基準位置からの変位(今フレーム)</li>
<li>速度</li>
</ul><p>今回は位置と速度の情報なのでFormatには <b>RGBA16f</b> を使います。<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/a5eced290c5f2ab6f17f4caea61c9aa47294fc8335993715e8d7c6dcb5b7b372.png" alt="f:id:nagakagachi:20201206210820p:plain" width="356" height="247" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span></p>

これらのテクスチャは下図のように左から右、上から下へ順番に番号付けをした配列データのように扱います。


<figure class="figure-image figure-image-fotolife" title="データ格納テクスチャ例(幅8高さ8)"><span itemscope itemtype="http://schema.org/Photograph"><img src="images/1940f2a76c4a6dcd953aee915911a4de9d5118674550897e67a80c4db41b3dea.png" alt="f:id:nagakagachi:20201206210318p:plain" width="748" height="857" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><figcaption>データ格納テクスチャ例(幅8高さ8)</figcaption></figure>

ここから分かるとおり、テクスチャの幅高さは表示したいInstanceすべてを格納できる十分なものにしておく必要があります。



</div>
<div class="section">
    

<h3 id="InstancedStaticMeshComponentの設定">InstancedStaticMeshComponentの設定</h3>


    

InstancedStaticMeshComponentの Num Custom Data Floats に 1 を設定してInstance毎にfloat1つのCustomDataを使えるようにします。


<figure class="figure-image figure-image-fotolife" title="InstancedStaticMeshのNumCustomDataFloats"><span itemscope itemtype="http://schema.org/Photograph"><img src="images/6b53670c13dd4ee400b1f013789a542c6c9f22f838169dd9c1d4842783d385a3.png" alt="f:id:nagakagachi:20201121204146p:plain" width="369" height="237" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><figcaption>InstancedStaticMeshのNumCustomDataFloats</figcaption></figure>
</div>
<div class="section">
    

<h3 id="Instance番号をCustomDataに設定">Instance番号をCustomDataに設定</h3>


<p>InstancedStaticMeshComponentのSetCustomDataValueで各InstanceのCustomDataにInstance番号を設定します。<br />
マテリアル側からはこのCustomDataに入ったInstance番号を利用して、対応するテクスチャ位置から情報を読み取ります。<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/f2f1999395830f754234176fa8fe541ecf78460487ec429d91e778daa3a9f939.png" alt="f:id:nagakagachi:20201203214608p:plain" width="1200" height="465" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span></p>





</div>
<div class="section">
    

<h3 id="Instanceの基準位置をテクスチャに書き込み">Instanceの基準位置をテクスチャに書き込み</h3>


<p>先に用意した4つのテクスチャの内、<b>基準位置テクスチャ</b>についてはBPから書き込みを行います。<br />
まずInstance番号に対応するテクセル座標を以下のように求めます。<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/b42e208b83008157ee030d735ad11bc2bca9623f52d70b6ae2ebd6121e67e47f.png" alt="f:id:nagakagachi:20201203212604p:plain" width="1200" height="443" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><br />
<span class="math-inline">\(pos.y = int(Index / Width)\)</span><br />
<span class="math-inline">\(pos.x = Index - pos.y * Width\)</span></p><p>実際の書き込みではまずBeginDrawCanvastoRenderTargetで開始を宣言し、<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/27a79143e2dbc2caabd700b4ffad4aae73176799a4d32ad201c5c7c99f0d47da.png" alt="f:id:nagakagachi:20201203215135p:plain" width="419" height="330" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><br />
Instanceの数だけDrawLineで対応する情報を色として書き込んでいきます。<br />
開始位置は先に説明した計算で求め、終了位置は<span class="math-inline">\(0.5,0.5\)</span> だけオフセットした位置にします。<br />
(これでうまくいってますがもっと良い方法があるかも)<br />
今回は基準位置(XYZ座標)を書き込みたいのでColorのRGBに座標をそのまま設定します。<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/015d1560edd12543fb0b125a906009cf0ddad159dc6e29a045d534a39d5b2a97.png" alt="f:id:nagakagachi:20201203215016p:plain" width="1200" height="607" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><br />
全部終わったらEndDrawCanvastoRenderTargetで完了します。<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/e320e93c63c3427a6a0432af8f21a8d250982a17e343318f99ebaae8b9d819d3.png" alt="f:id:nagakagachi:20201203215155p:plain" width="487" height="197" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span></p>

ここまででInstanceの基準位置が左上から右下へ順番に書き込まれたテクスチャが完成します。


<figure class="figure-image figure-image-fotolife" title="100個のInstance位置を書き込んだ16x16基準位置テクスチャ可視化"><span itemscope itemtype="http://schema.org/Photograph"><img src="images/138876e162f672e62cd711ec0c28328c1b5eb50abba5cebc37a1651d9e845660.png" alt="f:id:nagakagachi:20201214235009p:plain" width="1200" height="675" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><figcaption>100個のInstance位置を書き込んだ16x16基準位置テクスチャ可視化</figcaption></figure><p><a href="#f-38afc54b" name="fn-38afc54b" title="基本的にこの処理はマテリアルへ渡したい情報に変更があったときに実行することになります。
今回はInstanceの位置は生成時点から変化しないので初期化時の一回のみです。">*1</a><br />
</p>

</div>
<div class="section">
    

<h3 id="変位テクスチャによってメッシュを動かすマテリアル">変位テクスチャによってメッシュを動かすマテリアル</h3>


<p>InstancedStaticMeshに設定して頂点を動かすマテリアルです。<br />
TextureParameterとして基準位置からの変位テクスチャを設定しています。<br />
InstancedStaticMeshのCustomDataに設定したInstance番号を元に、変位テクスチャから対応する変位量を取得してWorldPositionOffsetで頂点を動かします。<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/59d667d16400a986fa327ae5919967f1d31c59e28a53081fd546e0a95ed01b0b.png" alt="f:id:nagakagachi:20201206234848p:plain" width="1200" height="767" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span></p><p>まず PerInstanceCustomDataでInstancedStaticMeshComponentに設定したInstance毎のCustomDataの値を取得できます。<br />
このCustomDataには先に設定したInstance番号が入っています。<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/437ce540586a3e5423b7c18089172bc9c337fbcf9f52a743d7d4b0c92dcf909c.png" alt="f:id:nagakagachi:20201206220229p:plain" width="474" height="214" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span></p>

Instance番号とテクスチャサイズから対応するUV座標を計算し、このInstanceに対応する変位情報をテクスチャから取得します。


<figure class="figure-image figure-image-fotolife" title="Instance番号に対応するUVでテクスチャから情報取得"><span itemscope itemtype="http://schema.org/Photograph"><img src="images/bc5c0fa01a6e520f42d646dcb4e16a3eed19b71994d0be0e3a2c57e1777e6e0b.png" alt="f:id:nagakagachi:20201206234926p:plain" width="1114" height="586" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><figcaption>Instance番号に対応するUVでテクスチャから情報取得</figcaption></figure><p>UV座標の計算は以下のようなネットワークになります。<a class="keyword" href="http://d.hatena.ne.jp/keyword/Canvas">Canvas</a>に書き込むときの座標計算の同じです(こちらはテクセル座標ではなくUVであることにだけ注意)。</p>
<figure class="figure-image figure-image-fotolife" title="Instance番号とテクスチャサイズから対応するUV計算"><span itemscope itemtype="http://schema.org/Photograph"><img src="images/b3b71784c2bb8a36dd01911168bb08bfda464a513bc843f747d35ed60ee94b2c.png" alt="f:id:nagakagachi:20201206220813p:plain" width="1200" height="424" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><figcaption>Instance番号とテクスチャサイズから対応するUV計算</figcaption></figure><p>ここまででメッシュのマテリアルと変位テクスチャをつなぎましたが、まだ変位テクスチャを更新していないのでメッシュは動きません。<br />
このあとプレイヤーとのインタ<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%E9%A5%AF">ラク</a>ションを含めたバネのシミュレーションをマテリアルで計算して変位テクスチャを更新することでメッシュが動くようになります。<br />
(まだ変位テクスチャの更新処理を作ってないので動きませんが)</p>

</div>
<div class="section">
    

<h3 id="変位テクスチャ更新マテリアル">変位テクスチャ更新マテリアル</h3>


<p>変位テクスチャを更新するマテリアルを用意します。<br />
このマテリアルはMeshに設定するのではなく、<a href="https://docs.unrealengine.com/en-US/BlueprintAPI/Rendering/DrawMaterialtoRenderTarget/index.html">Draw Material To RenderTarget</a> でRenderTargetTextureを更新するために使います。<br />
このマテリアルはInstance番号などを気にする必要はなく、描画UVと同じUVでテクスチャから情報を取り出して計算するだけです。<br />
(同じテクセル位置には同じInstanceの情報が格納されているので)<br />
速度テクスチャと前回の変位テクスチャを元にバネ-ダンパモデルの計算をして新しい変位を求めます。</p>
<figure class="figure-image figure-image-fotolife" title="速度と変位からバネ-ダンパモデルで新しい変位を計算"><span itemscope itemtype="http://schema.org/Photograph"><img src="images/f9a300b1acff56354457bca2fb90b0afbbf872f9c5686b75403ddff4bc5286b7.png" alt="f:id:nagakagachi:20201206224233p:plain" width="1115" height="568" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><figcaption>速度と変位からバネ-ダンパモデルで新しい変位を計算</figcaption></figure><p>プレイヤーとのインタ<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%E9%A5%AF">ラク</a>ションは単純な球と点の当たり判定としています。<br />
注意点として、変位テクスチャは基準位置からの変位量の情報なので、ワールド座標であるプレイヤー位置との比較のためには同じワールド座標に変換する必要があります。<br />
そのために基準位置テクスチャの値と変位を足し合わせてからプレイヤー位置との比較をしています。</p>
<figure class="figure-image figure-image-fotolife" title="プレイヤー球とのヒット"><span itemscope itemtype="http://schema.org/Photograph"><img src="images/3325181daaee0466be00d1407a34b428720badb9e87c5a3cdd2777248a376108.png" alt="f:id:nagakagachi:20201206224521p:plain" width="1200" height="455" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><figcaption>プレイヤー球とのヒット</figcaption></figure>

また、変位はマイナスを取る可能性があるのでマテリアルの設定でマイナスのEmissiveを許可するようにしておきます。


<figure class="figure-image figure-image-fotolife" title="Emissive出力の負値を許可"><span itemscope itemtype="http://schema.org/Photograph"><img src="images/fea4dddfc4c469b830779e60cd7ea2f864a2cb5501961cf694a134a76ba3f56a.png" alt="f:id:nagakagachi:20201123000813p:plain" width="292" height="182" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><figcaption>Emissive出力の負値を許可</figcaption></figure>

サンプルプロジェクトを見ていただくのが早いと思いますが、このマテリアルにはTextureParameterとして「基準位置からの変位(前フレーム)」や「速度」のテクスチャを設定し、Draw Material to RenderTargetのターゲットとして「基準位置からの変位(今フレーム)」を指定することで変位テクスチャを更新します。



</div>
<div class="section">
    

<h3 id="速度テクスチャ更新マテリアル">速度テクスチャ更新マテリアル</h3>


<p>変位テクスチャが更新されたので新たに速度テクスチャを計算し直します。<br />
このマテリアルも変位テクスチャ更新のものと同様に Draw Material to Render Target で利用するため、Instance番号などを気にする必要はありません。<br />
前回の変位と今回の変位の差分から速度を計算して出力する単純なものになります。<br />
<span class="math-inline">\(vel_ = \frac {pos_{t} - pos_{t-1}} {\Delta t}\)</span></p>
<figure class="figure-image figure-image-fotolife" title="速度テクスチャ更新マテリアル"><span itemscope itemtype="http://schema.org/Photograph"><img src="images/03a4a1a71ce91769777b65881249184b1a8f2c6807f0719983e3792005fe75b5.png" alt="f:id:nagakagachi:20201206225008p:plain" width="1200" height="722" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><figcaption>速度テクスチャ更新マテリアル</figcaption></figure>

このマテリアルも変位テクスチャ更新と同様にマイナスのEmissiveを許可するようにしておきます。



このマテリアルにはTextureParameterとして「基準位置からの変位(前フレーム)」と「基準位置からの変位(今フレーム)」のテクスチャを設定し、Draw Material to RenderTargetのターゲットとして「速度」のテクスチャを指定することで速度テクスチャを更新します。

<br />


これでようやくマテリアルによる変位と速度の更新, Instance毎の変位の取得と頂点移動表現がつながって動くようになります。  
  
この記事では省略している部分もありますが、実際の処理の流れはサンプルプロジェクトの方を参考にしていただければ幸いです。



</div>
<div class="section">
    

<h3 id="まとめ">まとめ</h3>


<p>以上でInstancedStaticMeshのInstance毎にテクスチャにパラメータを格納、更新して個別の振る舞いをさせることができるようになりました。<br />
今回はInstanceの基準位置を<a class="keyword" href="http://d.hatena.ne.jp/keyword/Canvas">Canvas</a>を利用してテクスチャとしてマテリアルに渡していますが、この方法は色々な使い方ができるのではないかと思います。<br />
また、ただのCubeではなく植物のメッシュを大量に表示しつつ個別に揺れたりさせたい場合にも使えると思います。<br />
<iframe width="560" height="315" src="https://www.youtube.com/embed/onYt8dYPGFs?feature=oembed" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe><cite class="hatena-citation"><a href="https://youtu.be/onYt8dYPGFs">youtu.be</a></cite><br />
<blockquote data-conversation="none" class="twitter-tweet" data-lang="ja"><p lang="ja" dir="ltr">こんなことしてる場合じゃない <a href="https://t.co/eJSdH9bcdd">pic.twitter.com/eJSdH9bcdd</a></p>&mdash; なが (@nagakagachi) <a href="https://twitter.com/nagakagachi/status/1330715452452995072?ref_src=twsrc%5Etfw">2020年11月23日</a></blockquote> <script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script> </p><p><a class="keyword" href="http://d.hatena.ne.jp/keyword/Twitter">Twitter</a>でこんなことをしていますのでフォローしていただけるとうれしいです<br />
<a href="https://twitter.com/nagakagachi">&#x306A;&#x304C; (@nagakagachi) | Twitter</a></p><br />
<p><b>明日は Dv7Pavilion さんの Influence Map に関する記事とのことです！</b><br />
<iframe src="https://hatenablog-parts.com/embed?url=https%3A%2F%2Fqiita.com%2Fadvent-calendar%2F2020%2Fue4" title="Unreal Engine 4 (UE4) Advent Calendar 2020 - Qiita" class="embed-card embed-webcard" scrolling="no" frameborder="0" style="display: block; width: 100%; height: 155px; max-width: 500px; margin: 10px 0px;"></iframe><cite class="hatena-citation"><a href="https://qiita.com/advent-calendar/2020/ue4">qiita.com</a></cite></p><br />
<br />
<br />
<br />
<br />





<figure class="figure-image figure-image-fotolife" title="サムネイル用"><span itemscope itemtype="http://schema.org/Photograph"><img src="images/4401bfee4e759fc09d24cd21a2dd0b8cdf2963e461c7c4440ddd204f49232b0a.png" alt="f:id:nagakagachi:20201215000807p:plain" width="1200" height="687" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><figcaption>サムネイル用</figcaption></figure>
</div><div class="footnote">
<p class="footnote"><a href="#fn-38afc54b" name="f-38afc54b" class="footnote-number">*1</a><span class="footnote-delimiter">:</span><span class="footnote-text">基本的にこの処理はマテリアルへ渡したい情報に変更があったときに実行することになります。
今回はInstanceの位置は生成時点から変化しないので初期化時の一回のみです。</span></p>
</div>

---

[元のはてなブログ記事](https://nagakagachi.hatenablog.com/entry/UE4_AdventCalendar2020_a)
