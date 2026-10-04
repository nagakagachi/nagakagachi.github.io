---
title: "TextureArrayに対して実行可能なDrawMaterialToRenderTargetプラグイン[UE][Plugin]"
date: "2023-01-16T08:00:00+09:00"
draft: false
url: "/entry/2023/01/16/080000/"
categories: ["C++", "Graphics", "Material", "UE5", "UnrealC++", "Plugin"]
hatena_author: "nagakagachi"
hatena_original_url: "https://nagakagachi.hatenablog.com/entry/2023/01/16/080000"
hatena_basename: "2023/01/16/080000"
math: false
image: "images/aaba9895685d049e9eb1dd70e574973e2883642033bf736247f8afe0a99a26ea.png"
---

<p><strong>TextureRenderTarget2DArray</strong> のSlice(配列の要素)を指定して <strong>DrawMaterialToRenderTarget</strong> ができるUE<a class="keyword" href="https://d.hatena.ne.jp/keyword/%A5%D7%A5%E9%A5%B0%A5%A4%A5%F3">プラグイン</a>の公開.<br />
<br />
</p>
<ul class="table-of-contents">
<li><a href="#これは何">これは何</a></li>
<li><a href="#導入">導入</a><ul>
<li><a href="#リポジトリの-NglTextureRt2dArrayUtil-をコピー">リポジトリの NglTextureRt2dArrayUtil をコピー</a></li>
<li><a href="#プラグインが読み込まれているか確認">プラグインが読み込まれているか確認</a></li>
</ul>
</li>
<li><a href="#サンプル">サンプル</a></li>
<li><a href="#最後">最後</a></li>
</ul>
<div class="section">
    

<h3 id="これは何">これは何</h3>


<p>テクスチャ配列アセットの要素に対してマテリアル描画を実行できる<a class="keyword" href="https://d.hatena.ne.jp/keyword/%A5%D7%A5%E9%A5%B0%A5%A4%A5%F3">プラグイン</a>.<br />
UE標準のDrawMaterialToRenderTargetノードとほぼ同じで, TextureRenderTarget2DArrayとその何番目にDrawするかを指定できる.</p>
<figure class="figure-image figure-image-fotolife" title="NglDrawMaterialToRenderTargetArraySliceノード"><span itemscope itemtype="http://schema.org/Photograph"><img src="images/861d07799c56448bb066d90ed87790effc1e299a781ac42624bdfe1dd3f81712.png" width="635" height="420" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><figcaption>NglDrawMaterialToRenderTargetArraySliceノード</figcaption></figure>

内部で一時テクスチャの生成やコピーをする必要があったため, ゲーム中にリアルタイム利用するような用途向きではない点に注意.  
  
エンジン改造無しで実装するためにこうなったが今後修正できるかもしれない(未定),

<p>動作確認 UE5.1 <a class="keyword" href="https://d.hatena.ne.jp/keyword/Win64">Win64</a></p>

</div>
<div class="section">
    

<h3 id="導入">導入</h3>


    
<div class="section">
<h4 id="リポジトリの-NglTextureRt2dArrayUtil-をコピー"><a class="keyword" href="https://d.hatena.ne.jp/keyword/%A5%EA%A5%DD%A5%B8%A5%C8%A5%EA">リポジトリ</a>の NglTextureRt2dArrayUtil をコピー</h4>
<p><a href="https://github.com/nagakagachi/ue_plugin/tree/main/distribution/NglTextureRt2dArrayUtil">ue_plugin/distribution/NglTextureRt2dArrayUtil at main &middot; nagakagachi/ue_plugin &middot; GitHub</a></p><p>自身のプロジェクトに Plugins <a class="keyword" href="https://d.hatena.ne.jp/keyword/%A5%C7%A5%A3%A5%EC%A5%AF%A5%C8">ディレクト</a>リを作成し, その中に上記<a class="keyword" href="https://d.hatena.ne.jp/keyword/Github">Github</a>の NglTextureRt2dArrayUtil <a class="keyword" href="https://d.hatena.ne.jp/keyword/%A5%C7%A5%A3%A5%EC%A5%AF%A5%C8">ディレクト</a>リをコピーペーストする.<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/f2424a228885ead7b7aa13c3f7b15aff3414d42250c07db4f65015972a02007c.png" width="284" height="182" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/aca77d72e4d09e756c968b2805d1fc316bf69650a72292833f697b2076ba3d37.png" width="441" height="139" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><br />
</p>

</div>
<div class="section">
<h4 id="プラグインが読み込まれているか確認"><a class="keyword" href="https://d.hatena.ne.jp/keyword/%A5%D7%A5%E9%A5%B0%A5%A4%A5%F3">プラグイン</a>が読み込まれているか確認</h4>
<p>プロジェクトを開いて 編集/<a class="keyword" href="https://d.hatena.ne.jp/keyword/%A5%D7%A5%E9%A5%B0%A5%A4%A5%F3">プラグイン</a> のウィンドウを開き, NglTextureRt2dArrayUtil<a class="keyword" href="https://d.hatena.ne.jp/keyword/%A5%D7%A5%E9%A5%B0%A5%A4%A5%F3">プラグイン</a>が有効になっていればOK.<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/ba9a6d5dba272364ffaae21e9df37cab1595109385dec3a3c3cadd94fcc95860.png" width="882" height="460" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><br />
</p>

</div>
</div>
<div class="section">
    

<h3 id="サンプル">サンプル</h3>


<p><a class="keyword" href="https://d.hatena.ne.jp/keyword/%A5%D7%A5%E9%A5%B0%A5%A4%A5%F3">プラグイン</a>コンテンツのEditorUtilityWidget <strong>EUW_DrawToRenderTargetArraySample</strong> を右クリック->エディターユーティリティウィジットを実行 で簡易サンプルが起動する<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/94f3c62a9e079ff9cbfadb7f2c79695b165aa870b0900170b20f7224f224d621.png" width="993" height="434" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/238bdee6dd0bf8828805c6c141ecc387c6ae3dff2355047f6878dd6bbbabdf64.png" width="1001" height="474" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><br />
</p>

<ol>
<li>ウィンドウ左側にマテリアルと描画先Array要素番号(Slice Index)を指定.</li>
<li>ウィンドウ右側に書き込み先のTextureRTArrayアセットを指定。</li>
<li>Runボタン を押すとArray指定要素にマテリアル描画が実行される.</li>
</ol><p>下図は<a class="keyword" href="https://d.hatena.ne.jp/keyword/Widget">Widget</a>でSlice 0番に対して実行して, エディタでTextureRTArrayの Slice 0 を表示して結果を確認している様子.<br />
<span itemscope itemtype="http://schema.org/Photograph"><img src="images/aaba9895685d049e9eb1dd70e574973e2883642033bf736247f8afe0a99a26ea.png" width="1200" height="646" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span></p><br />


出来上がったTextureRtArrayをテクスチャ配列アセットに変換するなどご自由に.



</div>
<div class="section">
    

<h3 id="最後">最後</h3>


<p>役にたった場合は<a class="keyword" href="https://d.hatena.ne.jp/keyword/Github">Github</a>のStarや使ったよというメッセージを貰えると嬉しいです!</p>

そもそも作った理由はエディタでマテリアルを使って自由に色々なテクスチャ配列を作りたかったため.  
  
面白い使い方やもっと良い機能案があればご連絡ください.

<br />


以上...



</div>

---

[元のはてなブログ記事](https://nagakagachi.hatenablog.com/entry/2023/01/16/080000)
