---
title: "セルシェーディング顔陰用SDFテクスチャ合成の仕組み (SDF Based Transition Blending for Shadow Threshold Map)"
date: "2024-03-02T14:07:04+09:00"
draft: false
url: "/entry/2024/03/02/140704/"
categories: ["Shadow Threshold Map", "Face Threshold Map", "Face Shadow Map", "Material", "Shader", "Tech", "UE5", "シェーダ", "マテリアル", "数学", "顔の影マップ", "SDFテクスチャ"]
hatena_author: "nagakagachi"
hatena_original_url: "https://nagakagachi.hatenablog.com/entry/2024/03/02/140704"
hatena_basename: "2024/03/02/140704"
math: false
image: "images/d173374b5fc8b92e86af443abbd7100fae0e0edd36c85121e9c9753620989c20.png"
---

<p><span style="font-size: 80%;">誤ってページ削除してしまいましたが2024年の記事です</span></p>





<p>セルルックキャ<a class="keyword" href="https://d.hatena.ne.jp/keyword/%A5%E9%A5%AF">ラク</a>ターの顔の陰制御に用いられるShadow Threshold Mapを生成する仕組みについて.<br />連番二値画像からSDFを利用してテクスチャ合成する基本部分の説明を試みます.</p>


(Face Thresholdテクスチャ, Shadow Thresholdテクスチャ, SDFテクスチャ などとも)


<blockquote class="twitter-tweet" data-conversation="none" data-lang="ja">
<p dir="ltr" lang="ja">SDFによる補間で Shadow Threshold Map を連番画像から自動生成するツール<br /><br />を<a class="keyword" href="https://d.hatena.ne.jp/keyword/GitHub">GitHub</a>のSDFツールの中にUPしました.<br /><br />EUW_GenerateShadowThresholdMap がツール自体.<br />現状は全画像が等間隔な<a class="keyword" href="https://d.hatena.ne.jp/keyword/%EF%E7%C3%CD">閾値</a>になります.<br /><br />合成方法の説明などドキュメントは後で(∩´∀｀)∩<a href="https://t.co/6GdbEja9o3">https://t.co/6GdbEja9o3</a><a href="https://twitter.com/hashtag/UE5?src=hash&amp;ref_src=twsrc%5Etfw">#UE5</a> <a href="https://t.co/52QUQek23i">pic.twitter.com/52QUQek23i</a></p>
— なが (@nagakagachi) <a href="https://twitter.com/nagakagachi/status/1732041139325489588?ref_src=twsrc%5Etfw">2023年12月5日</a></blockquote>
<p>
<script async="" src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>
<br /><br /></p>
<div class="section">


<h3 id="概要">概要</h3>


<p><img src="images/e964cbb37d67738f7ee3261802f9013a60c997ee916df1f2ee6395aa10604695.png" width="1200" height="298" loading="lazy" title="" class="hatena-fotolife" itemprop="image" /><br /><img src="images/5056f97907159cb92c7d91829eed6fb23e038cde4f12f324881a86553ff5e153.png" width="1200" height="959" loading="lazy" title="" class="hatena-fotolife" itemprop="image" /></p>
<p>UE5上のツールとしては以下のSDF関連ツールに含まれています.<br /><a class="keyword" href="https://d.hatena.ne.jp/keyword/%A5%D6%A5%E9%A5%C3%A5%AF%A5%DC%A5%C3%A5%AF%A5%B9">ブラックボックス</a>無しでBPとマテリアルとして実装しているので詳細はそちらをご確認ください.<br /><iframe src="https://hatenablog-parts.com/embed?url=https%3A%2F%2Fgithub.com%2Fnagakagachi%2FNagaSdfTextureToolForUE" title="GitHub - nagakagachi/NagaSdfTextureToolForUE: Tools for generating SDF from textures in Unreal Engine" class="embed-card embed-webcard" scrolling="no" frameborder="0" style="display: block; width: 100%; height: 155px; max-width: 500px; margin: 10px 0px;" loading="lazy"></iframe><cite class="hatena-citation"><a href="https://github.com/nagakagachi/NagaSdfTextureToolForUE">github.com</a></cite></p>
<br />





</div>
<div class="section">
<h3 id="アルゴリズム"><a class="keyword" href="https://d.hatena.ne.jp/keyword/%A5%A2%A5%EB%A5%B4%A5%EA%A5%BA%A5%E0">アルゴリズム</a></h3>
<p>ここでは最もシンプルと思われる<strong>C0連続</strong>な合成を考えます.<br />連番二値画像間の遷移速度をよりなめらかにしたい場合はC1連続となるように合成するのが良いかもしれません.</p>


連番の連続する2枚ずつを処理していきます.


<div class="section">


<h4 id="処理対象の連続するペア">処理対象の連続するペア</h4>


<figure class="figure-image figure-image-fotolife" title="連番のi番目とi+1番目の例"><img src="images/943980dea4019b8066142c39379518461f9726283449391830ebf67775aa9661.png" alt="" width="1200" height="334" loading="lazy" title="" class="hatena-fotolife" itemprop="image" />
<figcaption>連番のi番目とi+1番目の例</figcaption>
</figure>
</div>
<div class="section">


<h4 id="SDF生成">SDF生成</h4>




二値画像のSDFを計算.  
内部側の距離も必要なのでSigned Distance Fieldである必要があります.


<figure class="figure-image figure-image-fotolife" title="SDF生成"><img src="images/f5a8b3806d30a7158215973442600f64596cb04117398af7b797060da7fe4188.png" alt="" width="1200" height="630" loading="lazy" title="" class="hatena-fotolife" itemprop="image" />
<figcaption>SDF生成</figcaption>
</figure>
</div>
<div class="section">


<h4 id="SDFを元に遷移率を計算">SDFを元に遷移率を計算</h4>




SDFは境界からの距離を表すため,   
SDF\_1st / (SDF\_1st + SDF\_2nd)  
を計算することで遷移元から遷移先の境界で 0-1 となるようなグラデーションが得られます.


<figure class="figure-image figure-image-fotolife" title="SDFの値から遷移率を計算"><img src="images/d173374b5fc8b92e86af443abbd7100fae0e0edd36c85121e9c9753620989c20.png" alt="" width="1200" height="540" loading="lazy" title="" class="hatena-fotolife" itemprop="image" />
<figcaption>SDFの値から遷移率を計算</figcaption>
</figure>
</div>
<div class="section">


<h4 id="ペアの遷移領域のみマスクして処理">ペアの遷移領域のみマスクして処理</h4>


<p>処理対象は1st-&gt;2ndで黒-&gt;白に変化した領域だけなのでマスクします.<br />遷移領域における各<a class="keyword" href="https://d.hatena.ne.jp/keyword/%A5%D4%A5%AF%A5%BB%A5%EB">ピクセル</a>のペア間遷移率(0~1)が得られたので, この値で最終的な陰用<a class="keyword" href="https://d.hatena.ne.jp/keyword/%EF%E7%C3%CD">閾値</a>を決定することができます.<br />これを連番画像のすべてのペアで実行すればShadow Threshold Mapが完成します.</p>
<figure class="figure-image figure-image-fotolife" title="遷移領域のみマスク"><img src="images/86bd602e3633f3cd0a476fec6bb834022865bee497ff3d5a0373cdc9baa02033.png" alt="" width="1200" height="643" loading="lazy" title="" class="hatena-fotolife" itemprop="image" />
<figcaption>遷移領域のみマスク</figcaption>
</figure>
</div>
<div class="section">


<h4 id="付録変化の速度の連続性">(付録)変化の速度の連続性</h4>


<p>この方法では2枚のペアずつ処理しているため, 最終的なグラデーションの変化速度が不連続になります(C0連続).<br />枚数を多く用意して細かい<a class="keyword" href="https://d.hatena.ne.jp/keyword/%B6%E8%B4%D6">区間</a>で分けている場合は気にならないかもしれませんが,<br />少ない枚数の場合には陰領域の移動速度が<a class="keyword" href="https://d.hatena.ne.jp/keyword/%B6%E8%B4%D6">区間</a>の境目でガタついて見えるかもしれません.<br />これを解決する場合は2枚のペアではなく更にその隣の画像も含めて速度が連続になるように遷移率を計算することになると思われます.<br />(本記事では未対応です)</p>
<figure class="figure-image figure-image-fotolife" title="変化の速度が不連続"><img src="images/21546ab96700ef8ece394a62899e8905121a2fc559d76572606934cf411e81f5.png" alt="" width="1200" height="647" loading="lazy" title="" class="hatena-fotolife" itemprop="image" />
<figcaption>変化の速度が不連続</figcaption>
</figure>
</div>
</div>
<div class="section">


<h3 id="関連情報">関連情報</h3>


<p>実際の運用等については<a class="keyword" href="https://d.hatena.ne.jp/keyword/CEDEC">CEDEC</a>のHi-Fi RUSH講演や, alweiさんの記事が参考になるかと考えます.</p>
<p><iframe src="https://hatenablog-parts.com/embed?url=https%3A%2F%2Fcgworld.jp%2Farticle%2F202306-hifirush01.html" title="Tango Gameworksのチャレンジが詰まったカートゥーン調リズムアクションゲーム『Hi-Fi RUSH（ハイファイラッシュ）』（1）キャラクター・モーション・エフェクト編" class="embed-card embed-webcard" scrolling="no" frameborder="0" style="display: block; width: 100%; height: 155px; max-width: 500px; margin: 10px 0px;" loading="lazy"></iframe><cite class="hatena-citation"><a href="https://cgworld.jp/article/202306-hifirush01.html">cgworld.jp</a></cite></p>
<figure class="figure-image figure-image-fotolife" title="https://cgworld.jp/article/202306-hifirush01.html"><img src="images/91e91d7cf425d17d1fa5405dc7d58454533538f96aac0b8a9bad2e3b303b70da.png" alt="" width="1200" height="344" loading="lazy" title="" class="hatena-fotolife" itemprop="image" />
<figcaption><a href="https://cgworld.jp/article/202306-hifirush01.html">https://cgworld.jp/article/202306-hifirush01.html</a></figcaption>
</figure>
<blockquote class="twitter-tweet" data-conversation="none" data-lang="ja">
<p dir="ltr" lang="ja">UE5 SDF Face Shadow<a class="keyword" href="https://d.hatena.ne.jp/keyword/%A5%DE%A5%C3%A5%D4%A5%F3%A5%B0">マッピング</a>でアニメ顔用の影を作ろう - Let's Enjoy <a class="keyword" href="https://d.hatena.ne.jp/keyword/Unreal%20Engine">Unreal Engine</a> <a href="https://twitter.com/hashtag/UE5?src=hash&amp;ref_src=twsrc%5Etfw">#UE5</a> <a href="https://twitter.com/hashtag/UE5Study?src=hash&amp;ref_src=twsrc%5Etfw">#UE5Study</a> <a href="https://t.co/7DqBsU1yH1">https://t.co/7DqBsU1yH1</a> <a href="https://t.co/5J5Fgww4LX">pic.twitter.com/5J5Fgww4LX</a></p>
— alwei (@aizen76) <a href="https://twitter.com/aizen76/status/1762831115340116270?ref_src=twsrc%5Etfw">2024年2月28日</a></blockquote>
<p>
<script async="" src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>
<br /><iframe src="https://hatenablog-parts.com/embed?url=https%3A%2F%2Funrealengine.hatenablog.com%2Fentry%2F2024%2F02%2F28%2F222220" title="UE5 SDF Face Shadowマッピングでアニメ顔用の影を作ろう - Let's Enjoy Unreal Engine" class="embed-card embed-blogcard" scrolling="no" frameborder="0" style="display: block; width: 100%; height: 190px; max-width: 500px; margin: 10px 0px;" loading="lazy"></iframe><cite class="hatena-citation"><a href="https://unrealengine.hatenablog.com/entry/2024/02/28/222220">unrealengine.hatenablog.com</a></cite></p>
<br /><br /><br />


名称として  
Shadow Threshold Map  
Face Threshold Map  
Face Shadow Map  
等ばらつきがあるのがつらいところ...


</div>

---

[元のはてなブログ記事](https://nagakagachi.hatenablog.com/entry/2024/03/02/140704)
