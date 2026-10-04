---
title: "3要素ソートのメモ (3element pattern sort)"
date: "2022-05-23T21:28:04+09:00"
draft: false
url: "/entry/2022/05/23/212804/"
categories: ["C++"]
hatena_author: "nagakagachi"
hatena_original_url: "https://nagakagachi.hatenablog.com/entry/2022/05/23/212804"
hatena_basename: "2022/05/23/212804"
math: false
---

3要素をパターンでソート.  
  
安定ソートではないことに注意.

<p><span style="font-size: 80%">久しぶりの記事がこれですよ</span><br />
</p>
<pre class="code lang-cpp" data-lang="cpp" data-unlink><span class="synComment">// パターン.</span>
<span class="synType">constexpr</span> <span class="synType">int</span> k_sort_pattern_3[<span class="synConstant">8</span>][<span class="synConstant">3</span>]
{
    {<span class="synConstant">2</span>, <span class="synConstant">1</span>, <span class="synConstant">0</span>},  <span class="synComment">// 000-&gt; 0</span>
    {<span class="synConstant">0</span>, <span class="synConstant">2</span>, <span class="synConstant">1</span>},  <span class="synComment">// 001-&gt; 1</span>
    {<span class="synConstant">1</span>, <span class="synConstant">0</span>, <span class="synConstant">2</span>},  <span class="synComment">// 010-&gt; 2</span>
    {<span class="synConstant">0</span> ,<span class="synConstant">1</span>, <span class="synConstant">2</span>},  <span class="synComment">// 011-&gt; 3</span>
    {<span class="synConstant">2</span>, <span class="synConstant">1</span>, <span class="synConstant">0</span>},  <span class="synComment">// 100-&gt; 4</span>
    {<span class="synConstant">2</span>, <span class="synConstant">0</span>, <span class="synConstant">1</span>},  <span class="synComment">// 101-&gt; 5</span>
    {<span class="synConstant">1</span>, <span class="synConstant">2</span>, <span class="synConstant">0</span>},  <span class="synComment">// 110-&gt; 6</span>
    {<span class="synConstant">0</span> ,<span class="synConstant">1</span>, <span class="synConstant">2</span>},  <span class="synComment">// 111-&gt; 7</span>
};
<span class="synComment">// 3要素からパターンID計算.</span>
<span class="synType">constexpr</span> <span class="synType">auto</span> get_sort_pattern_3 = [](<span class="synType">const</span> <span class="synType">float</span> (&amp;ar)[<span class="synConstant">3</span>])
{
    <span class="synStatement">return</span> ((ar[<span class="synConstant">0</span>] &lt;= ar[<span class="synConstant">1</span>]) ? <span class="synConstant">1</span> : <span class="synConstant">0</span>) + ((ar[<span class="synConstant">1</span>] &lt;= ar[<span class="synConstant">2</span>]) ? <span class="synConstant">2</span> : <span class="synConstant">0</span>) + ((ar[<span class="synConstant">2</span>] &lt;= ar[<span class="synConstant">0</span>]) ? <span class="synConstant">4</span> : <span class="synConstant">0</span>);
};

<span class="synComment">// ソート対象の3要素配列.</span>
<span class="synType">constexpr</span> <span class="synType">float</span> src[<span class="synConstant">3</span>] = { -<span class="synConstant">3.0f</span>,<span class="synConstant">3.0f</span>,-<span class="synConstant">2.3f</span> };
<span class="synComment">// パターンID取得.</span>
<span class="synType">constexpr</span> <span class="synType">int</span> sort_pattern = <span class="synIdentifier">get_sort_pattern_3</span>(src);

<span class="synComment">// パターンでソート順に取り出し.</span>
<span class="synType">constexpr</span> <span class="synType">float</span> sort_v0 = src[k_sort_pattern_3[sort_pattern][<span class="synConstant">0</span>]];
<span class="synType">constexpr</span> <span class="synType">float</span> sort_v1 = src[k_sort_pattern_3[sort_pattern][<span class="synConstant">1</span>]];
<span class="synType">constexpr</span> <span class="synType">float</span> sort_v2 = src[k_sort_pattern_3[sort_pattern][<span class="synConstant">2</span>]];

<span class="synComment">// チェック.</span>
<span class="synStatement">static_assert</span>(sort_v0 &lt;= sort_v1 &amp;&amp; sort_v1 &lt;= sort_v2);
</pre>

---

[元のはてなブログ記事](https://nagakagachi.hatenablog.com/entry/2022/05/23/212804)
