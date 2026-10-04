---
title: "Physics Simulation 資料メモ"
date: "2021-08-12T22:37:02+09:00"
draft: false
url: "/entry/2021/08/12/223702/"
categories: []
hatena_author: "nagakagachi"
hatena_original_url: "https://nagakagachi.hatenablog.com/entry/2021/08/12/223702"
hatena_basename: "2021/08/12/223702"
math: true
---

<p><a class="keyword" href="http://d.hatena.ne.jp/keyword/Twitter">Twitter</a>ではあとから探すのが大変なためこちらにまとめる.</p>

<div class="section">
    

### Constraints Derivation for Rigid Body Simulation in 3D


    
<ul>
<li>Daniel Chappuis,</li>
</ul><p><a href="https://danielchappuis.ch/download/ConstraintsDerivationRigidBody3D.pdf">https://danielchappuis.ch/download/ConstraintsDerivationRigidBody3D.pdf</a><br />
拘束力の定義から丁寧に式変形をしていてわかりやすい.<br />
2剛体の<a class="keyword" href="http://d.hatena.ne.jp/keyword/%BE%F5%C2%D6%A5%D9%A5%AF%A5%C8%A5%EB">状態ベクトル</a>( <span class="math-inline">\(R^{14}\)</span> )と変位ベクトル( <span class="math-inline">\(R^{14}\)</span> )の回転成分はQuaternionで表現.<br />
2剛体の速度ベクトル( <span class="math-inline">\(R^{12}\)</span> )の回転成分は角速度ベクトルで表現.<br />
変位ベクトルと速度ベクトルの回転成分の表現の差異やそれを考慮した変形についても説明がある.<br />
Ball-And-Socket-JointやHinge-Joint等、各種のジョイント系の拘束条件やそのJacobianの導出の説明がある.<br />
Baumgarte Stabilizationの項の追加有り.</p>

</div>
<div class="section">
    

### 3D Constraint Derivations for Impulse Solvers (July 1, 2015 v1.00)


    
<ul>
<li>Marijn Tamis,</li>
</ul><p><a href="http://www.mft-spirit.nl/files/MTamis_Constraints.pdf">http://www.mft-spirit.nl/files/MTamis_Constraints.pdf</a><br />
Point DIstanse, Contact, Hinge, Quaternion Constraint等多数の拘束条件とそのJacobianが記載されている.</p>

</div>
<div class="section">
    

### Constraint based physics solver (June 15, 2015 (v1.02))


    
<ul>
<li>Marijn Tamis, Giuseppe Maggiore,</li>
</ul><p><a href="http://mft-spirit.nl/files/MTamis_ConstraintBasedPhysicsSolver.pdf">http://mft-spirit.nl/files/MTamis_ConstraintBasedPhysicsSolver.pdf</a><br />
Contact Constraint や Distance Constraint 等のシンプルな拘束についてはこちらがわかりやすいかもしれない.<br />
Baumgarte Stabilizationの項の追加有り.<br />
反復ソルバの Projected Gauss-Seidel の<a class="keyword" href="http://d.hatena.ne.jp/keyword/%B5%BC%BB%F7%A5%B3%A1%BC%A5%C9">擬似コード</a>有り.<br />
<span style="font-size: 80%">ただしDistance ConstraintのLinearVelocityに対応する部分が正規化ベクトルになっていない点が少々怪しい気がする.</span><br />
</p>

</div>
<div class="section">
    

### Position Based Dynamics


    
<ul>
<li>Matthias Müller, Bruno Heidelberger, Marcus Hennix, John Ratcliff,</li>
</ul><p><a href="https://matthias-research.github.io/pages/publications/posBasedDyn.pdf">https://matthias-research.github.io/pages/publications/posBasedDyn.pdf</a><br />
Matthias Müller氏のPBDの大元.</p>

</div>
<div class="section">
    

### XPBD: Position-Based Simulation of Compliant Constrained Dynamics


    
<ul>
<li>Miles Macklin, Matthias M ̈uller, Nuttapong Chentanez,</li>
</ul><p><a href="http://mmacklin.com/xpbd.pdf">http://mmacklin.com/xpbd.pdf</a><br />
拡張PBD.<br />
反復数によって剛性が変わってしまう問題を解決する.</p>

</div>
<div class="section">
    

### Detailed Rigid Body Simulation with Extended Position Based Dynamics


    
<ul>
<li>Matthias Müller, Miles Macklin, Nuttapong Chentanez, Stefan Jeschke, Tae-Yong Kim,</li>
</ul><p><a href="https://matthias-research.github.io/pages/publications/PBDBodies.pdf">https://matthias-research.github.io/pages/publications/PBDBodies.pdf</a><br />
PBDの大元の著者の最近のもの.<br />
PBDの反復ソルバで制約条件の更新タイミングを変えることでより効率的且つ安定した結果になるというものらしい.<br />
個人的にはPBDでのAngular Constraints等の説明がある部分が嬉しい.<br />
<br />
</p>

</div>
<div class="section">
    

### Game Physics : Utrecht University - Game and Media Technology Master Program


    
<ul>
<li>Amir Vaxman</li>
</ul><p><a href="http://www.cs.uu.nl/docs/vakken/mgp/2018-2019/">http://www.cs.uu.nl/docs/vakken/mgp/2018-2019/</a><br />
<a class="keyword" href="http://d.hatena.ne.jp/keyword/%A5%E6%A5%C8%A5%EC%A5%D2%A5%C8">ユトレヒト</a>大学(Utrecht University)の2019年のGame Physics講座のSlide資料.<br />
11のLectureでBasic PhysicsからConstraint Based, Position Based, 有限要素法, Fluidまで幅広くカバーしていてとても気になる.</p>

</div>

---

[元のはてなブログ記事](https://nagakagachi.hatenablog.com/entry/2021/08/12/223702)
