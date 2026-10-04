---
title: "論文メモ Fast Eulerian Fluid Simulation In Games Using Poisson Filters (SCA 2020 Showcase)"
date: "2020-12-10T22:29:11+09:00"
draft: false
url: "/entry/2020/12/10/222911/"
categories: ["SIGGRAPH", "Physics", "Fluid"]
hatena_author: "nagakagachi"
hatena_original_url: "https://nagakagachi.hatenablog.com/entry/2020/12/10/222911"
hatena_basename: "2020/12/10/222911"
math: false
image: "images/b782c0befaec31ac9c69e592d0eb8c01c4c9c2a9f2c0a96e90194ce7f72bfd6a.png"
---

<p><iframe width="480" height="270" src="https://www.youtube.com/embed/_3eyPUyqluc?feature=oembed" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe><cite class="hatena-citation"><a href="https://www.youtube.com/watch?v=_3eyPUyqluc">www.youtube.com</a></cite></p>





<div class="section">
    

### 概要


<p>2次元Euler流体を用いた<a class="keyword" href="http://d.hatena.ne.jp/keyword/2.5%BC%A1%B8%B5">2.5次元</a><a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%A4%A5%F3%A5%BF%A5%E9%A5%AF%A5%C6%A5%A3%A5%D6">インタラクティブ</a>流体エフェクトに関するShowcase。<br />
圧力Poisson方程式のJacobi法ソルバの反復数を大幅に削減し高速化するPoisson (Separable) Filterを提案。</p>

</div>
<div class="section">
    

### Poisson Filter


<p>圧力Poisson方程式のJacobi反復は、前回の反復での圧力値に対して<a class="keyword" href="http://d.hatena.ne.jp/keyword/%BA%C6%B5%A2">再帰</a>的に定数フィルタ<a class="keyword" href="http://d.hatena.ne.jp/keyword/3x3">3x3</a>をかけ合わせているものとみなせる(3次元なら3x3x3)。<br />
N回のJacobi反復を1回の畳み込みフィルタに解析的に変換することで反復数を削減することができる。<br />
事前計算でこの畳込みフィルタを求めておくことでランタイムでの圧力反復計算を大幅に高速化する。</p>
<figure class="figure-image figure-image-fotolife" title="引用1"><span itemscope itemtype="http://schema.org/Photograph"><img src="images/b782c0befaec31ac9c69e592d0eb8c01c4c9c2a9f2c0a96e90194ce7f72bfd6a.png" alt="f:id:nagakagachi:20201210213053p:plain" title="" class="hatena-fotolife" itemprop="image"></span><figcaption>引用1</figcaption></figure>
<blockquote>
        

近傍の初期値にN回のフィルタを掛けた結果とおなじになるようなフィルタを事前計算して利用するということ。  
  
定数重みを掛けて足し合わせるフィルタをN回掛けた場合の、近傍初期値の足し合わせ重みは地道に手計算することでも確認ができそう。



</blockquote>

</div>
<div class="section">
    

### Poisson Separable Filter


<p>畳み込みフィルタ化によって反復数を1回にすることができるが、N回分をまとめたことにより広範囲をサンプリングするフィルタとなり、計算量は非常に多くなってしまう。<br />
<a class="keyword" href="http://d.hatena.ne.jp/keyword/canonical">canonical</a> polyadic decomposition (CPD) でRank1のMatrixの和に変換し、それぞれを<a class="keyword" href="http://d.hatena.ne.jp/keyword/%C6%C3%B0%DB%C3%CD%CA%AC%B2%F2">特異値分解</a>(SVD)で Nx1. 1x1, 1xN の行列積に変換する(1x1は特異値(Scalar)になる)。<br />
ここで特異値が最大のものだけを選ぶことで、元の行列の性質をある程度残しながらNx1と1xNの縦横に分離された Poisson Separable Filter が得られる。  </p>
<figure class="figure-image figure-image-fotolife" title="引用"><span itemscope itemtype="http://schema.org/Photograph"><img src="images/217cc2d9a48813d6d84aeea3158513deedd331d69cd4a89ea9f75d7b27f63c25.png" alt="f:id:nagakagachi:20201210220549p:plain" title="" class="hatena-fotolife" itemprop="image"></span><figcaption>引用</figcaption></figure>

このようにして得られた Filter は Total variance explained が83%以下にはならないらしい(これが元の性質をある程度残しているということ？)



このフィルタは中心部から離れた要素の重みが小さいため、それらを切り捨てることでさらにフィルタサイズを小さくすることができる(~80% redundant)。  
  
また、重みが対称的であるため実際に必要とする重みデータは更に圧縮することができる。



反復数が1回になったこととフィルタサイズの削減により、反復数が小さい場合には4.5倍、100反復では30倍程度高速化することができた。



</div>
<div class="section">
    

### 2.5Dシミュレーション


    

シミュレーションは2D-Gridで実行しているが、カメラの向きに応じて高さや傾きを補正することであたかも3D空間でシミュレーションされているようにみせている。  
  
外力や風は3Dから2Dへ投影することでシミュレーションに取り込まれる。


<figure class="figure-image figure-image-fotolife" title="引用"><span itemscope itemtype="http://schema.org/Photograph"><img src="images/54cee14cd29fac87afde0b55f0ac6e03de8026fe4ddc5f71f724ba734607f985.png" alt="f:id:nagakagachi:20201210221945p:plain" title="" class="hatena-fotolife" itemprop="image"></span><figcaption>引用</figcaption></figure><figure class="figure-image figure-image-fotolife" title="引用"><span itemscope itemtype="http://schema.org/Photograph"><img src="images/a49ca8b5a4257e077e7293d128ae6f69a50009e48543b3b6f69cfb89de1a2c31.png" alt="f:id:nagakagachi:20201210222014p:plain" title="" class="hatena-fotolife" itemprop="image"></span><figcaption>引用</figcaption></figure><p>3Dオブジェクトとの<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%B3%A5%EA%A5%B8%A5%E7%A5%F3">コリジョン</a>は深度バッファベースの手法を利用している。</p>

</div>
<div class="section">
    

### アーティストワークフロー


<p>マスク画像によって炎や煙の生成部をコン<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%C8%A5%ED%A1%BC%A5%EB">トロール</a>する。</p>
<figure class="figure-image figure-image-fotolife" title="引用"><span itemscope itemtype="http://schema.org/Photograph"><img src="images/23e8b92c76ef118a0333d8f1e6e2c061449485d3530e447175ab27a3380df42f.png" alt="f:id:nagakagachi:20201210222216p:plain" title="" class="hatena-fotolife" itemprop="image"></span><figcaption>引用</figcaption></figure>
</div>
<div class="section">
    

### What is Next?


<p>Poisson Filterの3次元への拡張<br />
Multi-Runk + Rank Selector ( 負荷と品質の<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%C8%A5%EC%A1%BC%A5%C9%A5%AA%A5%D5">トレードオフ</a>ができるように )<br />
粘性拡散項への対応<br />
<br />
</p>

</div>
<div class="section">
    

### 感想


<p>Jacobi法の<a class="keyword" href="http://d.hatena.ne.jp/keyword/%BA%C6%B5%A2">再帰</a>的構造に注目して1回の畳み込みフィルタに変換するというのは目からウロコだった。<br />
他の分野でも使えそう(使われていそう)なので身につけたい。<br />
フィルタを<a class="keyword" href="http://d.hatena.ne.jp/keyword/%C6%C3%B0%DB%C3%CD%CA%AC%B2%F2">特異値分解</a>して次元削減+Separableにするというのも応用が効きそう。<br />
実装してみたいがまず解析的に畳み込みフィルタに変換する部分があやふやなので実際に<a class="keyword" href="http://d.hatena.ne.jp/keyword/Python">Python</a>あたりで試してみたい。</p>

</div>

---

[元のはてなブログ記事](https://nagakagachi.hatenablog.com/entry/2020/12/10/222911)
