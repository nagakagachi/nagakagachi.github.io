---
title: "UEマテリアルネタ帳"
date: "2026-01-28T23:46:56+09:00"
draft: false
url: "/entry/2026/01/28/234656/"
categories: ["HLSL", "UE5", "シェーダ", "マテリアル", "数学"]
hatena_author: "nagakagachi"
hatena_original_url: "https://nagakagachi.hatenablog.com/entry/2026/01/28/234656"
hatena_basename: "2026/01/28/234656"
math: false
image: "images/2f7988364730b8938c8767f1068a1d61ce37261a3bab66557ad5ed82ea7fbfab.png"
---

雑多なネタを書いてあとで探しやすくするためのページ.  
  
役に立ったらイイネや紹介してね☆（ゝω・）vｷｬﾋﾟ


<ul class="table-of-contents">
<li><a href="#Simplex頂点に任意の乱数を利用できるSimplex-Noise">Simplex頂点に任意の乱数を利用できるSimplex Noise</a></li>
<li><a href="#入力ベクトルの主要軸と第二主要軸を抽出する">入力ベクトルの主要軸と第二主要軸を抽出する</a></li>
</ul>
<div class="section">
    

<h3 id="Simplex頂点に任意の乱数を利用できるSimplex-Noise">Simplex頂点に任意の乱数を利用できるSimplex Noise</h3>


<p><iframe src="https://hatenablog-parts.com/embed?url=https%3A%2F%2Fnagakagachi.hatenablog.com%2Fentry%2F2023%2F07%2F26%2F135233" title="Simplex頂点に任意の乱数を利用できるSimplex Noise Custom Node[UE][UE5] - ながむしメモ" class="embed-card embed-blogcard" scrolling="no" frameborder="0" style="display: block; width: 100%; height: 190px; max-width: 500px; margin: 10px 0px;" loading="lazy"></iframe><cite class="hatena-citation"><a href="https://nagakagachi.hatenablog.com/entry/2023/07/26/135233">nagakagachi.hatenablog.com</a></cite></p><br />






</div>
<div class="section">
    

<h3 id="入力ベクトルの主要軸と第二主要軸を抽出する">入力ベクトルの主要軸と第二主要軸を抽出する</h3>


<p>ベクトルの<a class="keyword" href="https://d.hatena.ne.jp/keyword/%A5%B3%A5%F3%A5%DD%A1%BC%A5%CD%A5%F3%A5%C8">コンポーネント</a>について絶対値が大きい順で第一位(Dominant), 第二位(Secondary)の軸の情報を抽出する.<br />
軸インデックス:x=0, y=1, z=2<br />
と<br />
軸マスクベクトル (1, 0, 0), (0, 1, 0), (0, 0, 1)<br />
を返す.<br />
もっとシンプルな記述ができそうなので後でアップデートするかも.<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/2f7988364730b8938c8767f1068a1d61ce37261a3bab66557ad5ed82ea7fbfab.png" width="1200" height="717" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span></p>
<pre class="code lang-cpp" data-lang="cpp" data-unlink><span class="synType">const</span> float3 abs_dir = <span class="synIdentifier">abs</span>(in_dir);

<span class="synType">const</span> int3 comp0 = abs_dir.xyz &gt; abs_dir.yzx;
<span class="synType">const</span> int3 comp1 = abs_dir.xyz &gt; abs_dir.zxy;
<span class="synType">const</span> int3 <span class="synType">rank</span> = comp0+comp1;

out_dominant_axis_index = <span class="synConstant">0</span>;
out_secondary_axis_index = <span class="synConstant">0</span>;
out_dominant_axis_mask_vec = <span class="synIdentifier">float3</span>(<span class="synConstant">0.0</span>, <span class="synConstant">0.0</span>, <span class="synConstant">0.0</span>);
out_secondary_axis_mask_vec = <span class="synIdentifier">float3</span>(<span class="synConstant">0.0</span>, <span class="synConstant">0.0</span>, <span class="synConstant">0.0</span>);
<span class="synStatement">for</span>(<span class="synType">int</span> i = <span class="synConstant">0</span>; i &lt; <span class="synConstant">3</span>; ++i)
{
  <span class="synStatement">if</span>(<span class="synConstant">2</span> == <span class="synType">rank</span>[i])
  {
    out_dominant_axis_index = i;
  }
  <span class="synStatement">if</span>(<span class="synConstant">1</span> == <span class="synType">rank</span>[i])
  {
    out_secondary_axis_index = i;
  }
}
out_dominant_axis_mask_vec[out_dominant_axis_index] = <span class="synConstant">1.0</span>;
out_secondary_axis_mask_vec[out_secondary_axis_index] = <span class="synConstant">1.0</span>;

<span class="synStatement">return</span> out_dominant_axis_mask_vec;
</pre>
</div>

---

[元のはてなブログ記事](https://nagakagachi.hatenablog.com/entry/2026/01/28/234656)
