---
title: "Kd-Treeメモ"
date: "2020-06-18T00:10:27+09:00"
draft: false
url: "/entry/2020/06/18/001027/"
categories: []
hatena_author: "nagakagachi"
hatena_original_url: "https://nagakagachi.hatenablog.com/entry/2020/06/18/001027"
hatena_basename: "2020/06/18/001027"
math: false
---

<div class="section">
    

### Stackless Traversal


<p>Stackを使わない<a class="keyword" href="http://d.hatena.ne.jp/keyword/%CC%DA%B9%BD%C2%A4">木構造</a>の走査. </p>

<div class="section">
    

#### Kd-Tree


    
<div class="section">
    

##### kd-restart


<p><a href="https://graphics.stanford.edu/papers/gpu_kdtree/kdtree.pdf">https://graphics.stanford.edu/papers/gpu_kdtree/kdtree.pdf</a><br />
子ノードのうち始点に近い方の子を先に処理し、<a class="keyword" href="http://d.hatena.ne.jp/keyword/leaf">leaf</a>に到達して処理をしたら tminを<a class="keyword" href="http://d.hatena.ne.jp/keyword/tmax">tmax</a>で更新し、<a class="keyword" href="http://d.hatena.ne.jp/keyword/tmax">tmax</a>を新たにルートとの交差で更新してから走査を続ける.<br />
tmin,<a class="keyword" href="http://d.hatena.ne.jp/keyword/tmax">tmax</a>だけを保持して都度走査ノードを検索してリスタートする.</p>

</div>
<div class="section">
    

##### Rope


<p>水平方向のノード間のリンク(Rope)によってStacklessな走査を実現する.<br />
<a href="http://www.johannes-guenther.net/StacklessGPURT/StacklessGPURT.pdf">http://www.johannes-guenther.net/StacklessGPURT/StacklessGPURT.pdf</a><br />
<a href="https://www.cin.ufpe.br/~als3/saap/ArturLiraDosSantos-ArtigoIJPP.pdf">https://www.cin.ufpe.br/~als3/saap/ArturLiraDosSantos-ArtigoIJPP.pdf</a></p>





</div>
</div>
</div>
<div class="section">
    

### Binary-Tree


<p><a href="http://jcgt.org/published/0002/01/03/paper.pdf">http://jcgt.org/published/0002/01/03/paper.pdf</a></p>

</div>

---

[元のはてなブログ記事](https://nagakagachi.hatenablog.com/entry/2020/06/18/001027)
