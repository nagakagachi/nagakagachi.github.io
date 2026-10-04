---
title: "Dreams Engineメモ"
date: "2020-06-02T22:15:12+09:00"
draft: false
url: "/entry/2020/06/02/221512/"
categories: []
hatena_author: "nagakagachi"
hatena_original_url: "https://nagakagachi.hatenablog.com/entry/2020/06/02/221512"
hatena_basename: "2020/06/02/221512"
math: false
---

Dreams Engineの仕組みについてメモ


<ul class="table-of-contents">
<li><a href="#講演資料">講演資料</a></li>
<li><a href="#データ表現">データ表現</a><ul>
<li><a href="#CSG">CSG</a></li>
<li><a href="#PointCloud">PointCloud</a></li>
</ul>
</li>
<li><a href="#レンダリング">レンダリング</a></li>
<li><a href="#メモ">メモ</a></li>
</ul>
<div class="section">
    

<h3 id="講演資料">講演資料</h3>


<p><iframe width="480" height="270" src="https://www.youtube.com/embed/u9KNtnCZDMI?feature=oembed" frameborder="0" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe><cite class="hatena-citation"><a href="https://www.youtube.com/watch?v=u9KNtnCZDMI&list=FLG_L7EFxdvJXARWutHbzh7Q&index=124">www.youtube.com</a></cite><br />
<a href="http://advances.realtimerendering.com/s2015/AlexEvans_SIGGRAPH-2015-sml.pdf">http://advances.realtimerendering.com/s2015/AlexEvans_SIGGRAPH-2015-sml.pdf</a></p>





</div>
<div class="section">
    

<h3 id="データ表現">データ表現</h3>


    
<div class="section">
    

<h4 id="CSG">CSG</h4>


    

アーティストはCSG(Constructive Solid Geometry)でモデルなどを作る  
  
CSGのEdit-Listという形で管理される  
  
Edit-Listは100kのEditまでサポート  
  
1000^3のグリッド空間でそれぞれのセルについてEdit-Listを評価することで表面を決定する  
  
空間を4x4x4単位で分割していき、局所空間毎のEdit-Listがなるべく短くなるようにする  
  
形状の表面はなるべく分割し、空であったり完全に埋まっている部分は分割しないようにする  
  
分割するかどうかの判断はCSGから計算されたSDFの値を利用する  
  
実験の結果、SDFはL1距離やL2距離ではなく、Lmax距離(Max-Norm Distance)を用いるのが良いとわかった



</div>
<div class="section">
    

<h4 id="PointCloud">PointCloud</h4>


    

様々な検証の後に、メッシュ化やVolumeRenderingではなく、CSG表面へPoint Cloudの生成することを試した  
  
SDFは中間表現扱いとなり、Pointを生成する際の評価に利用される  
  
Edit-Listの空間分割の際にSDFの表面上を詳細に分割するようにしており、空間は4x4x4で分割されている  
  
4x4x4=64スレッドでLeafVoxelにSDFのゼロ境界が交差するかチェックし、交差する場合はPointを生成する  
  
LeafVoxelひとつにつきPointは一つとする

<p>LeafVoxelは4x4x4単位でBrickとして管理されている<br />
Brickは<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%D2%A5%EB%A5%D9%A5%EB%A5%C8">ヒルベルト</a>曲線で空間充填するように並んでいる<br />
256点毎に1<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%AF%A5%E9%A5%B9%A5%BF">クラスタ</a>ーとしてまとめて処理をする<br />
<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%D2%A5%EB%A5%D9%A5%EB%A5%C8">ヒルベルト</a>順で空間的にジャンプがある場合は<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%D0%A5%A6%A5%F3%A5%C7%A5%A3">バウンディ</a>ングボックスがタイトになるように調整(よくわからない)</p><p><a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%AF%A5%E9%A5%B9%A5%BF">クラスタ</a>ー毎に<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%D0%A5%A6%A5%F3%A5%C7%A5%A3">バウンディ</a>ングボックスと、法線の境界情報(<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%AF%A5%E9%A5%B9%A5%BF">クラスタ</a>内法線の上限下限？)を持つ<br />
<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%AF%A5%E9%A5%B9%A5%BF">クラスタ</a>ー内のPointは位置、法線、ラフネスをdword(32bit?)にパックしたものと32bitカラーを持つ<br />
<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%AF%A5%E9%A5%B9%A5%BF">クラスタ</a>ー内のPointの情報はDXT1で圧縮される</p><p>また、LOD毎に独立した<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%AF%A5%E9%A5%B9%A5%BF">クラスタ</a>ーを計算してミップピラミッド<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%AF%A5%E9%A5%B9%A5%BF">クラスタ</a>とそのPointCloudを生成する</p>

</div>
</div>
<div class="section">
<h3 id="レンダリング"><a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%EC%A5%F3%A5%C0%A5%EA%A5%F3%A5%B0">レンダリング</a></h3>
<p>モデルのPointCloudを描画をする<br />
各モデルの<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%AF%A5%E9%A5%B9%A5%BF">クラスタ</a>ーをBVHに配置（グローバルではなくモデル一つがBVHで<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%AF%A5%E9%A5%B9%A5%BF">クラスタ</a>ーを管理している？）<br />
LOD間の遷移を滑らかにするために、<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%ED%A5%B7%A5%A2%A5%F3%A5%EB%A1%BC%A5%EC%A5%C3%A5%C8">ロシアンルーレット</a>で25%までPointを間引く(<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%AF%A5%E9%A5%B9%A5%BF">クラスタ</a>毎に256->64まで滑らかに間引かれる)<br />
どうもPointをComputeShaderでAtmicに"Splat"描画をしているらしい</p>

</div>
<div class="section">
    

<h3 id="メモ">メモ</h3>


    

Brickは4x4x4のVoxelの塊  
  
CSGからSDFを作る(ランタイム？もう一度調べる)  
  
SDFはL1やL2ではなくてLmaxらしい  
  
試行錯誤の後にメッシュやVolumeRenderingではなく点群による描画に行き着いたとのこと

<p>肝としてはPointCloudデータの生成とその圧縮、<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%AF%A5%E9%A5%B9%A5%BF">クラスタ</a>ー単位のカリングとLOD、Compute?によるAtomic演算描画あたりだろうか</p>

</div>

---

[元のはてなブログ記事](https://nagakagachi.hatenablog.com/entry/2020/06/02/221512)
