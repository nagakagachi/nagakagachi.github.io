---
title: "論文メモ[CARL: Controllable Agent with Reinforcement Learning for Quadruped Locomotion](SIGGRAPH2020)"
date: "2020-05-16T19:35:06+09:00"
draft: false
url: "/entry/2020/05/16/193506/"
categories: ["Animation", "Physics", "SIGGRAPH", "SIGGRAPH2020"]
hatena_author: "nagakagachi"
hatena_original_url: "https://nagakagachi.hatenablog.com/entry/2020/05/16/193506"
hatena_basename: "2020/05/16/193506"
math: false
---

<p><iframe width="480" height="270" src="https://www.youtube.com/embed/t9CdF_Pl19Q?feature=oembed" frameborder="0" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe><cite class="hatena-citation"><a href="https://www.youtube.com/watch?v=t9CdF_Pl19Q">www.youtube.com</a></cite><br />
</p>
<ul class="table-of-contents">
<li><a href="#Paper">Paper</a></li>
<li><a href="#Abstract">Abstract</a></li>
<li><a href="#Introduction">Introduction</a></li>
<li><a href="#Proposed-Method">Proposed Method</a></li>
<li><a href="#関連研究">関連研究</a></li>
</ul>
<div class="section">
    

<h3 id="Paper">Paper</h3>


<p><iframe src="https://hatenablog-parts.com/embed?url=https%3A%2F%2Finventec-ai-center.github.io%2Fprojects%2FCARL%2Findex.html" title="CARL: Controllable Agent with Reinforcement Learning for Quadruped Locomotion" class="embed-card embed-webcard" scrolling="no" frameborder="0" style="display: block; width: 100%; height: 155px; max-width: 500px; margin: 10px 0px;"></iframe><cite class="hatena-citation"><a href="https://inventec-ai-center.github.io/projects/CARL/index.html">inventec-ai-center.github.io</a></cite><br />
</p>

</div>
<div class="section">
    

<h3 id="Abstract">Abstract</h3>


<p>本論文では物理ベース制御アニメーションで駆動するエージェントに対して、ユーザによる制御が可能且つダイナミックな環境に自然に反応する四足歩行エージェント「CARL」を提案する。本研究ではエージェントは段階的に学習する。まずアニメーションクリップを模倣して身体を制御するように学習する。次にユーザによる高度な制御に対して適切なアニメーションを対応させる行動分布を学習する。行動分布の獲得にはGenerative Adversarial Networksを用いる。さらに深層<a class="keyword" href="http://d.hatena.ne.jp/keyword/%B6%AF%B2%BD%B3%D8%BD%AC">強化学習</a>によるfine-tuningによって、外部からの摂動から回復しつつ滑らかな遷移を可能にする。本研究では、ユーザの制御に対する追従性能を計測し、生成された動作を視覚的に分析することでその有効性を評価する。</p>

</div>
<div class="section">
    

<h3 id="Introduction">Introduction</h3>


    

(1)動的環境と物理的に相互作用する能力と，  
  
(2)参照モーションクリップから学習した自然な動きを採用することで，データ駆動型の物理ベースの制御可能な四足歩行エージェントを提案する．

<p>複数段階のプロセスからなり、はじめに模倣によってリファレンスモーションを学習、次に速度や向きなどの高度なユーザー制御をGenerative Adversarial Networksを用いたjoint-actionに<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%DE%A5%C3%A5%D4%A5%F3%A5%B0">マッピング</a>することを学習する。</p>

本研究の貢献をまとめると次のようになる。



<ul>
<li>高次のユーザ制御と学習した自然な動きを効果的に<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%DE%A5%C3%A5%D4%A5%F3%A5%B0">マッピング</a>するための GAN Supervision <a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%D5%A5%EC%A1%BC%A5%E0%A5%EF%A1%BC%A5%AF">フレームワーク</a></li>
<li>DRLを用いて訓練された四足歩行エージェントのための物理ベースのコントローラで、アクションラベルを必要とせずに意味のある反応を生成しながら、様々な外部摂動に適応することが可能</li>
<li>高レベルのナビゲーションモジュールをエージェントに接続する方法</li>
</ul>
</div>
<div class="section">
    

<h3 id="Proposed-Method">Proposed Method</h3>


    

本研究では、高度なユーザ制御に追従しながら、外部からの擾乱を受けて自然な動きや反応を生成する物理ベースのコントローラを設計することを目的とする。生成された動きは、リファレンスモーションの動きに似ていれば自然なものと評価する。そのために、コントローラを3段階に分けて学習させる。



第 1 段階では、リファレンスモーションクリップの自然な動きを模倣学習により物理ベースのコントローラに伝達することを目的としている。これは物理ベースのコントローラが従うべき行動分布を方策ネットワークで学習することで達成される。  
  
この方策ネットワークはプリミティブネットワークと歩法ネットワークを含み、行動分布を低レベルプリミティブ分布に分解する。結果としてこの方策ネットワークは物理ベースのコントローラが自然な動きを作り出すことを可能にする行動分布を生成し、アニメーションと物理の橋渡しに成功した。



2つ目の学習段階ではGANコントローラーアダプタを採用し、高レベルの歩法ネットワークが先に学習した自然な行動分布を近似できるようにした。しかし、2つ目の訓練段階では外部摂動がないため、外部からのノイズに対応できない。



そこで最後に GAN regularized DRL fine-tuning を追加し、コントローラがそのような外部摂動の影響から回復できるようにする。



</div>
<div class="section">
    

<h3 id="関連研究">関連研究</h3>


<p>物理ベース制御アニメーションの具体的な方策や実装などについてはこちらのほうが詳しそう<br />
<iframe src="https://hatenablog-parts.com/embed?url=https%3A%2F%2Fxbpeng.github.io%2Fprojects%2FMCP%2Findex.html" title="MCP: Learning Composable Hierarchical Control with Multiplicative Compositional Policies" class="embed-card embed-webcard" scrolling="no" frameborder="0" style="display: block; width: 100%; height: 155px; max-width: 500px; margin: 10px 0px;"></iframe><cite class="hatena-citation"><a href="https://xbpeng.github.io/projects/MCP/index.html">xbpeng.github.io</a></cite></p>

</div>

---

[元のはてなブログ記事](https://nagakagachi.hatenablog.com/entry/2020/05/16/193506)
