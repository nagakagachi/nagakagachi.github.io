---
title: " UE4マテリアルによるDistanceField生成(Jump Floodingアルゴリズム)"
date: "2021-11-07T23:19:35+09:00"
draft: false
url: "/entry/2021/11/07/231935/"
categories: ["UE4", "GPGPU", "Graphics", "UE4", "UE5", "シェーダ", "マテリアル", "数学", "Material"]
hatena_author: "nagakagachi"
hatena_original_url: "https://nagakagachi.hatenablog.com/entry/2021/11/07/231935"
hatena_basename: "2021/11/07/231935"
math: false
image: "images/01ee4bded480ce2abd6147c04de23b1413901b2a887326cf8354440d16665e4b.png"
---

<blockquote>
<p>2023/12/16更新<br />
SDF生成ツールをUE5向けに公開しました.<blockquote data-conversation="none" class="twitter-tweet" data-lang="ja"><p lang="ja" dir="ltr">SDFテクスチャをテクスチャ2Dから生成するUE5上のツール. <br>別の作業のために生えてきた. Jump Floodingを<a class="keyword" href="https://d.hatena.ne.jp/keyword/GPU">GPU</a>(マテリアル)で実行.<br><br>入力テクスチャは黒かそうでないかで外部/内部扱いしたSDF計算. 出力は RチャンネルにUV距離, Gチャンネルに内部フラグ.  MIT License <a href="https://twitter.com/hashtag/UE5?src=hash&amp;ref_src=twsrc%5Etfw">#UE5</a> <a href="https://t.co/6GdbEja9o3">https://t.co/6GdbEja9o3</a> <a href="https://t.co/ogWdxzP5Xm">pic.twitter.com/ogWdxzP5Xm</a></p>&mdash; なが (@nagakagachi) <a href="https://twitter.com/nagakagachi/status/1730982828358390040?ref_src=twsrc%5Etfw">2023年12月2日</a></blockquote> <script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>  </p>

</blockquote>




<p>サンプルプロジェクト有 (<a class="keyword" href="https://d.hatena.ne.jp/keyword/UE4">UE4</a>.27).</p><p>Jump Flooding <a class="keyword" href="https://d.hatena.ne.jp/keyword/%A5%A2%A5%EB%A5%B4%A5%EA%A5%BA%A5%E0">アルゴリズム</a>によるDistanceField生成をUEマテリアルで実装したメモ.<br />
ついでに Editor Utility <a class="keyword" href="https://d.hatena.ne.jp/keyword/Widget">Widget</a> でSeedテクスチャの生成とDistanceFieldの生成をトリガーするテスト.</p><p>Jump Flooding Algorithm (<a class="keyword" href="https://d.hatena.ne.jp/keyword/JFA">JFA</a>)の詳細については各種資料参照.<br />
<a href="https://www.comp.nus.edu.sg/~tants/jfa/i3d06.pdf">https://www.comp.nus.edu.sg/~tants/jfa/i3d06.pdf</a><br />
<a href="https://en.wikipedia.org/wiki/Jump_flooding_algorithm">Jump flooding algorithm - Wikipedia</a><br />
<a href="https://observablehq.com/@rreusser/gpu-voronoi-diagrams-using-the-jump-flooding-algorithm">GPU Voronoi Diagrams using the Jump Flooding Algorithm / Ricky Reusser | Observable</a></p>




<ul class="table-of-contents">
<li><a href="#サンプルプロジェクト">サンプルプロジェクト</a><ul>
<li><a href="#DistanceFieldテクスチャ生成手順">DistanceFieldテクスチャ生成手順</a></li>
<li><a href="#アセット説明">アセット説明</a></li>
</ul>
</li>
<li><a href="#Jump-Flooding-ステップ">Jump Flooding ステップ</a></li>
<li><a href="#その他">その他</a></li>
</ul>
<div class="section">
    

<h3 id="サンプルプロジェクト">サンプルプロジェクト</h3>


<p><a href="https://drive.google.com/file/d/1FEnmbDwYRBIwaszz5AE0AYxZszL3f-ga/view?usp=sharing">DistanceFIeldByJFA00.zip - Google &#x30C9;&#x30E9;&#x30A4;&#x30D6;</a></p><br />


プロジェクトの\[ThirdPersonBP/DF\]に関連BPやマテリアル等がある.


<figure class="figure-image figure-image-fotolife" title="関連コンテンツフォルダ"><span itemscope itemtype="http://schema.org/Photograph"><img src="images/01ee4bded480ce2abd6147c04de23b1413901b2a887326cf8354440d16665e4b.png" width="1200" height="683" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><figcaption>関連コンテンツフォルダ</figcaption></figure>
<div class="section">
    

<h4 id="DistanceFieldテクスチャ生成手順">DistanceFieldテクスチャ生成手順</h4>


<p><strong>EUW_JfaTestアセット</strong> を右クリック->Run Editor Utility <a class="keyword" href="https://d.hatena.ne.jp/keyword/Widget">Widget</a> で<a class="keyword" href="https://d.hatena.ne.jp/keyword/Widget">Widget</a>を表示する.<br />
<strong>Generate Seed Texture ボタン</strong> を押すとマテリアルによってSeedテクスチャが更新される.</p>
<figure class="figure-image figure-image-fotolife" title="Generate SeedTexture"><span itemscope itemtype="http://schema.org/Photograph"><img src="images/82eb92868758e2a8f2520e7a7580d5e0ee3378cbcf69ee53fcd3a5849db86ecc.png" width="1015" height="627" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><figcaption>Generate SeedTexture</figcaption></figure><p><strong>Run <a class="keyword" href="https://d.hatena.ne.jp/keyword/JFA">JFA</a> ボタン</strong> を押すとSeedテクスチャを元にDistanceFieldテクスチャが生成される.</p>
<figure class="figure-image figure-image-fotolife" title="DistanceField生成"><span itemscope itemtype="http://schema.org/Photograph"><img src="images/754ad1b9f0b4e013903449f9f98036a615c7b432b20a868ef78f5bbfd07613fa.png" width="932" height="615" loading="lazy" title="" class="hatena-fotolife" itemprop="image"></span><figcaption>Generate DistanceField</figcaption></figure>
</div>
<div class="section">
    

<h4 id="アセット説明">アセット説明</h4>


    
<ul>
<li>RT_Seed
<ul>
<li>DistanceFieldの元になるSeedテクスチャ. 黒テクセルは無効で, それ以外の色のテクセルがSeedとして評価される.</li>
<li>どんなテクスチャでもよいが,今回はマテリアルM_DistanceSeedでその場で生成している.</li>
<li>サイズはデフォルト512x512だが変更可能. ただし動作確認しているのは2の冪のみ.</li>
</ul></li>
<li>RT_Jfa0
<ul>
<li>DistanceFieldの出力先テクスチャ.</li>
</ul></li>
<li>M_DistanceSeed
<ul>
<li>Seedテクスチャの生成用マテリアル. 適当な計算で適当な位置に黒(0,0,0)ではないSeedを書き込む.</li>
</ul></li>
<li>MF_JumpFlood
<ul>
<li><a class="keyword" href="https://d.hatena.ne.jp/keyword/JFA">JFA</a>のメイン処理をCustomNodeで記述したMaterialFunction. M_JumpFlood_SetupとM_JumpFlood_Itrはこれを呼び出す.</li>
</ul></li>
<li>M_JumpFlood_Setup
<ul>
<li><a class="keyword" href="https://d.hatena.ne.jp/keyword/JFA">JFA</a>の初回パス用マテリアル. Seedテクスチャを元に黒(0,0,0)ではないテクセルをSeedとして<a class="keyword" href="https://d.hatena.ne.jp/keyword/JFA">JFA</a>の初回パスを実行する.</li>
</ul></li>
<li>M_JumpFlood_Itr
<ul>
<li><a class="keyword" href="https://d.hatena.ne.jp/keyword/JFA">JFA</a>の反復パス用マテリアル. 基本的には初回パスと同じだが,<a class="keyword" href="https://d.hatena.ne.jp/keyword/JFA">JFA</a>入力が前回の<a class="keyword" href="https://d.hatena.ne.jp/keyword/JFA">JFA</a>パスの結果テクスチャになる.</li>
</ul></li>
<li>M_JumpFlood_Copy
<ul>
<li><a class="keyword" href="https://d.hatena.ne.jp/keyword/JFA">JFA</a>結果テクスチャを元に出力先テクスチャRT_Jfa0 へ出力するマテリアル.</li>
</ul></li>
<li>EUW_JfaTest
<ul>
<li><a class="keyword" href="https://d.hatena.ne.jp/keyword/JFA">JFA</a>処理のMaterialDrawなどをする<a class="keyword" href="https://d.hatena.ne.jp/keyword/Widget">Widget</a>. 今回の<a class="keyword" href="https://d.hatena.ne.jp/keyword/JFA">JFA</a>関連の処理はほぼここに書いてある.</li>
<li><a class="keyword" href="https://d.hatena.ne.jp/keyword/JFA">JFA</a>のワークテクスチャ(PingPong用に2枚)を内部で生成して利用する.</li>
<li><a class="keyword" href="https://d.hatena.ne.jp/keyword/JFA">JFA</a>自体はテクスチャサイズXに対して (log2(X)-1)回のマテリアルDrawで完了する.</li>
</ul></li>
</ul>
</div>
</div>
<div class="section">
    

<h3 id="Jump-Flooding-ステップ">Jump Flooding ステップ</h3>


<p><a class="keyword" href="https://d.hatena.ne.jp/keyword/JFA">JFA</a>の1ステップの処理は MF_JumpFlood のCustomで行っている.<br />
初回のSeedテクスチャの処理だけ少し特殊対応しているがそれ以外は素直な実装.<br />
テクスチャサイズは<strong>2の冪でのみ動作確認</strong>.</p>
<pre class="code lang-cpp" data-lang="cpp" data-unlink><span class="synComment">//  MF_JumpFlood</span>
<span class="synComment">//  入力テクスチャの非ゼロ(0,0,0)テクセルをSeedとして最近接Seedテクセル位置をJFAで計算する.</span>
<span class="synComment">//</span>
<span class="synComment">// inTexture : 入力テクスチャ.</span>
<span class="synComment">//        初回パスは黒(0,0,0)が無効値扱いである任意のテクスチャ.</span>
<span class="synComment">//        反復パスではRG=(0,0)が無効値であるような最近接Seedテクセル位置テクスチャ.</span>
<span class="synComment">//        テクセル位置は必ずテクセル中心を指すものとする. 具体的には半テクセルサイズ分のオフセットが付加されたもの.</span>
<span class="synComment">// texelPosition : ハーフテクセルサイズ込のテクセル中心位置.</span>
<span class="synComment">// textureSize : テクスチャサイズ.</span>
<span class="synComment">// stepLength : この反復でのステップのテクセル数.</span>
<span class="synComment">//        入力サイズ/2 から開始し, 反復的に 1/2 としてサイズが 1 になるまで実行することでJFAが完了する.</span>
<span class="synComment">// isSetupPass : 初回パスの場合非0.</span>
<span class="synComment">//</span>
<span class="synType">float</span> bestDistance = <span class="synConstant">65535.0</span>;
float2 bestSeed = <span class="synIdentifier">float2</span>(<span class="synConstant">0.0</span>, <span class="synConstant">0.0</span>);
<span class="synStatement">for</span>(<span class="synType">int</span> j = -<span class="synConstant">1</span>; j &lt;= <span class="synConstant">1</span>; ++j)
{
    <span class="synStatement">for</span>(<span class="synType">int</span> i = -<span class="synConstant">1</span>; i &lt;= <span class="synConstant">1</span>; ++i)
    {
        float2 samplePosition = texelPosition + <span class="synIdentifier">float2</span>(i, j) * stepLength;
        
        <span class="synType">const</span> float2 sampleUv = samplePosition / textureSize;
        <span class="synType">const</span> float4 col = <span class="synIdentifier">Texture2DSample</span>(inTexture, inTextureSampler, sampleUv);

        <span class="synStatement">if</span>(<span class="synType">any</span>(<span class="synIdentifier">float2</span>(<span class="synConstant">0.0</span>,<span class="synConstant">0.0</span>) &gt; samplePosition) || <span class="synType">any</span>(textureSize &lt;= samplePosition))
            <span class="synStatement">continue</span>;

        float2 seedPosition = samplePosition;
        <span class="synStatement">if</span>(<span class="synConstant">0.0</span> != isSetupPass.x)
        {
            <span class="synComment">// 最初のパスは黒テクセルを無視.</span>
            <span class="synStatement">if</span>(<span class="synIdentifier">all</span>(<span class="synIdentifier">float3</span>(<span class="synConstant">0.0</span>, <span class="synConstant">0.0</span>, <span class="synConstant">0.0</span>) == col.xyz))
                <span class="synStatement">continue</span>;   
        }
        <span class="synStatement">else</span>
        {
            <span class="synComment">// 有効であればハーフピクセルオフセット付きのテクセル位置が格納されている.</span>
            seedPosition = col.xy;
            <span class="synComment">// 0,0 は有効なシードを格納していない.</span>
            <span class="synStatement">if</span>(<span class="synIdentifier">all</span>(<span class="synIdentifier">float2</span>(<span class="synConstant">0.0</span>, <span class="synConstant">0.0</span>) == seedPosition))
                <span class="synStatement">continue</span>;
        }

        <span class="synType">float</span> curDist = <span class="synIdentifier">distance</span>(seedPosition, texelPosition);
        <span class="synStatement">if</span>(bestDistance &gt; curDist)
        {
            bestSeed = seedPosition;
            bestDistance = curDist;
        }
    }
}

<span class="synStatement">return</span> <span class="synIdentifier">float4</span>(bestSeed.x, bestSeed.y, <span class="synConstant">0.0</span>, <span class="synConstant">0.0</span>);
</pre>

以下の疑似コードのように反復をすることで最終的に各テクセルの最近接Seedテクセル座標が計算される.  
  
それを元にDistanceFieldテクスチャを生成する.


<pre class="code lang-cpp" data-lang="cpp" data-unlink><span class="synComment">// Pseudo Code.</span>
<span class="synType">int</span> stepCount = <span class="synIdentifier">log2</span>(TextureSize) - <span class="synConstant">1</span>;
<span class="synStatement">for</span>(<span class="synType">int</span> i = <span class="synConstant">0</span>; i &lt; stepCount; ++i)
{
    <span class="synIdentifier">JumpFlood</span>(stepLength = <span class="synIdentifier">pow</span>(<span class="synConstant">2</span>, stepCount - i));
}
</pre>
</div>
<div class="section">
    

<h3 id="その他">その他</h3>


<p>今回の実装ではSeedテクスチャの黒(0,0,0)は無効値として扱う.<br />
同様に<a class="keyword" href="https://d.hatena.ne.jp/keyword/JFA">JFA</a>ワークテクスチャは最近接Seedテクセル座標float2を格納するが, (0,0)が格納されている場合は無効値扱いとする.<br />
<span style="font-size: 80%">テクセル座標は必ずテクセル中心位置であり, 必ず半テクセルサイズ分がオフセットされているため (0,0)という値にはなりえないことから.</span></p>

</div>

---

[元のはてなブログ記事](https://nagakagachi.hatenablog.com/entry/2021/11/07/231935)
