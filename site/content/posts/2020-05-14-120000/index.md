---
title: "UE5の発表についてのメモ"
date: "2020-05-14T12:00:00+09:00"
draft: false
url: "/entry/2020/05/14/120000/"
categories: ["UE5", "Graphics", "UE4"]
hatena_author: "nagakagachi"
hatena_original_url: "https://nagakagachi.hatenablog.com/entry/2020/05/14/120000"
hatena_basename: "2020/05/14/120000"
math: false
image: "images/680ed60850f8b2a6024cd37b26e36b24381350ceb4d4f9c9ee5dab290ed45f5f.png"
---

<p><s>In-house Engineでこれと戦わなきゃいけないってマジ？</s></p><p>PlayStation5 上で動作している <a class="keyword" href="http://d.hatena.ne.jp/keyword/Unreal%20Engine">Unreal Engine</a> 5 のデモが発表されたので、この時点で感じたことなど覚えておくためにメモ。</p><p>目玉は動的GIシステムLumenと微細ジオメトリの<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%EC%A5%F3%A5%C0%A5%EA%A5%F3%A5%B0">レンダリング</a>を実現するNanite。<br />
<iframe src="https://hatenablog-parts.com/embed?url=https%3A%2F%2Fwww.unrealengine.com%2Fja%2Fblog%2Fa-first-look-at-unreal-engine-5%3Flang%3Dja" title="Unreal Engine 5 初公開" class="embed-card embed-webcard" scrolling="no" frameborder="0" style="display: block; width: 100%; height: 155px; max-width: 500px; margin: 10px 0px;"></iframe><cite class="hatena-citation"><a href="https://www.unrealengine.com/ja/blog/a-first-look-at-unreal-engine-5?lang=ja">www.unrealengine.com</a></cite></p>
<ul class="table-of-contents">
<li><a href="#Lumen-動的GI">Lumen (動的GI)</a></li>
<li><a href="#Nanite-仮想化マイクロポリゴンジオメトリ">Nanite (仮想化マイクロポリゴンジオメトリ)</a></li>
<li><a href="#Niagara">Niagara</a></li>
<li><a href="#流体シミュレーション">流体シミュレーション</a></li>
<li><a href="#Chaos">Chaos</a></li>
<li><a href="#アニメーションシステム">アニメーションシステム</a></li>
<li><a href="#感想">感想</a></li>
</ul>
<div class="section">
    

<h3 id="Lumen-動的GI">Lumen (動的GI)</h3>


<p>動的なGlobal IlluminationシステムでDiffuse及びSpecular間接光を<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%EC%A5%F3%A5%C0%A5%EA%A5%F3%A5%B0">レンダリング</a>する。<br />
動的なライトは最近のGIだと半分当然のようなところがあるが、動的なジオメトリはどこまでサポートされるのか気になる。<br />
レイトレハードウェアは使ってないらしいのでCompute Shaderによるものか、EnlightenのようにCPU側で非同期計算する方式なのか。<figure class="figure-image figure-image-fotolife" title="LumenによるGI有効"><span itemscope itemtype="http://schema.org/Photograph"><img src="images/680ed60850f8b2a6024cd37b26e36b24381350ceb4d4f9c9ee5dab290ed45f5f.png" alt="f:id:nagakagachi:20200514071027p:plain" title="f:id:nagakagachi:20200514071027p:plain" class="hatena-fotolife" itemprop="image"></span><figcaption>LumenによるGI有効</figcaption></figure><figure class="figure-image figure-image-fotolife" title="GI無し"><span itemscope itemtype="http://schema.org/Photograph"><img src="images/a84bdee9f74fb5bd111fbb0bfc1948a7a3f2229a6952b73f2cad6064cb25fa4f.png" alt="f:id:nagakagachi:20200514071116p:plain" title="f:id:nagakagachi:20200514071116p:plain" class="hatena-fotolife" itemprop="image"></span><figcaption>GI無し</figcaption></figure></p>





</div>
<div class="section">
    

<h3 id="Nanite-仮想化マイクロポリゴンジオメトリ">Nanite (仮想化マイクロポリゴンジオメトリ)</h3>


<p>Texture-StreamingのようにジオメトリをStreamingし、<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%D4%A5%AF%A5%BB%A5%EB">ピクセル</a>レベルのジオメトリ描画を可能にする。<br />
デモでは10億Triを超えるソースジオメトリを、Naniteが適切にコン<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%C8%A5%ED%A1%BC%A5%EB">トロール</a>して2000万Triのジオメトリを描画しているらしい。<figure class="figure-image figure-image-fotolife" title="もはやノイズにしか見えないトライアングル群"><span itemscope itemtype="http://schema.org/Photograph"><img src="images/1051d3b5480215bf9fb7c9b059eba35139f999b4c33708b3b913b4cf8322a03d.png" alt="f:id:nagakagachi:20200514070258p:plain" title="f:id:nagakagachi:20200514070258p:plain" class="hatena-fotolife" itemprop="image"></span><figcaption>もはやノイズにしか見えないトライアングル群</figcaption></figure>DCCツールでの特別な作業は不要で、<a class="keyword" href="http://d.hatena.ne.jp/keyword/ZBRush">ZBRush</a>などで作ったものをそのままインポート可能。<br />
いままでNormalMapで表現していたディ<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%C6%A5%A3%A1%BC">ティー</a>ルをジオメトリによって直接表現する。<br />
LoDもNaniteがやってくれる。</p>

</div>
<div class="section">
<h3 id="Niagara"><a class="keyword" href="http://d.hatena.ne.jp/keyword/Niagara">Niagara</a></h3>
<p>エフェクト以外にもコウモリや蟲の群れなどにも<a class="keyword" href="http://d.hatena.ne.jp/keyword/Niagara">Niagara</a>を利用している。<br />
パーティクル同士の通信や環境の知覚などもできるらしい。<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/e72ea0bc52f8a0fecd0a8166001aba95939376e4dc15fe84d85df347bd52e3e8.png" alt="f:id:nagakagachi:20200514072020p:plain" title="f:id:nagakagachi:20200514072020p:plain" class="hatena-fotolife" itemprop="image"></span><br />
</p>

</div>
<div class="section">
    

<h3 id="流体シミュレーション">流体シミュレーション</h3>


<p>さらっと流されたけど流体シミュレーション。<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/c7d7a0b043b5c9918422647928809b18d6bed35a60e1f489f9c0ef0723678e35.png" alt="f:id:nagakagachi:20200514072246p:plain" title="f:id:nagakagachi:20200514072246p:plain" class="hatena-fotolife" itemprop="image"></span><br />
</p>

</div>
<div class="section">
    

<h3 id="Chaos">Chaos</h3>


<p>スカーフのClothシミュレーションや落石にはChaosを使用。<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/869cc4ea7f5c126866c715ab15a729a2a74db68e34e1bc52ae05293ed2d12b03.png" alt="f:id:nagakagachi:20200514072548p:plain" title="f:id:nagakagachi:20200514072548p:plain" class="hatena-fotolife" itemprop="image"></span><br />
</p>

</div>
<div class="section">
    

<h3 id="アニメーションシステム">アニメーションシステム</h3>


<p>複雑な環境に適応した動きのために手足の適切な位置を予測して動的に調整している。<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/3b380675f52743cd83437ca1f708e6464493531249d3dc428b2b1b2e41d09308.png" alt="f:id:nagakagachi:20200514072711p:plain" title="f:id:nagakagachi:20200514072711p:plain" class="hatena-fotolife" itemprop="image"></span></p><p>シームレスなコンテキストベースのアニメーションイベント(よくわからない)。<br />
デモ中の扉に手を添える動きに使われているとのこと。<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/6394563b8d7682087b98f63feb674fa4295bc53bcb5e66ae25b6ae92a4743510.png" alt="f:id:nagakagachi:20200514073309p:plain" title="f:id:nagakagachi:20200514073309p:plain" class="hatena-fotolife" itemprop="image"></span></p><br />






</div>
<div class="section">
    

<h3 id="感想">感想</h3>


<p>NormalMapレベルの凹凸をジオメトリで表現してしまえというEpicの解答。Nanite向けのデータを作るためにワークフローが大きく変わりそう。<br />
現代のリアルタイム<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%EC%A5%F3%A5%C0%A5%EA%A5%F3%A5%B0">レンダリング</a>ではジオメトリよりも微細な凹凸を<b>NormalMap</b>、更に細かい法線分布のために<b>RoughnessMap</b>が使われているが、NormalMapが担っていた領域をジオメトリで表現できるようになるとそのあたりの役割も変わってくるのだろうか。<br />
RoughnessMapよりも更に細かいナノスケール表面構造を表現する<b>StructuralMap</b>が使われるようになって<b>構造色<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%EC%A5%F3%A5%C0%A5%EA%A5%F3%A5%B0">レンダリング</a></b>されるようになったり？<br />
<iframe src="https://hatenablog-parts.com/embed?url=https%3A%2F%2Fja.wikipedia.org%2Fwiki%2F%25E6%25A7%258B%25E9%2580%25A0%25E8%2589%25B2" title="構造色 - Wikipedia" class="embed-card embed-webcard" scrolling="no" frameborder="0" style="display: block; width: 100%; height: 155px; max-width: 500px; margin: 10px 0px;"></iframe><cite class="hatena-citation"><a href="https://ja.wikipedia.org/wiki/%E6%A7%8B%E9%80%A0%E8%89%B2">ja.wikipedia.org</a></cite></p><br />
<p>あと大したことでは無いけれど気になったのが、3:50付近で右肘の下あたりの水面に一瞬 Screen Space処理っぽい動きが見えた点。肘の動きに合わせて水面のなにかが動いているように見えるけど、部分的に Screen Space Local Reflection をしていたりするのだろうか？(<b>そもそも気のせいかも</b>)<figure class="figure-image figure-image-fotolife" title="3:50付近"><span itemscope itemtype="http://schema.org/Photograph"><img src="images/5f4e30383d36c9623204f2b6f3b99e87907991189335b738d255e4d66a8b92c1.png" alt="f:id:nagakagachi:20200514082221p:plain" title="f:id:nagakagachi:20200514082221p:plain" class="hatena-fotolife" itemprop="image"></span><figcaption>3:50付近</figcaption></figure></p><br />
<p>こんな恐ろしいものが出てくる時代でこの<a class="keyword" href="http://d.hatena.ne.jp/keyword/%C0%E8%C0%B8%A4%AD%A4%CE%A4%B3%A4%EB">先生きのこる</a>ことができるのか。</p><br />
<br />
<p>5/15追記<br />
UE5デモの技術解説<br />
<iframe src="https://hatenablog-parts.com/embed?url=https%3A%2F%2Fwww.eurogamer.net%2Farticles%2Fdigitalfoundry-2020-unreal-engine-5-playstation-5-tech-demo-analysis" title="Inside Unreal Engine 5: how Epic delivers its generational leap" class="embed-card embed-webcard" scrolling="no" frameborder="0" style="display: block; width: 100%; height: 155px; max-width: 500px; margin: 10px 0px;"></iframe><cite class="hatena-citation"><a href="https://www.eurogamer.net/articles/digitalfoundry-2020-unreal-engine-5-playstation-5-tech-demo-analysis">www.eurogamer.net</a></cite></p><p>一部が削除されたらしいので画像で残しておく<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/b79733c9c46da7f4b5bb81e6a11ce391515ea2c945561ed8fc1deb7ebf424902.png" alt="f:id:nagakagachi:20200515071553p:plain" title="f:id:nagakagachi:20200515071553p:plain" class="hatena-fotolife" itemprop="image"></span></p>

</div>

---

[元のはてなブログ記事](https://nagakagachi.hatenablog.com/entry/2020/05/14/120000)
