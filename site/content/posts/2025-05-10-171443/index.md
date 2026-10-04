---
title: "曲線メモ"
date: "2025-05-10T17:14:43+09:00"
draft: false
url: "/entry/2025/05/10/171443/"
categories: []
hatena_author: "nagakagachi"
hatena_original_url: "https://nagakagachi.hatenablog.com/entry/2025/05/10/171443"
hatena_basename: "2025/05/10/171443"
math: true
---

n番煎じであっても自分でメモすることが...大事...!



<div class="section">
    

<h3 id="Cubic-Hermite-Spline">Cubic Hermite Spline</h3>


    

いわゆるエルミート曲線

<p>3次式<br />
<span class="math-inline">\(y(t) = a t^3 + b t^2 + c t + d\)</span><br />
とその<a class="keyword" href="https://d.hatena.ne.jp/keyword/%C6%B3%B4%D8%BF%F4">導関数</a><br />
<span class="math-inline">\(y′(t) = 3 a t^2 + 2 b t + c\)</span><br />
を考え, </p><p>2つの端点<span class="math-inline">\(t_0\)</span>, <span class="math-inline">\(t_1\)</span>で以下の4つの条件を満たすような係数<span class="math-inline">\(a,b,c,d\)</span>を求める.<br />
<span class="math-inline">\(y(t_0) = y_0\)</span><br />
<span class="math-inline">\(y(t_1) = y_1\)</span><br />
<span class="math-inline">\(y'(t_0) = d_0\)</span><br />
<span class="math-inline">\(y'(t_1) = d_1\)</span></p><p>4つの未知数と4つの方程式なので解ける.<br />
<span class="math-inline">\(a = 2 y_0 - 2 y_1 + d_0 + d_1\)</span><br />
<span class="math-inline">\(b = -3 y_0 + 3 y_1 - 2 d_0 - d_1\)</span><br />
<span class="math-inline">\(c = d_0\)</span><br />
<span class="math-inline">\(d = y_0\)</span></p><p>係数<span class="math-inline">\(a,b,c,d\)</span>による元の3次式は, 端点を通り且つ端点での接線が条件に一致するような曲線になる→ Cubic Hermite Curve<br />
<span class="math-inline">\(y(t) = (2 y_0 - 2 y_1 + d_0 + d_1) t^3 + (-3 y_0 + 3 y_1 - 2 d_0 - d_1) t^2 + d_0 t + y_0\)</span></p>

バリエーションによっては接線ではなく更に外側の2点を利用するものがある.

<p>また, 元の関数の定義域xを正規化された定義域t [0,1]へ変換して利用する場合には, x->tの変換によって接線の勾配が変化するため考慮する必要がある.<br />
<span class="math-inline">\(y(x) , x_0 &lt;= x &lt;= x_1\)</span><br />
<span class="math-inline">\(t = x / (x_1 - x_0)\)</span><br />
<span class="math-inline">\(dt = dx/(x_1 - x_0)\)</span><br />
<span class="math-inline">\(dy/dx = dy/(dt * (x_1 - x_0))\)</span><br />
<span class="math-inline">\(dy/dt = (x_1 - x_0) * dy/dx\)</span><br />
</p>
<pre class="code lang-cpp" data-lang="cpp" data-unlink><span class="synType">auto</span> CubicHermite = [](<span class="synType">float</span> t, <span class="synType">float</span> y0, <span class="synType">float</span> y1, <span class="synType">float</span> d0, <span class="synType">float</span> d1)
{
	<span class="synType">constexpr</span> <span class="synType">auto</span> k_a = <span class="synConstant">2.0</span> * y0 - <span class="synConstant">2.0</span> * y1 + d0 + d1;
	<span class="synType">constexpr</span> <span class="synType">auto</span> k_b = -<span class="synConstant">3.0</span> * y0 + <span class="synConstant">3.0</span> * y1 - <span class="synConstant">2.0</span> * d0 - d1;
	<span class="synType">constexpr</span> <span class="synType">auto</span> k_c = d0;
	<span class="synType">constexpr</span> <span class="synType">auto</span> k_d = y0;

	<span class="synStatement">return</span> k_a*(t*t*t) + k_b*(t*t) + k_c*(t) + k_d;
};

<span class="synType">constexpr</span> <span class="synType">auto</span> y0 = <span class="synConstant">0.0f</span>;
<span class="synType">constexpr</span> <span class="synType">auto</span> y1 = <span class="synConstant">1.0f</span>;
<span class="synType">constexpr</span> <span class="synType">auto</span> d0 = <span class="synConstant">1.0f</span>;
<span class="synType">constexpr</span> <span class="synType">auto</span> d1 = <span class="synConstant">1.0f</span>;
	
<span class="synType">constexpr</span> <span class="synType">auto</span> hv0 = <span class="synIdentifier">CubicHermite</span>(<span class="synConstant">0.0f</span>, y0, y1, d0 ,d1); <span class="synComment">// 0.0</span>
<span class="synType">constexpr</span> <span class="synType">auto</span> hv1 = <span class="synIdentifier">CubicHermite</span>(<span class="synConstant">0.5f</span>, y0, y1, d0 ,d1); <span class="synComment">// 0.5</span>
<span class="synType">constexpr</span> <span class="synType">auto</span> hv2 = <span class="synIdentifier">CubicHermite</span>(<span class="synConstant">0.8f</span>, y0, y1, d0 ,d1); <span class="synComment">// 0.8</span>
<span class="synType">constexpr</span> <span class="synType">auto</span> hv3 = <span class="synIdentifier">CubicHermite</span>(<span class="synConstant">1.0f</span>, y0, y1, d0 ,d1); <span class="synComment">// 1.0</span>
</pre>
</div>
<div class="section">
    

<h3 id="Catmull-rom-Spline">Catmull-rom Spline</h3>


<p>連続する点について隣接する4点から評価されるCubic Hermite Splineを接続した曲線シーケンス.<br />
接続部で一階の<a class="keyword" href="https://d.hatena.ne.jp/keyword/%C6%B3%B4%D8%BF%F4">導関数</a>が連続.</p>

</div>
<div class="section">
    

<h3 id="B-Spline">B-Spline</h3>


    
</div>
<div class="section">
    

<h3 id="References">References</h3>


<p><a href="https://en.wikipedia.org/wiki/Cubic_Hermite_spline">Cubic Hermite spline - Wikipedia</a><br />
<a href="https://ja.wikipedia.org/wiki/Catmull-Rom%E3%82%B9%E3%83%97%E3%83%A9%E3%82%A4%E3%83%B3%E6%9B%B2%E7%B7%9A">Catmull-Rom&#x30B9;&#x30D7;&#x30E9;&#x30A4;&#x30F3;&#x66F2;&#x7DDA; - Wikipedia</a><br />
<a href="https://tokoik.github.io/gg/ggnote04.pdf">https://tokoik.github.io/gg/ggnote04.pdf</a><br />
<a href="https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node16.html">1.4.1 B-splines</a></p>

</div>

---

[元のはてなブログ記事](https://nagakagachi.hatenablog.com/entry/2025/05/10/171443)
