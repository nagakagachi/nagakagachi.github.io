---
title: "縮小バッファによる半透明パーティクル描画についてのメモ"
date: "2021-12-12T19:31:38+09:00"
draft: false
url: "/entry/2021/12/12/193138/"
categories: ["C++", "Graphics", "HLSL", "Shader"]
hatena_author: "nagakagachi"
hatena_original_url: "https://nagakagachi.hatenablog.com/entry/2021/12/12/193138"
hatena_basename: "2021/12/12/193138"
math: false
---

縮小バッファに描いたものを合成するというフローについて.


<ul class="table-of-contents">
<li><a href="#別バッファ半透明描画と直接描画の結果一致の確認">別バッファ半透明描画と直接描画の結果一致の確認</a></li>
<li><a href="#Lost-Planet">Lost Planet</a></li>
<li><a href="#METAL-GEAR-SOLID-4">METAL GEAR SOLID 4</a></li>
<li><a href="#Tales-of-ARISE">Tales of ARISE</a></li>
</ul>
<div class="section">
    

<h3 id="別バッファ半透明描画と直接描画の結果一致の確認">別バッファ半透明描画と直接描画の結果一致の確認</h3>


<p><a class="keyword" href="https://d.hatena.ne.jp/keyword/METAL%20GEAR%20SOLID%204">METAL GEAR SOLID 4</a>の記事などで紹介されている方法の確認をあらためて</p>

<ol>
<li>半透明用バッファを(0,0,0,1)でクリア</li>
<li>半透明描画
<ul>
<li>アルファブレンドの場合
<ul>
<li>RGB  : Dst*(1-SrcAlpha) + Src*SrcAlpha</li>
<li>Alpha: DstAlpha * (1 - SrcAlpha)</li>
</ul></li>
<li>加算ブレンドの場合
<ul>
<li>RGB  : Dst + Src*SrcAlpha</li>
<li>Alpha: DstAlpha</li>
</ul></li>
</ul></li>
<li>半透明バッファを最終合成
<ul>
<li>RGB  : Dst * SrcAlpha + Src</li>
</ul></li>
</ol>

3回の半透明描画の例で計算確認  
  
c\[i\]はアルファ乗算済みRGB  
  
a\[i\]は対応する出力アルファ値\{ 半透明アルファ値 : アルファブレンド, 0.0 : 加算合成 \}  
  
としてアルファブレンドと加算合成が任意に混在するものとする


<pre class="code lang-cpp" data-lang="cpp" data-unlink><span class="synComment">// c0に直接3回の合成(c1, c2, c3 の順)</span>
cd=c3+(c2+(c1+<span class="synIdentifier">c0</span>(<span class="synConstant">1</span>-a1))(<span class="synConstant">1</span>-a2))(<span class="synConstant">1</span>-a3)
ad=(<span class="synConstant">1</span>-a0)(<span class="synConstant">1</span>-a1)(<span class="synConstant">1</span>-a2)(<span class="synConstant">1</span>-a3)


<span class="synComment">// ---------------------------------------------</span>

<span class="synComment">// cs_, as_へ3回の半透明を合成してから最後にc0と合成</span>
<span class="synComment">// 疑似コードの通り初期値として c0=0, a0=1 とすると c1,c2,c3 の合成は</span>
c_temp=c3+(c2+<span class="synIdentifier">c1</span>(<span class="synConstant">1</span>-a2))(<span class="synConstant">1</span>-a3)
a_temp=(<span class="synConstant">1</span>-a1)(<span class="synConstant">1</span>-a2)(<span class="synConstant">1</span>-a3)

<span class="synComment">// c_tempをc0へ合成</span>
cd=c0*a_temp+c_temp
=<span class="synIdentifier">c0</span>(<span class="synConstant">1</span>-a1)(<span class="synConstant">1</span>-a2)(<span class="synConstant">1</span>-a3)+( c3+(c2+<span class="synIdentifier">c1</span>(<span class="synConstant">1</span>-a2))(<span class="synConstant">1</span>-a3) )
=c3+(c2+(c1+<span class="synIdentifier">c0</span>(<span class="synConstant">1</span>-a1))(<span class="synConstant">1</span>-a2))(<span class="synConstant">1</span>-a3)
</pre>

c0直接合成とc\_tmpを介した合成で式が一致した  
  
アルファブレンドと加算合成が任意の数と順序で混在していても, 別バッファ半透明の結果は直接描画半透明と一致する(ﾟ∀ﾟ)

<p>(だいぶ前の記事を整理)<blockquote data-conversation="none" class="twitter-tweet" data-lang="ja"><p lang="ja" dir="ltr">cs=c3+(c2+(c1+c0(1-a1))(1-a2))(1-a3)<br>as=(1-a0)(1-a1)(1-a2)(1-a3)<br><br>c0=0, a0=1とすると<br>cs_=c3+(c2+c1(1-a2))(1-a3)<br>as_=(1-a1)(1-a2)(1-a3)<br><br>cdへの合成<br>c=cd*as_+cs_<br>=cd(1-a1)(1-a2)(1-a3)+( c3+(c2+c1(1-a2))(1-a3) )<br>=c3+(c2+(c1+cd(1-a1))(1-a2))(1-a3)<br><br>で最初の式でc0=cdとした場合と一致</p>&mdash; なが (@nagakagachi) <a href="https://twitter.com/nagakagachi/status/1468969836424609795?ref_src=twsrc%5Etfw">2021年12月9日</a></blockquote> <script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>  <br />
<br />
<br />
</p>

</div>
<div class="section">
    

<h3 id="Lost-Planet">Lost Planet</h3>


<p><a href="https://game.watch.impress.co.jp/docs/20070131/3dlp.htm">&#x897F;&#x5DDD;&#x5584;&#x53F8;&#x306E;3D&#x30B2;&#x30FC;&#x30E0;&#x30D5;&#x30A1;&#x30F3;&#x306E;&#x305F;&#x3081;&#x306E;&#x300C;&#x30ED;&#x30B9;&#x30C8; &#x30D7;&#x30E9;&#x30CD;&#x30C3;&#x30C8;&#x300D;&#x30B0;&#x30E9;&#x30D5;&#x30A3;&#x30C3;&#x30AF;&#x30B9;&#x8B1B;&#x5EA7;</a><br />
</p>

<ol>
<li>シーンカラーとシーンデプスの縮小版生成, 縮小解像度のアルファバッファも生成</li>
<li>パーティクル群を縮小バッファへ描画,この時縮小アルファには最終合成時用のマスクを書き込む</li>
<li>縮小アルファを元にフル解像度シーンカラーへ合成</li>
</ol>

半透明の奥側は縮小シーンであるため, フル解像度との合成で解像度のズレが見える.  
  
加算合成等の場合は縮小アルファにどのような値を書き込むのかわからない.  
  
縮小アルファへの書き込みさえなんとかなれば加算減算乗算も可能に思える.



</div>
<div class="section">
<h3 id="METAL-GEAR-SOLID-4"><a class="keyword" href="https://d.hatena.ne.jp/keyword/METAL%20GEAR%20SOLID%204">METAL GEAR SOLID 4</a></h3>
<p><a href="https://game.watch.impress.co.jp/docs/20081203/3dmg4.htm">&#x897F;&#x5DDD;&#x5584;&#x53F8;&#x306E;3D&#x30B2;&#x30FC;&#x30E0;&#x30D5;&#x30A1;&#x30F3;&#x306E;&#x305F;&#x3081;&#x306E;&#x30B2;&#x30FC;&#x30E0;&#x30B0;&#x30E9;&#x30D5;&#x30A3;&#x30C3;&#x30AF;&#x30B9;&#x8B1B;&#x5EA7;</a><br />
アルファブレンドと加算合成の混在でも動作する処理<br />
<br />
</p>

</div>
<div class="section">
    

<h3 id="Tales-of-ARISE">Tales of ARISE</h3>


<p><a href="https://cedec.cesa.or.jp/2019/session/detail/s5c9c5bc2d3123.html">CEDEC2019: &#x300E;Tales of ARISE&#x300F;&#x306B;&#x304A;&#x3051;&#x308B;&#x30EC;&#x30F3;&#x30C0;&#x30EA;&#x30F3;&#x30B0;&#x6280;&#x8853;&#x3068;&#x9AD8;&#x901F;&#x5316;</a><br />
<a class="keyword" href="https://d.hatena.ne.jp/keyword/UE4">UE4</a>改造して複数解像度による多段階の半透明描画をしている</p>

<ol>
<li>低解像度で半透明描画 (<a class="keyword" href="https://d.hatena.ne.jp/keyword/MGS4">MGS4</a>と同様で, 縮小シーンではなさそう?)</li>
<li>低解像度バッファの勾配情報等から低解像度高周波マスク生成</li>
<li>シーンへの低解像度バッファ合成と, フル解像度高周波ステンシルバッファ生成
<ul>
<li>ステンシル出力有効にして高周波マスク値からステンシル値出力している?</li>
</ul></li>
<li>ステンシルバッファを利用してフル解像度で部分的に半透明再描画
<ul>
<li>詳細部分のみパーティクル描画をフル解像度で実行する</li>
</ul></li>
</ol><p>低解像度で描画して, 詳細が必要な部分だけステンシルマスク利用のフル解像度描画.<br />
資料の情報からは<a class="keyword" href="https://d.hatena.ne.jp/keyword/MGS4">MGS4</a>ブレンドバッファと同様にシーンの縮小バッファではなくクリアされた縮小バッファに描いている?.<br />
ブレンドバッファ方式の場合は乗算等は不可能そうに思えるがどうか?<br />
earlydepthstencilで<a class="keyword" href="https://d.hatena.ne.jp/keyword/%A5%D4%A5%AF%A5%BB%A5%EB">ピクセル</a>処理を早期棄却しつつ部分的にフル解像度描画できる.<br />
高周波判定する<a class="keyword" href="https://d.hatena.ne.jp/keyword/%EF%E7%C3%CD">閾値</a>を変化させることで負荷のコン<a class="keyword" href="https://d.hatena.ne.jp/keyword/%A5%C8%A5%ED%A1%BC%A5%EB">トロール</a>ができそうな点も面白そう.</p>

</div>

---

[元のはてなブログ記事](https://nagakagachi.hatenablog.com/entry/2021/12/12/193138)
