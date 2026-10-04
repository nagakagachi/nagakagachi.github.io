---
title: "最適化 Newton法メモ"
date: "2018-07-28T00:24:57+09:00"
draft: false
url: "/entry/2018/07/28/002457/"
categories: ["数学", "最適化"]
hatena_author: "nagakagachi"
hatena_original_url: "https://nagakagachi.hatenablog.com/entry/2018/07/28/002457"
hatena_basename: "2018/07/28/002457"
math: true
hatena_original_image: "https://chart.apis.google.com/chart?cht=tx&chl=f%28%5Cvec%7Bx%7D%20%2B%20%5Cvec%7Bh%7D%29%20%3D%20f%28%5Cvec%7Bx%7D%29%20%2B%20dot%28%5Cvec%7Bh%5ET%7D%2C%5Cnabla%20f%28%5Cvec%7Bx%7D%29%29%20%2B%20%5Cfrac%7B1%7D%7B2%7D%20dot%28%5Cvec%7Bh%5ET%7D%2C%20%5CDelta%20f%28%5Cvec%7Bx%7D%29%5Cvec%7Bh%7D%29"
---

自分の言葉で書いて覚えるため（誤りがあればご指摘ください）

<br />
<p> 関数 <span class="math-inline">\(f(\vec{x})\)</span>  の2次までのTaylor展開</p><p><span class="math-inline">\(f(\vec{x} + \vec{h}) = f(\vec{x}) + dot(\nabla f(\vec{x}), \vec{h}) + \frac{1}{2} dot(\vec{h^T}, \nabla^2 f(\vec{x})\vec{h})\)</span></p><p>ここで <span class="math-inline">\(\nabla^2 f(\vec{x})\)</span> はHesse行列</p><p>右辺を最小化にするような<span class="math-inline">\(\vec{h}\)</span>によって<span class="math-inline">\(\vec{x}_{next} = \vec{x} + \vec{h}\)</span>と更新することで<br />
<span class="math-inline">\(f(\vec{x})\)</span>をより小さくする<span class="math-inline">\(\vec{x}\)</span>が得られる。<br />
そのために<span class="math-inline">\(\vec{h}\)</span>で<a class="keyword" href="http://d.hatena.ne.jp/keyword/%C8%F9%CA%AC">微分</a>して<span class="math-inline">\(=0\)</span>となるような<span class="math-inline">\(\vec{h}\)</span>を求める</p><p><span class="math-inline">\(\frac{\mathrm{d}  f(\vec{x}+\vec{h})}{\mathrm{d} \vec{h}} = \frac{\mathrm{d}  f(\vec{x})}{\mathrm{d} \vec{h}} + \frac{\mathrm{d} dot(\nabla f(\vec{x}), \vec{h})}{\mathrm{d}\vec{h}} + \frac{1}{2} \frac{\mathrm{d} dot(\vec{h^T}, \nabla^2 f(\vec{x})\vec{h})}{\mathrm{d} \vec{h}} = 0\)</span><br />
 <br />
右辺第一項は変数<span class="math-inline">\(\vec{h}\)</span>が無いので<span class="math-inline">\(0\)</span></p><p>右辺第二項は<a class="keyword" href="http://d.hatena.ne.jp/keyword/%C6%E2%C0%D1">内積</a>をベクトル<span class="math-inline">\(\vec{h}\)</span>で<a class="keyword" href="http://d.hatena.ne.jp/keyword/%C8%F9%CA%AC">微分</a>するので<span class="math-inline">\(\nabla f(\vec{x})\)</span></p><p>右辺第三項は二次の同次<a class="keyword" href="http://d.hatena.ne.jp/keyword/%C2%BF%B9%E0%BC%B0">多項式</a>の二次形式<span class="math-inline">\(dot(\vec{x^T}, A\vec{x})\)</span>の<a class="keyword" href="http://d.hatena.ne.jp/keyword/%C8%F9%CA%AC">微分</a>なので、</p><p><span class="math-inline">\(\frac{1}{2} \frac{\mathrm{d} dot(\vec{h^T}, \nabla^2 f(\vec{x})\vec{h})}{\mathrm{d} \vec{h}} = \frac{1}{2} (\nabla^2 f(\vec{x}) + \nabla^2 f(\vec{x})^T)\vec{h}\)</span></p><p>ここで<span class="math-inline">\(f(x)\)</span>が二階<a class="keyword" href="http://d.hatena.ne.jp/keyword/%C8%F9%CA%AC">微分</a>可能な場合にはHesse行列<span class="math-inline">\(\nabla^2 f(x)\)</span>は対称行列となるため、</p><p><span class="math-inline">\(\frac{1}{2} (\nabla^2 f(\vec{x}) + \nabla^2 f(\vec{x})^T)\vec{h} = \frac{1}{2} (\nabla^2 f(\vec{x}) + \nabla^2 f(\vec{x}))\vec{h} = \frac{1}{2} (2 \nabla^2 f(\vec{x}) \vec{h}) = \nabla^2 f(\vec{x}) \vec{h}\)</span></p>

まとめると

<p><span class="math-inline">\(\frac{\mathrm{d} f(\vec{x}+\vec{h})}{\mathrm{d} \vec{h}} = 0 + \nabla f(\vec{x}) + \nabla^2 f(\vec{x}) \vec{h} =  \nabla f(\vec{x}) + \nabla^2 f(\vec{x}) \vec{h} = 0\)</span></p><p>変形して<br />
<span class="math-inline">\(\nabla^2 f(\vec{x}) \vec{h} = -\nabla f(\vec{x})\)</span></p><p>両辺の左からHesse行列<span class="math-inline">\(\nabla^2 f(\vec{x})\)</span>の<a class="keyword" href="http://d.hatena.ne.jp/keyword/%B5%D5%B9%D4%CE%F3">逆行列</a><span class="math-inline">\(\nabla^2 f(\vec{x})^{-1}\)</span>をかけると</p><p><span class="math-inline">\(\vec{h} = -\nabla^2 f(\vec{x})^{-1} \nabla f(\vec{x})\)</span><br />
 <br />
このように求めたベクトル<span class="math-inline">\(\vec{h}\)</span>をNewton方向とよび、ステップ幅<span class="math-inline">\(\alpha ( 0 &lt; \alpha \leq 1)\)</span>を用いて</p><p><span class="math-inline">\(\vec{x}_{next} = \vec{x} + \alpha \vec{h} = \vec{x} - \alpha \nabla^2 f(\vec{x})^{-1} \nabla f(\vec{x})\)</span></p><p>で<span class="math-inline">\(\vec{x}\)</span>を更新していく<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%A2%A5%EB%A5%B4%A5%EA%A5%BA%A5%E0">アルゴリズム</a>をNewton法というらしい<br />
(<span class="math-inline">\(\alpha\)</span> は大抵1らしい. そういう<span class="math-inline">\(\vec{h}\)</span>を計算したんだから)</p><p>実際には高次元の場合に <span class="math-inline">\(\nabla^2 f(\vec{x})\)</span> の<a class="keyword" href="http://d.hatena.ne.jp/keyword/%B5%D5%B9%D4%CE%F3">逆行列</a>の計算コストが増大するため、<br />
<a class="keyword" href="http://d.hatena.ne.jp/keyword/%B5%D5%B9%D4%CE%F3">逆行列</a>を近似して計算するらしい→準Newton法<br />
あとそもそもHesse行列が正則じゃないと<a class="keyword" href="http://d.hatena.ne.jp/keyword/%B5%D5%B9%D4%CE%F3">逆行列</a>が求められないし、<br />
Hesse行列が正定値でない場合に得られるNewton方向は<br />
関数値が増える方向だったりするのでいろいろ欠点もある</p><br />
<p>最後の式 <span class="math-inline">\(\vec{x}_{next} = \vec{x} - \alpha \nabla^2 f(\vec{x})^{-1} \nabla f(\vec{x})\)</span> は1変数関数<span class="math-inline">\(f(x)\)</span>についてのNewton法である</p><p><span class="math-inline">\(x_{next} = x - \frac{f'(x)}{f''(x)}\)</span></p><p>を多変数関数に拡張したものといえる( 逆数 <span class="math-inline">\(\frac{1}{f''(x)}\)</span> が <a class="keyword" href="http://d.hatena.ne.jp/keyword/%B5%D5%B9%D4%CE%F3">逆行列</a> <span class="math-inline">\(\nabla^2 f(\vec{x})^{-1}\)</span>に対応)</p><br />
<p>求根<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%A2%A5%EB%A5%B4%A5%EA%A5%BA%A5%E0">アルゴリズム</a>であるNewton法(Newton-Raphson法)は<br />
関数<span class="math-inline">\(f(x) = 0\)</span>となるような<span class="math-inline">\(x\)</span>を求めるために</p><p><span class="math-inline">\(x_{next} = x - \frac{f(x)}{f'(x)}\)</span></p><p>で更新するが、Newton法で<a class="keyword" href="http://d.hatena.ne.jp/keyword/%B6%CB%C3%CD">極値</a>を求める場合には <span class="math-inline">\(f(x)\)</span> の<a class="keyword" href="http://d.hatena.ne.jp/keyword/%B6%CB%C3%CD">極値</a>( <span class="math-inline">\(f'(x) = 0\)</span>の点 )を求めるために</p><p><span class="math-inline">\(x_{next} = x - \frac{f'(x)}{f''(x)}\)</span></p>

として更新をするということらしい

<br />
<br />
<p>参考とさせていただいた書籍およびサイト<div class="hatena-asin-detail"><a href="http://www.amazon.co.jp/exec/obidos/ASIN/4621088548/nagakagachi-22/"><img src="images/4bdde6035410ad91fd0039ab676cdcf06905a696f6d272868151106313ca2d03.jpg" class="hatena-asin-detail-image" alt="基礎系 数学 最適化と変分法 (東京大学工学教程)" title="基礎系 数学 最適化と変分法 (東京大学工学教程)"></a><div class="hatena-asin-detail-info"><p class="hatena-asin-detail-title"><a href="http://www.amazon.co.jp/exec/obidos/ASIN/4621088548/nagakagachi-22/">基礎系 数学 最適化と変分法 (東京大学工学教程)</a></p><ul><li><span class="hatena-asin-detail-label">作者:</span> 寒野善博,土谷隆,<a class="keyword" href="http://d.hatena.ne.jp/keyword/%C5%EC%B5%FE%C2%E7%B3%D8">東京大学</a>工学教程編纂委員会</li><li><span class="hatena-asin-detail-label">出版社/メーカー:</span> <a class="keyword" href="http://d.hatena.ne.jp/keyword/%B4%DD%C1%B1%BD%D0%C8%C7">丸善出版</a></li><li><span class="hatena-asin-detail-label">発売日:</span> 2014/10/22</li><li><span class="hatena-asin-detail-label">メディア:</span> 単行本（ソフトカバー）</li><li><a href="http://d.hatena.ne.jp/asin/4621088548/nagakagachi-22" target="_blank">この商品を含むブログを見る</a></li></ul></div><div class="hatena-asin-detail-foot"></div></div><a href="http://www.dais.is.tohoku.ac.jp/~shioura/teaching/mp12/mp12-13.pdf">http://www.dais.is.tohoku.ac.jp/~shioura/teaching/mp12/mp12-13.pdf</a><br />
<a href="https://mosko.tokyo/post/optimization/#%E3%83%8B%E3%83%A5%E3%83%BC%E3%83%88%E3%83%B3%E6%B3%95">&#x6700;&#x9069;&#x5316;&#x624B;&#x6CD5;&#x306B;&#x3064;&#x3044;&#x3066;&#x30FC;&#x52FE;&#x914D;&#x6CD5;&#xFF0C;&#x30CB;&#x30E5;&#x30FC;&#x30C8;&#x30F3;&#x6CD5;&#xFF0C;&#x6E96;&#x30CB;&#x30E5;&#x30FC;&#x30C8;&#x30F3;&#x6CD5;&#x306A;&#x3069;&#x30FC; | moskomule log</a><br />
<iframe src="https://hatenablog-parts.com/embed?url=http%3A%2F%2Fdsl4.eee.u-ryukyu.ac.jp%2FDOCS%2Fnlp%2Fnode5.html" title="Newton法" class="embed-card embed-webcard" scrolling="no" frameborder="0" style="display: block; width: 100%; height: 155px; max-width: 500px; margin: 10px 0px;"></iframe><cite class="hatena-citation"><a href="http://dsl4.eee.u-ryukyu.ac.jp/DOCS/nlp/node5.html">dsl4.eee.u-ryukyu.ac.jp</a></cite></p>

---

[元のはてなブログ記事](https://nagakagachi.hatenablog.com/entry/2018/07/28/002457)
