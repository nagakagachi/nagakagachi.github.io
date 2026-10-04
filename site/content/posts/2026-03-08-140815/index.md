---
title: "Concurrent Binary Trees for Large-Scale Game Components 検証実装"
date: "2026-03-08T14:08:15+09:00"
draft: false
url: "/entry/2026/03/08/140815/"
categories: []
hatena_author: "nagakagachi"
hatena_original_url: "https://nagakagachi.hatenablog.com/entry/2026/03/08/140815"
hatena_basename: "2026/03/08/140815"
math: false
image: "images/a0f4e7a0e07c797977daca11a7bc4822bee579de46c1e9dd0c5bc71f97313358.png"
---

Adaptive Software Tessellation with Concurrent Binary Trees



数年前に実装したものですが検索性が良くないのでこちらにも  
  
一般メッシュに適用可能なGPU駆動ソフトウェアテッセレーションの手法を試してみました。  
  
論文の主要処理はすべてComputeShaderになります。

<p><a href="https://github.com/nagakagachi/sample_project?tab=readme-ov-file#adaptive-software-tessellation-with-concurrent-binary-trees">GitHub - nagakagachi/sample_project &middot; GitHub</a><br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/a0f4e7a0e07c797977daca11a7bc4822bee579de46c1e9dd0c5bc71f97313358.png" width="1200" height="694" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span></p><p>今回の手法の論文はこちら<br />
Concurrent Binary Trees for Large-Scale Game Components<br />
ANIS BENYOUB, Intel Corporation, France<br />
JONATHAN DUPUY, Intel Corporation, France<br />
<a href="https://dl.acm.org/doi/10.1145/3675371">https://dl.acm.org/doi/10.1145/3675371</a><br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/0143d7b89bb43375426dc4552154dc2ee16eb920499b50c9f114ee272a77fe06.png" width="903" height="663" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><span itemscope itemtype="http://schema.org/Photograph"><img src="images/f315f6ee4911441a80b3924a0cf2c352323039e3781b79f89d68a82e1fc5c1a4.png" width="723" height="315" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span></p><br />
<p>著者の以前のTessellation論文にもConcurrentBinaryTree(CBT)を使ったものがありますが、<br />
そちらは二等辺直角三角形に限定して、分割三角形の親子構造をCBTにマッピングする手法です。<br />
Concurrent Binary Trees (with application to longest edge bisection)<br />
JONATHAN DUPUY, Unity Technologies<br />
<a href="https://dl.acm.org/doi/10.1145/3406186">https://dl.acm.org/doi/10.1145/3406186</a></p><br />


一方で今回の論文は任意のメッシュに対して実行可能で、CBTを分割三角形の高速なメモリアロケーションのために利用しています。  
  
CBT(並行二分木)を利用する仕組み上、メモリ確保が二の冪乗に制限されるなど少し取り回しが悪い点などがありますが、  
  
一般メッシュに適用できてリアルタイムに動かせそうなソフトウェアテッセレーション手法としてよい感じかと思います。



コードはディレクトリにまとまっています。  
  
実行はmain.cppの NGL\_TEST\_SWTESSELLATION\_ENABLE を 1 にしてビルドするとシーンにテスト用のオブジェクトが表示されます。

---

[元のはてなブログ記事](https://nagakagachi.hatenablog.com/entry/2026/03/08/140815)
