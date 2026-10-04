---
title: "UE5.2でC++プロジェクトのビルド時間が増加した問題の対処 [UE][UE5.2]"
date: "2023-06-10T22:17:12+09:00"
draft: false
url: "/entry/2023/06/10/221712/"
categories: ["C++", "GlobalShader", "Graphics", "UE5", "UnrealC++", "シェーダ"]
hatena_author: "nagakagachi"
hatena_original_url: "https://nagakagachi.hatenablog.com/entry/2023/06/10/221712"
hatena_basename: "2023/06/10/221712"
math: false
---

<p>UE5.1からUE5.2へアップデートしてから, <a class="keyword" href="https://d.hatena.ne.jp/keyword/C%2B%2B">C++</a>プロジェクトのビルド時間が5倍以上に増えて困った.</p><p><a class="keyword" href="https://d.hatena.ne.jp/keyword/%A5%BD%A1%BC%A5%B9%A5%B3%A1%BC%A5%C9">ソースコード</a>を色々書き換えて調べたところ,</p>

<blockquote>
<p>GlobalShader派生クラスへの<a class="keyword" href="https://d.hatena.ne.jp/keyword/SRV">SRV</a>, UAV設定関数をフラットに記述する数が大きく影響</p>

</blockquote>


というところまでわかったのでメモ.  
  
私と同じ沼にハマったひとの役にたてば幸い.



具体的には以下のUtil関数が該当


<pre class="code c++" data-lang="c++" data-unlink>RenderCore/Public/ShaderParameterUtils.h
SetSRVParameter()
SetUAVParameter()</pre><p><br />
これらを一つの関数内で直接大量に(フラットに)記述するとビルド時間が大きく増加する模様.<br />
対策としては <strong>Shader単位等で関数化してそれを呼び出すような記述</strong> とするとUE5.1以前と同じくらいのビルド時間だった.</p>
<pre class="code c++" data-lang="c++" data-unlink>// ビルド時間が増えるパターン 100個くらい並んでました.
void MainFunc()
{
    // 全てのShaderに対するSetSRV/SetUAVをフラットに記述.
    SetSRVParameter(ShaderA, SRV);
    SetSRVParameter(ShaderA, SRV);
    SetUAVParameter(ShaderA, UAV);
    SetUAVParameter(ShaderA, UAV);
    ...
    SetSRVParameter(ShaderZ, SRV);
    SetSRVParameter(ShaderZ, SRV);
    SetUAVParameter(ShaderZ, UAV);
    SetUAVParameter(ShaderZ, UAV);
}</pre><p><br />
エンジン側の<a class="keyword" href="https://d.hatena.ne.jp/keyword/%A5%BD%A1%BC%A5%B9%A5%B3%A1%BC%A5%C9">ソースコード</a>を見るとシェーダ毎等で関数に分けていたため,<br />
そのように書き直したところビルド時間が以前と同じくらいになった.<br />
<br />
</p>
<pre class="code c++" data-lang="c++" data-unlink>// ビルド時間が増えないパターン.
void SetParamShaderA()
{
    SetSRVParameter(ShaderA, SRV);
    SetSRVParameter(ShaderA, SRV);
    SetUAVParameter(ShaderA, UAV);
    SetUAVParameter(ShaderA, UAV);
    ...
}
...
void SetParamShaderZ()
{
    SetSRVParameter(ShaderZ, SRV);
    SetSRVParameter(ShaderZ, SRV);
    SetUAVParameter(ShaderZ, UAV);
    SetUAVParameter(ShaderZ, UAV);
    ...
}
void MainFunc()
{
    // Shader毎のSRV/UAV設定メソッドを記述.
    SetParamShaderA(...);
    ...
    SetParamShaderZ(...);
}</pre>





私のプロジェクトでは前者の場合 8分前後 かかっていたものが, 後者に修正したところ 1分前後 に短縮された.  
  
========== リビルド は 08:04.257 分 かかりました ==========  
  
↓  
  
========== リビルド は 01:12.661 分 かかりました ==========



Inlineやtemplate展開が関係していたりするのでしょうか?  
  
詳しい人がいれば教えてください



以上

---

[元のはてなブログ記事](https://nagakagachi.hatenablog.com/entry/2023/06/10/221712)
