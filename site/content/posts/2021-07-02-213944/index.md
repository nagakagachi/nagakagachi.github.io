---
title: "行優先と列優先のはなし(row-major, column-major)"
date: "2021-07-02T21:39:44+09:00"
draft: false
url: "/entry/2021/07/02/213944/"
categories: ["C++", "シェーダ", "Shader", "HLSL"]
hatena_author: "nagakagachi"
hatena_original_url: "https://nagakagachi.hatenablog.com/entry/2021/07/02/213944"
hatena_basename: "2021/07/02/213944"
math: false
---

<p>今ひとつ完全理解に至っていなかったので自分の言葉で残しておく<br />
間違ってたら<a class="keyword" href="https://d.hatena.ne.jp/keyword/%CD%C5%C0%BA%A4%B5%A4%F3">妖精さん</a>が直してくれる</p><p>(WEB上にたくさんある有用な記事を読んでわかる方は当記事をこれ以上読む必要は無い)<br />
<a href="https://docs.microsoft.com/ja-jp/windows/win32/direct3dhlsl/dx-graphics-hlsl-per-component-math">Per-Component &#x7B97;&#x8853;&#x6F14;&#x7B97; - Win32 apps | Microsoft Learn</a></p>





<div class="section">
    

<h3 id="行列の要素と演算">行列の要素と演算</h3>


    

行列の行と列の意味や行列要素の位置はrow-majorでもcolumn-majorでも変わることはない  
  
行とは行列の横方向のラインであるし、列は縦方向のラインである  
  
mat.\_11は1行目1列目の要素であり、mat.\_42は4行目2列目の要素である



行列とベクトルの乗算のルールもrow-majorでもcolumn-majorで変わることはない  
  
(ただしHLSL等ではベクトルは演算の位置によって適宜列ベクトルや行ベクトルに読み替えられる)


<pre class="code c++" data-lang="c++" data-unlink>V1 = M * V0; // Matrix4x4とVec4</pre>

は


<pre class="code c++" data-lang="c++" data-unlink>V1.x = M._11 * V0.x + M._12 * V0.y + M._13 * V0.y + M._14 * V0.w
V1.y = M._21 * V0.x + M._22 * V0.y + M._23 * V0.y + M._24 * V0.w
V1.z = M._31 * V0.x + M._32 * V0.y + M._33 * V0.y + M._34 * V0.w
V1.w = M._41 * V0.x + M._42 * V0.y + M._43 * V0.y + M._44 * V0.w</pre>

であり、


<pre class="code c++" data-lang="c++" data-unlink>V1 = V0 * M; // Matrix4x4とVec4</pre>

は


<pre class="code c++" data-lang="c++" data-unlink>V1.x = M._11 * V0.x + M._21 * V0.y + M._31 * V0.y + M._41 * V0.w
V1.y = M._12 * V0.x + M._22 * V0.y + M._32 * V0.y + M._42 * V0.w
V1.z = M._13 * V0.x + M._23 * V0.y + M._33 * V0.y + M._43 * V0.w
V1.w = M._14 * V0.x + M._24 * V0.y + M._34 * V0.y + M._44 * V0.w</pre>

である



</div>
<div class="section">
    

<h3 id="シェーダ側の行列のメモリレイアウト">シェーダ側の行列のメモリレイアウト</h3>


    

定数バッファ等でCPUから送られてきた行列のメモリ領域をどのように解釈するか  
  
row-majorとして解釈するのか、column-majorとして解釈するのかを指定する



Matrix4x4を考えた場合、メモリ上では連続する16個の値として扱われる



このメモリをrow-majorな行列として解釈すると  
  
0番目から4つを   \_11, \_12, \_13, \_14 に読み取り  
  
4番目から4つを   \_21, \_22, \_23, \_24 に読み取り  
  
8番目から4つを   \_31, \_32, \_33, \_34 に読み取り  
  
12番目から4つを \_41, \_42, \_43, \_44 に読み取る



row-major の場合は先頭から4つずつの行ベクトルとして解釈される

<br />


対してこのメモリをcolumn-majorな行列として解釈すると  
  
0番目から4つを   \_11, \_21, \_31, \_41 に読み取り  
  
4番目から4つを   \_12, \_22, \_32, \_42 に読み取り  
  
8番目から4つを   \_13, \_23, \_33, \_43 に読み取り  
  
12番目から4つを \_14, \_24, \_34, \_44 に読み取る



column-major の場合は先頭から4つずつの列ベクトルとして解釈される



</div>
<div class="section">
    

<h3 id="問題になる場合">問題になる場合</h3>


    

CPU側の行列型データのメモリレイアウトと、シェーダ側定数バッファの行列型のメモリレイアウトが一致していない場合に転置された行列として解釈されてしまう



DirectxMathのMatrixはrow-majorな定義となっており、HLSLのデフォルトはcolumn-majorとなっているらしいので注意が必要



</div>
<div class="section">
    

<h3 id="行列を左から掛けるのか右から掛けるのか問題">行列を左から掛けるのか右から掛けるのか問題</h3>


    

row-majorとcolumn-majorはあくまでメモリレイアウトの問題であり、ベクトルに対して行列を右から掛けるのか左から掛けるのかというのは別問題



例えば回転行列を考えて、



<ul>
<li>基底ベクトルを列ベクトルとして配置した行列
<ul>
<li>左から掛けるべき</li>
</ul></li>
<li>基底ベクトルを行ベクトルとして配置した行列
<ul>
<li>右から掛けるべき</li>
</ul></li>
</ul>

これはそれぞれの思想に則って決めることだと思う  
  
row-major/colum-majorとは関係なくその行列がどのような情報を表現しているかという問題



(個人的には基底ベクトルは列ベクトルとして配置したい派)



</div>
<div class="section">
    

<h3 id="その他">その他</h3>


    

row-major/column-majorはメモリレイアウトのはなしと行列の表現のはなしが混ざり合って混沌とするが、自分なりにまとめてスッキリしたとおもう



</div>

---

[元のはてなブログ記事](https://nagakagachi.hatenablog.com/entry/2021/07/02/213944)
