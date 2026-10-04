---
title: " UE4 TArrayのSetNumZeroedふるまいメモ"
date: "2018-08-26T16:38:03+09:00"
draft: false
url: "/entry/2018/08/26/163803/"
categories: ["UE4", "C++", "UnrealC++"]
hatena_author: "nagakagachi"
hatena_original_url: "https://nagakagachi.hatenablog.com/entry/2018/08/26/163803"
hatena_basename: "2018/08/26/163803"
math: false
---

<p><a class="keyword" href="http://d.hatena.ne.jp/keyword/UE4">UE4</a>.20.2</p><p><a class="keyword" href="http://d.hatena.ne.jp/keyword/UE4">UE4</a>のCodePluginでTArrayを多用していていつもSetNumZeroedの挙動を忘れるのでメモ</p><br />


TArray::SetNumZeroed(NewSize, bAllowShrinking)



<ul>
<li>SetNumZeroed()によって要<a class="keyword" href="http://d.hatena.ne.jp/keyword/%C1%C7%BF%F4">素数</a>が増える場合
<ul>
<li>ゼロ値要素が末尾に付加される。元の要素は変化しない。</li>
</ul></li>
</ul><pre class="code" data-lang="" data-unlink>TArray&lt;float&gt; testArray;
testArray.Add(1.0f);
testArray.Add(2.0f);
testArray.Add(3.0f); // { 1.0, 2.0, 3.0 }
testArray.SetNumZeroed(5); // { 1.0, 2.0, 3.0, 0.0, 0.0 }</pre>
<ul>
<li>SetNumZeroed()によって要<a class="keyword" href="http://d.hatena.ne.jp/keyword/%C1%C7%BF%F4">素数</a>が減る場合
<ul>
<li>単純に切り詰められる。元の要素は変化しない。</li>
</ul></li>
</ul><pre class="code" data-lang="" data-unlink>TArray&lt;float&gt; testArray;
testArray.Add(1.0f);
testArray.Add(2.0f);
testArray.Add(3.0f); // { 1.0, 2.0, 3.0 }
testArray.SetNumZeroed(1); // { 1.0 }</pre><p><br />
関係ないけどTArray<float>の要素を指定した値（ゼロとか）にするメソッドがほしい<br />
（ないよね？）</p>

---

[元のはてなブログ記事](https://nagakagachi.hatenablog.com/entry/2018/08/26/163803)
