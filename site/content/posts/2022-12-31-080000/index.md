---
title: "DepthPrepass有効時のCoplanar PolygonによるGPU負荷増大 [UE][Rendering]"
date: "2022-12-31T08:00:00+09:00"
draft: false
url: "/entry/2022/12/31/080000/"
categories: ["Graphics", "Material", "Mesh", "UE5", "UE4"]
hatena_author: "nagakagachi"
hatena_original_url: "https://nagakagachi.hatenablog.com/entry/2022/12/31/080000"
hatena_basename: "2022/12/31/080000"
math: false
image: "images/59936b850442a7a395812d241e30d7fbdf9a56980124ad6698d1b70727d32ba8.png"
---

<p>DepthPrepass<a class="keyword" href="https://d.hatena.ne.jp/keyword/%A5%EC%A5%F3%A5%C0%A5%EA%A5%F3%A5%B0">レンダリング</a>に関連して, <br />モデルやレベルの作りによって<a class="keyword" href="https://d.hatena.ne.jp/keyword/GPU">GPU</a>負荷が増大してしまう特殊な状況について説明します.</p>
<div class="section">


<h3 id="問題">問題</h3>


<p>同一平面で重なり合うポリゴン(<em>Coplanar Polygon</em>)は, 重なりの数だけBasePass PixelShaderが実行される可能性があります.<br /><u>これにより本来DepthPrepass環境で除去される不要なBasePass負荷が追加で発生します.</u></p>
<blockquote>
<p><span style="font-size: 50%;">同一平面で重なり合うポリゴン を <u>Coplanar Polygon</u> と呼んでいます.<br />Lamina Faces や Z-Fighting状態のポリゴン というような表現もあると思います.<br />もっと良い呼び名があれば教えてください!</span></p>
</blockquote>
<p><br />以下のサンプルシーンは<u>Opaque</u>で適当ワールドノイズマテリアルのCubeをいくつか配置した状態です.<br />よくOverDraw負荷が問題となる半透明が無いシーンなので安心と思いきや, 表示モードを「シェーダ複雑度」へ切り替えてみると.</p>
<figure class="figure-image figure-image-fotolife" title="サンプルシーン"><img src="images/c272dc256ecc74375b4877e418f9aece697a71c86bd6127d341d415a59f7952a.png" width="1200" height="819" loading="lazy" title="" class="hatena-fotolife" style="width: 250px;" itemprop="image" /> <img src="images/a677d850b9bfe572bc8a5c7266cf9e69dddd2dcab9c69a6e33f03b69da90597a.png" width="1200" height="814" loading="lazy" title="" class="hatena-fotolife" style="width: 250px;" itemprop="image" />
<figcaption>サンプルシーン</figcaption>
</figure>
<p><u>何故か高負荷を示す真っ白な部分があります</u>.</p>
<p>RenderDocでキャプチャして 「<u>Quad Over Draw (Pass)</u>」でOverDrawを確認します.</p>
<figure class="figure-image figure-image-fotolife" title="RenderDoc Quad Over Draw (Pass)"><img src="images/5581b84e591e4b8ad0c9549404a169faf37c5f1d03c470168dc9ee1e23b48d5a.png" width="1020" height="666" loading="lazy" title="" class="hatena-fotolife" itemprop="image" />
<figcaption>RenderDoc Quad Over Draw (Pass)</figcaption>
</figure>


RenderDoc上でも確かに右側の配置でBasePassのOverDrawが発生しているようです.


<p>BasePassではDeferredの場合はGBuffer書き込み, Forwardであれば複雑なLighting計算が実行されるため,本来実行されないはずのOpaqueでのBasePass OverDrawは<a class="keyword" href="https://d.hatena.ne.jp/keyword/GPU">GPU</a>負荷に大きな影響を与えます.</p>
</div>
<div class="section">


<h3 id="原因">原因</h3>




この問題の原因は深度が完全に一致するポリゴンが複数重なっている点と, DepthPrepass有りBasePassの仕組みの関係によるものです.


<p>まずシーンの配置ですが, 左側の配置と同じ3つのCubeをポリゴンが重なるように配置しています <a href="#f-9dd25646" id="fn-9dd25646" name="fn-9dd25646" title="1モデル内のポリゴン同士でも, レベルに配置した別モデルのポリゴン同士でも関係なくこの問題は発生します.">*1</a>.<br /><img src="images/86f7777de4998b3ffd7e612339bc77651597f293595d2c33f3f21683589a12c9.png" width="1200" height="817" loading="lazy" title="" class="hatena-fotolife" style="width: 250px;" itemprop="image" /> <img src="images/c48411fd5c3bc351c2e59974c39d4469d52a31f9e23dbb2a29b1f67fa3b605fb.png" width="1200" height="813" loading="lazy" title="" class="hatena-fotolife" style="width: 250px;" itemprop="image" /></p>
<p>このような状況では, DepthPrepass有効時のBasePassは重なり合ったポリゴンそれぞれについて全て実行されてしまい, 高負荷なBasePassが何度も実行されることにより<a class="keyword" href="https://d.hatena.ne.jp/keyword/GPU">GPU</a>負荷を増大させます.</p>
</div>
<div class="section">


<h3 id="BasePassが複数回実行される理由">BasePassが複数回実行される理由</h3>


<p>本来のDepthPrepass手法は, DepthPreapssで先に生成したDepthBufferを頼りに, 各Meshの可視<a class="keyword" href="https://d.hatena.ne.jp/keyword/%A5%D4%A5%AF%A5%BB%A5%EB">ピクセル</a>のマテリアルBasePass PixelShaderだけを最小限実行することで高速化するためのものです.<br />例として背景, 円柱, 板で構成されたシーンのDepthPrepass有りBasePassの挙動を以下に示します.<br />右側図の緑色部分がDepthTestを通過してBasePassのPixelShaderが実行された<a class="keyword" href="https://d.hatena.ne.jp/keyword/%A5%D4%A5%AF%A5%BB%A5%EB">ピクセル</a>になります.</p>
<ol>
<li>DepthPrepassでDepthBufferが完成
<ul>
<li><img src="images/59936b850442a7a395812d241e30d7fbdf9a56980124ad6698d1b70727d32ba8.png" width="1070" height="714" loading="lazy" title="" class="hatena-fotolife" style="width: 250px;" itemprop="image" /></li>
</ul>
</li>
<li>円柱モデルBasePass描画
<ul>
<li><img src="images/0a300dab9c592601ce13587e02a2a295ec8497277f6896b50f330d7bd3997ca2.png" width="1068" height="711" loading="lazy" title="" class="hatena-fotolife" style="width: 250px;" itemprop="image" /> <img src="images/a43c6b573e3814646727af503df327c0499aa2723e377fab7ca90b0df466c219.png" width="1069" height="713" loading="lazy" title="" class="hatena-fotolife" style="width: 250px;" itemprop="image" /></li>
</ul>
</li>
<li>背景モデルBasePass描画
<ul>
<li><img src="images/a51f5fb7597a3719fb354d1e0cada8730dccd901c7346a72f6e4c0744198105a.png" width="1070" height="714" loading="lazy" title="" class="hatena-fotolife" style="width: 250px;" itemprop="image" /> <img src="images/803ab8d758963f5b703032bfb6984ce851646438c5a167151baefa3f2d22dc78.png" width="1069" height="712" loading="lazy" title="" class="hatena-fotolife" style="width: 250px;" itemprop="image" /></li>
</ul>
</li>
<li>板モデルBasePass描画
<ul>
<li><img src="images/536d0d26f787eb50b831f285ab440bd31a185067995c2c3b24adf697416e7c76.png" width="1071" height="712" loading="lazy" title="" class="hatena-fotolife" style="width: 250px;" itemprop="image" /> <img src="images/3269379750a785f5ea7673a9ba4273e00a4526ccb8514482654abfa5c4fce4ff.png" width="1070" height="712" loading="lazy" title="" class="hatena-fotolife" style="width: 250px;" itemprop="image" /></li>
</ul>
</li>
</ol>


各モデルのBasePassが, 最終的に画面に見えている部分でだけ働いているのがわかると思います.  
このようにBasePassが無駄に実行されないようにして高速化するというのがDepthPrepassの目的となります.




これを実現するためにBasePassは


<blockquote>


DepthWrite=OFF 且つ DepthTest=GreaterEqual


</blockquote>
<p>という設定をされます <a href="#f-9b586fdf" id="fn-9b586fdf" name="fn-9b586fdf" title="GreaterEqualなのはReverseZ環境でのことで, StandardZの場合はLessEqualです.">*2</a>.</p>
<blockquote>
<p><span style="font-size: 80%;">指摘がありましたので追記-&gt; Maskedを含めたマテリアルをDepthPrePassを利用してEarlyZ有効で効率的に描画するために Equal なDepthTestで描画する場合があります. 本件のシーンではOpaqueを対象とし且つRenderDocキャプチャ等も確認したところGreaterEqualであったためこのように記述しています(UE5.3).</span></p>
</blockquote>







この設定によって, 各モデルのBasePass描画では


<blockquote>
<p>DepthPrepassで確定した深度値に対して<br /><u><strong>同じか</strong></u>それより近い場合にのみ描画する</p>
</blockquote>


という挙動をすることになります.


<p>この <u><strong>同じかそれより近い</strong></u> という点と, 深度が完全に一致してしまう Coplanar Polygon の関係によって今回のような問題が起きています.</p>
</div>
<div class="section">


<h3 id="終わり">終わり</h3>




Opaqueであるにも関わらずOverDrawによってBasePass負荷を増加させるCoplanar Polygonと, 関連したDepthprepassの簡単な説明でした.  
この問題はときに異常な高負荷を発生させ, 更に原因がわかりにくいという厄介さを持っています (UE5ではシェーダ複雑度で確認できますが).   
またMaskedでも同様に問題が起きます.




モデル制作やレベル配置をする際には多少気をつけてもらえると最適化担当の人間に平穏がもたらされます.




この記事が2022最後の記事となります, 良いお年を.


<div class="section">
<h4 id="おまけ"><span style="color: #999999;">おまけ</span></h4>
<p><span style="color: #999999;"><br />最後に問題のCoplanar Polygon状況でのRenderDocキャプチャを貼っておきます.<br />問題のない配置とCoplanar Polygon配置.<br />右図の緑がDepthTest通過<a class="keyword" href="https://d.hatena.ne.jp/keyword/%A5%D4%A5%AF%A5%BB%A5%EB">ピクセル</a>表示.<br />OverDrawが発生している重なり部分でどのDrawでもDepthTest通過してしまっているのがわかります.</span></p>
<ol>
<li><img src="images/420054d796e3671b0decb23d014bffd0b0eaa2ab94a4e685abfe706da54865e3.png" width="1021" height="668" loading="lazy" title="" class="hatena-fotolife" style="width: 250px;" itemprop="image" /> <img src="images/685d469a5450aa581dc7f14c17c6bf3535eaf864b6ce5a8ccf9e6ff96716634c.png" width="1021" height="669" loading="lazy" title="" class="hatena-fotolife" style="width: 250px;" itemprop="image" /></li>
<li><img src="images/313cbb243176367fba40f0a3d41e63d14a847e53bf33774e9f3dc08f37b8a34d.png" width="1019" height="669" loading="lazy" title="" class="hatena-fotolife" style="width: 250px;" itemprop="image" /> <img src="images/56bf7ea4e789ab74d25f1749fdff1b1c483cda0a6b27a6325aaf5f6d4eef84a1.png" width="1018" height="667" loading="lazy" title="" class="hatena-fotolife" style="width: 250px;" itemprop="image" /></li>
<li><img src="images/9b6f877c74535092b01f3f57336c956f4eac56e38b6d1cc1afac2441a92d709e.png" width="1019" height="664" loading="lazy" title="" class="hatena-fotolife" style="width: 250px;" itemprop="image" /> <img src="images/2d3d246d78ed9c513b4a22e8cb5963851dd5e83829e9972da2fea8ed7c84b5da.png" width="1021" height="666" loading="lazy" title="" class="hatena-fotolife" style="width: 250px;" itemprop="image" /></li>
</ol>
</div>
</div>
<div class="section">


<h3 id="参考文献">参考文献</h3>


<ul>
<li>DepthPrepass(Z Prepass) 自体についてはこちらの神資料等がわかりやすいと思います.
<ul>
<li><a href="https://www.docswell.com/s/EpicGamesJapan/KVP8JK-cedec2016-unreal-engine-4#p1">CEDEC2016: Unreal Engine 4 のレンダリングフロー総おさらい | ドクセル</a></li>
</ul>
</li>
<li>当記事とはあまり関係ないですがMaskedのDepthEqual描画等についての神神資料です.
<ul>
<li><a href="https://www.docswell.com/s/EpicGamesJapan/ZJ9R1K-mask-material-only-in-early-zpass#p1">Mask Material only in Early Z-passの効果と仕組み | ドクセル</a></li>
</ul>
</li>
</ul>
</div>
<div class="footnote">
<p class="footnote"><a href="#fn-9dd25646" id="f-9dd25646" name="f-9dd25646" class="footnote-number">*1</a><span class="footnote-delimiter">:</span><span class="footnote-text">1モデル内のポリゴン同士でも, レベルに配置した別モデルのポリゴン同士でも関係なくこの問題は発生します.</span></p>
<p class="footnote"><a href="#fn-9b586fdf" id="f-9b586fdf" name="f-9b586fdf" class="footnote-number">*2</a><span class="footnote-delimiter">:</span><span class="footnote-text">GreaterEqualなのはReverseZ環境でのことで, StandardZの場合はLessEqualです.</span></p>
</div>

---

[元のはてなブログ記事](https://nagakagachi.hatenablog.com/entry/2022/12/31/080000)
